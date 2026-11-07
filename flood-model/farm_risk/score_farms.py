#!/usr/bin/env python3
# River flood risk score (0-100) and category for every farm, from where the field sits
# relative to the rivers around it. Results go to the farm_flood_risk table.
#
#   python score_farms.py --dem /path/to/ALOS_DEM_tifs              # new farms and moved pins only
#   python score_farms.py --dem ... --all                           # rescore everything
#   python score_farms.py --dem ... --at 8.1345,80.9952 --dry-run   # one spot, print only
#
# How a farm is scored, for each river within 6 km:
#   1. Farm level: the 12.5 m DEM at the pin (median of the 3x3 cells around it), or the lowest
#      quarter of the field when the farmer drew its boundary, since the low corner floods first.
#   2. River level: the river's normal water level at its point nearest the farm (rivers_lk.json.gz).
#   3. Rise needed: how far that river must rise to reach the field. That is the farm's height above
#      the river, or the height of any ridge or bank in between if that is higher (water has to get over it).
#   4. Height score from the rise, anchored on the DMC river gauges: across 38 gauges the median
#      alert level is 3.0 m, minor flood 4.3 m and major flood 5.9 m above the river's normal level.
#   5. Weighted by distance (a big river's floods spread further) and by river size (a small stream
#      floods less widely). Size and spread come from the catchment area upstream of that point.
# The rivers are combined as independent sources: risk = 1 - (1 - r1)(1 - r2)...
#
# This is flood *susceptibility* from terrain: it says which fields flood first and worst when the
# rivers rise, not when that will happen. Tanks, canals and local rain ponding are not included.
import argparse
import gzip
import json
import math
import os
import sys
from pathlib import Path

import numpy as np
from rasterio.warp import transform
from scipy.spatial import cKDTree

from dem import Dem

HERE = Path(__file__).resolve().parent
UTM = 'EPSG:32644'
METHOD = 'dem12.5-osm-gauge-v1'
SEARCH_M = 6000
NEAR_SLACK_M = 150     # also try river points up to this much further than the nearest one
PROFILE_STEP_M = 12.5
BANK_SKIP_M = 40       # the first metres from the river point are the channel and bank itself
BARRIER_MIN_WIDTH_M = 60

# rise needed (m) -> height score (0-100). 3.0 / 4.3 / 5.9 m are the median DMC alert / minor /
# major flood levels above normal; 9 m is about a record flood; 12 m and above is out of reach.
HEIGHT_ANCHORS = [(0.5, 100), (3.0, 80), (4.3, 60), (5.9, 40), (9.0, 10), (12.0, 0)]

CATEGORIES = [(70, 'very_high'), (50, 'high'), (30, 'medium'), (15, 'low'), (0, 'very_low')]


def height_score(rise_m):
    xs, ys = zip(*HEIGHT_ANCHORS)
    return float(np.interp(rise_m, xs, ys))


def size_factor(km2):
    # 10 km2 stream 0.4, 100 km2 0.7, 1000 km2 and up 1.0
    return float(np.clip(0.4 + 0.3 * math.log10(max(km2, 1) / 10), 0.3, 1.0))


def spread_m(km2):
    # how far from the channel floods typically reach: ~250 m for 30 km2, 1 km for 1000 km2, 2.5 km for 10000 km2
    return float(np.clip(400 * (max(km2, 1) / 100) ** 0.4, 150, 3000))


def category(score):
    return next(name for low, name in CATEGORIES if score >= low)


class Rivers:
    def __init__(self, path):
        d = json.load(gzip.open(path, 'rt'))
        p = np.array(d['points'], dtype=float)
        self.names = d['rivers']
        self.bed, self.area = p[:, 2], p[:, 3]
        self.river, self.way = p[:, 4].astype(int), p[:, 5].astype(int)
        x, y = transform('EPSG:4326', UTM, list(p[:, 1]), list(p[:, 0]))
        self.x, self.y = np.array(x), np.array(y)
        self.tree = cKDTree(np.c_[self.x, self.y])

    def group(self, i):
        # one entry per river: named rivers by name (OSM splits them into many lines), unnamed by line
        name = self.names[self.river[i]]
        return ('n', name) if name else ('w', int(self.way[i]))


def farm_level(dem, x, y, boundary_xy):
    if boundary_xy is not None and len(boundary_xy) >= 3:
        bx, by = boundary_xy[:, 0], boundary_xy[:, 1]
        r = max(np.hypot(bx - x, by - y).max(), 20)
        xs, ys, z = dem.cells(x, y, r)
        inside = points_in_polygon(xs, ys, boundary_xy) & ~np.isnan(z)
        if inside.sum() >= 3:
            return float(np.percentile(z[inside], 25)), 'field_low_quarter'
    w = dem.window(x, y, dem.res)
    if w.size and not np.isnan(w).all():
        return float(np.nanmedian(w)), 'pin_3x3'
    return float('nan'), 'none'


def points_in_polygon(xs, ys, poly):
    inside = np.zeros(len(xs), dtype=bool)
    px, py = poly[:, 0], poly[:, 1]
    j = len(poly) - 1
    for i in range(len(poly)):
        cross = ((py[i] > ys) != (py[j] > ys)) & (xs < (px[j] - px[i]) * (ys - py[i]) / (py[j] - py[i] + 1e-12) + px[i])
        inside ^= cross
        j = i
    return inside


def barrier(dem, x0, y0, x1, y1):
    """Highest ground between river point (x0, y0) and the farm, ignoring the bank itself."""
    d = math.hypot(x1 - x0, y1 - y0)
    if d <= BANK_SKIP_M:
        return float('-inf')
    n = int(d // PROFILE_STEP_M)
    t = np.linspace(BANK_SKIP_M / d, 1, max(n, 2))
    z = np.array([dem.sample(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k) for k in t])
    z = z[~np.isnan(z)]
    # The DEM is radar and sees the tops of trees and buildings. Only ground that stays high for
    # BARRIER_MIN_WIDTH_M counts as a barrier, so tree belts, houses and narrow flood bunds
    # (which can overtop or breach) don't hide a field from its river.
    k = max(1, int(BARRIER_MIN_WIDTH_M // PROFILE_STEP_M))
    if len(z) >= k:
        z = np.lib.stride_tricks.sliding_window_view(z, k).min(axis=1)
    return float(z.max()) if len(z) else float('-inf')


def score_point(dem, rivers, lat, lon, boundary=None):
    (x,), (y,) = transform('EPSG:4326', UTM, [lon], [lat])
    bxy = None
    if boundary:
        ring = boundary['coordinates'][0]
        bx, by = transform('EPSG:4326', UTM, [c[0] for c in ring], [c[1] for c in ring])
        bxy = np.c_[bx, by]
    elev, how = farm_level(dem, x, y, bxy)
    if math.isnan(elev):
        return None
    idx = rivers.tree.query_ball_point([x, y], SEARCH_M)
    if not idx:
        return result(elev, how, [])
    idx = np.array(idx)
    dist = np.hypot(rivers.x[idx] - x, rivers.y[idx] - y)
    nearest = {}
    for i, d in zip(idx, dist):
        g = rivers.group(i)
        if g not in nearest or d < nearest[g]:
            nearest[g] = d
    best = {}
    for i, d in zip(idx, dist):
        g = rivers.group(i)
        if d > nearest[g] + NEAR_SLACK_M:
            continue
        bed, km2 = rivers.bed[i], rivers.area[i]
        wall = barrier(dem, rivers.x[i], rivers.y[i], x, y)
        rise = max(elev, wall) - bed
        risk = height_score(rise) / 100 * size_factor(km2) / (1 + (d / spread_m(km2)) ** 2)
        if g not in best or risk > best[g]['risk']:
            best[g] = {
                'river': g[1] if g[0] == 'n' else None,
                'distance_m': round(float(d)),
                'farm_above_river_m': round(elev - bed, 1),
                'rise_needed_m': round(float(max(rise, 0)), 1),
                'barrier_m': round(float(wall - bed), 1) if wall > elev else None,
                'catchment_km2': round(float(km2)),
                'risk': float(risk),
            }
    return result(elev, how, sorted(best.values(), key=lambda r: -r['risk']))


def result(elev, how, rivers):
    keep = 1.0
    for r in rivers:
        keep *= 1 - r['risk']
    score = round(100 * (1 - keep))
    for r in rivers:
        r['risk'] = round(100 * r['risk'], 1)
    return {
        'score': score,
        'category': category(score),
        'elevation_m': round(elev, 1),
        'elevation_from': how,
        'rivers': [r for r in rivers if r['risk'] >= 1][:5],
    }


# --- database -------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS farm_flood_risk (
    farm_id         TEXT PRIMARY KEY REFERENCES farmers(farm_id) ON UPDATE CASCADE ON DELETE CASCADE,
    score           SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
    category        TEXT NOT NULL CHECK (category IN ('very_low', 'low', 'medium', 'high', 'very_high')),
    elevation_m     DOUBLE PRECISION,
    elevation_from  TEXT,                 -- pin_3x3 / field_low_quarter
    river_name      TEXT,                 -- the river giving the most risk (null = unnamed river)
    river_distance_m INT,
    rise_needed_m   DOUBLE PRECISION,     -- how far that river must rise above normal to reach the field
    rivers          JSONB NOT NULL,       -- up to 5 rivers with their part of the risk
    farm_latitude   NUMERIC(10,6) NOT NULL,   -- the pin this was scored for, to spot moved pins
    farm_longitude  NUMERIC(10,6) NOT NULL,
    boundary        JSONB,
    method          TEXT NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def env():
    # same settings as the other jobs (PG*), falling back to api/config.env when run by hand
    e = {}
    cfg = HERE.parent.parent / 'api' / 'config.env'
    if cfg.exists():
        for line in cfg.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.split('=', 1)
                e[k.strip()] = v.strip().strip('"').strip("'")
    g = lambda pg, api, default: os.environ.get(pg) or e.get(api) or default
    return dict(host=g('PGHOST', 'APIDBHOST', 'localhost'), port=int(g('PGPORT', 'APIDBPORT', 5432)),
                dbname=g('PGDATABASE', 'APIDATABASE', 'yala-maha-api'), user=g('PGUSER', 'APIDBUSERN', 'postgres'),
                password=g('PGPASSWORD', 'APIDBPASSWORD', ''))


def report():
    # the check on whether the score is right: farms that flooded several times should score high
    import psycopg2
    with psycopg2.connect(**env()) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT coalesce(fm.flood_history, 'not asked') AS said, r.category, count(*), round(avg(r.score)) AS avg_score
            FROM farm_flood_risk r LEFT JOIN farms fm ON fm.farm_id = r.farm_id
            GROUP BY 1, 2 ORDER BY 1, min(r.score)
        """)
        print(f"{'farmer said':12s} {'category':10s} {'farms':>5s} {'avg score':>9s}")
        for said, cat, n, avg in cur.fetchall():
            print(f'{said:12s} {cat:10s} {n:5d} {avg:9}')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dem', default=os.environ.get('FLOOD_DEM_DIR'), help='folder with the ALOS_DEM_T*.tif tiles')
    ap.add_argument('--rivers', default=str(HERE / 'rivers_lk.json.gz'))
    ap.add_argument('--all', action='store_true', help='rescore every farm, not just new or moved ones')
    ap.add_argument('--at', help='score one lat,lon and print it (no database)')
    ap.add_argument('--dry-run', action='store_true', help='print, do not write')
    ap.add_argument('--report', action='store_true', help='compare saved scores with what farmers said about past floods')
    a = ap.parse_args()
    if a.report:
        return report()
    if not a.dem or not any(Path(a.dem).glob('*.tif')):
        print('farm flood risk: no DEM tiles (--dem or FLOOD_DEM_DIR), skipping')
        return 0
    dem, rivers = Dem(a.dem), Rivers(a.rivers)

    if a.at:
        lat, lon = map(float, a.at.split(','))
        print(json.dumps(score_point(dem, rivers, lat, lon), indent=2, ensure_ascii=False))
        return 0

    import psycopg2
    from psycopg2.extras import Json
    conn = psycopg2.connect(**env())
    with conn, conn.cursor() as cur:
        cur.execute(SCHEMA)
        cur.execute("""
            SELECT f.farm_id, f.farm_latitude, f.farm_longitude, fm.boundary
            FROM farmers f
            LEFT JOIN farms fm ON fm.farm_id = f.farm_id
            LEFT JOIN farm_flood_risk r ON r.farm_id = f.farm_id
            WHERE f.farm_latitude IS NOT NULL AND f.farm_longitude IS NOT NULL
              AND (%s OR r.farm_id IS NULL OR r.method <> %s
                   OR r.farm_latitude <> f.farm_latitude OR r.farm_longitude <> f.farm_longitude
                   OR r.boundary IS DISTINCT FROM fm.boundary)
        """, (a.all, METHOD))
        todo = cur.fetchall()
        print(f'farm flood risk: {len(todo)} farm(s) to score')
        for farm_id, lat, lon, boundary in todo:
            r = score_point(dem, rivers, float(lat), float(lon), boundary)
            if r is None:
                print(f'  {farm_id}: outside the DEM, skipped')
                continue
            top = r['rivers'][0] if r['rivers'] else {}
            print(f"  {farm_id}: {r['score']:3d} {r['category']:9s} {r['elevation_m']} m, "
                  f"{top.get('river') or ('unnamed river' if top else 'no river near or low enough to matter')}"
                  + (f", {top['distance_m']} m away, needs {top['rise_needed_m']} m rise" if top else ''))
            if a.dry_run:
                continue
            cur.execute("""
                INSERT INTO farm_flood_risk (farm_id, score, category, elevation_m, elevation_from, river_name,
                    river_distance_m, rise_needed_m, rivers, farm_latitude, farm_longitude, boundary, method, computed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (farm_id) DO UPDATE SET score = EXCLUDED.score, category = EXCLUDED.category,
                    elevation_m = EXCLUDED.elevation_m, elevation_from = EXCLUDED.elevation_from,
                    river_name = EXCLUDED.river_name, river_distance_m = EXCLUDED.river_distance_m,
                    rise_needed_m = EXCLUDED.rise_needed_m, rivers = EXCLUDED.rivers,
                    farm_latitude = EXCLUDED.farm_latitude, farm_longitude = EXCLUDED.farm_longitude,
                    boundary = EXCLUDED.boundary, method = EXCLUDED.method, computed_at = now()
            """, (farm_id, r['score'], r['category'], r['elevation_m'], r['elevation_from'], top.get('river'),
                  top.get('distance_m'), top.get('rise_needed_m'), Json(r['rivers']), lat, lon,
                  Json(boundary) if boundary else None, METHOD))
        if a.dry_run:
            conn.rollback()
    return 0


if __name__ == '__main__':
    sys.exit(main())
