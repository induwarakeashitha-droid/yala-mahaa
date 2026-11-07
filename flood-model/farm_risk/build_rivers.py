#!/usr/bin/env python3
# Builds rivers_lk.json.gz: every OSM river in Sri Lanka as points 50 m apart, each with
#   - the river's bed / normal water level from the 12.5 m DEM, and
#   - its catchment area (km2) from a 200 m flow-accumulation grid of the same DEM.
# score_farms.py reads this file, so run this only when the DEM or the OSM rivers change.
#
#   pip install numpy scipy rasterio pysheds
#   curl -A yala-maha-flood-risk --data-urlencode 'data=[out:json][timeout:500];
#     area["ISO3166-1"="LK"][admin_level=2]->.lk;(way["waterway"="river"](area.lk););out tags geom;' \
#     https://overpass-api.de/api/interpreter -o rivers_osm.json
#   python build_rivers.py --dem /path/to/ALOS_DEM_tifs --osm rivers_osm.json
import argparse
import glob
import gzip
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.warp import transform

np.in1d = np.isin  # pysheds 0.5 still calls np.in1d, removed in numpy 2.4
from pysheds.grid import Grid  # noqa: E402
from pysheds.sview import Raster, ViewFinder  # noqa: E402

from dem import Dem  # noqa: E402

UTM = 'EPSG:32644'
STEP_M = 50          # spacing of river points
BED_WINDOW_M = 50    # OSM lines can be 20-50 m off the channel: take the lowest DEM cell this close
AREA_SNAP_M = 400    # the 200 m flow grid's channel can sit a cell or two off the OSM line


def catchment_grid(dem_dir):
    """Catchment area (km2) of every 200 m cell, from D8 flow directions on the pit-filled DEM."""
    srcs = [rasterio.open(f) for f in glob.glob(f'{dem_dir}/*.tif')]
    arr, tf = merge(srcs, res=200, resampling=Resampling.average, nodata=-32768)
    for s in srcs:
        s.close()
    arr = arr[0].astype(np.float32)
    sea = arr <= -1000
    arr[sea] = -9999.0
    raster = Raster(arr, viewfinder=ViewFinder(affine=tf, shape=arr.shape, crs=UTM, nodata=np.float32(-9999.0)))
    grid = Grid.from_raster(raster)
    filled = grid.resolve_flats(grid.fill_depressions(grid.fill_pits(raster)))
    acc = np.asarray(grid.accumulation(grid.flowdir(filled)), dtype=np.float32) * (200 * 200 / 1e6)
    acc[sea] = 0
    return acc, tf


def downhill_fit(z):
    """Closest non-increasing profile to z (pool-adjacent-violators). A running minimum would let one
    bad low cell drag the whole river downstream of it too low; this only averages it with its neighbours."""
    blocks = []   # [mean, count]
    for v in z:
        blocks.append([float(v), 1])
        while len(blocks) > 1 and blocks[-2][0] < blocks[-1][0]:
            m2, n2 = blocks.pop()
            m1, n1 = blocks.pop()
            blocks.append([(m1 * n1 + m2 * n2) / (n1 + n2), n1 + n2])
    return np.concatenate([np.full(n, m) for m, n in blocks])


def densify(xs, ys, step):
    out_x, out_y = [xs[0]], [ys[0]]
    for x0, y0, x1, y1 in zip(xs, ys, xs[1:], ys[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) // step))
        for k in range(1, n + 1):
            out_x.append(x0 + (x1 - x0) * k / n)
            out_y.append(y0 + (y1 - y0) * k / n)
    return np.array(out_x), np.array(out_y)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dem', required=True, help='folder with the ALOS_DEM_T*.tif tiles')
    ap.add_argument('--osm', required=True, help='Overpass JSON of waterway=river ways')
    ap.add_argument('--out', default=str(Path(__file__).with_name('rivers_lk.json.gz')))
    a = ap.parse_args()

    print('catchment grid ...', flush=True)
    acc, acc_tf = catchment_grid(a.dem)
    inv = ~acc_tf
    snap = int(AREA_SNAP_M // 200)
    dem = Dem(a.dem)

    names, name_idx = [], {}
    pts = []   # [lat, lon, bed_m, area_km2, river, way]
    ways = json.load(open(a.osm))['elements']
    # nearby ways one after another, so the DEM tile cache keeps hitting
    ways.sort(key=lambda w: (round(w['bounds']['minlat'] / 0.45), w['bounds']['minlon']))
    for n, w in enumerate(ways):
        tags = w.get('tags', {})
        name = tags.get('name:en') or tags.get('name') or ''
        if name not in name_idx:
            name_idx[name] = len(names)
            names.append(name)
        lon = [p['lon'] for p in w['geometry']]
        lat = [p['lat'] for p in w['geometry']]
        if len(lon) < 2:
            continue
        x, y = transform('EPSG:4326', UTM, lon, lat)
        x, y = densify(x, y, STEP_M)
        bed = np.array([dem.min_near(px, py, BED_WINDOW_M) for px, py in zip(x, y)], dtype=float)
        ok = ~np.isnan(bed)
        if not ok.any():
            continue
        # water runs downhill: fit a profile that never rises, which removes bridges, tree tops and
        # other bumps on the bed. OSM draws rivers in flow direction; flip first if this one was drawn uphill.
        b = bed[ok]
        rev = b[0] < b[-1]
        b = downhill_fit(b[::-1] if rev else b)
        bed[ok] = b[::-1] if rev else b
        lon2, lat2 = transform(UTM, 'EPSG:4326', list(x), list(y))
        area = np.zeros(len(x))
        for k, (px, py) in enumerate(zip(x, y)):
            c, r = inv * (px, py)
            r, c = int(r), int(c)
            win = acc[max(r - snap, 0):r + snap + 1, max(c - snap, 0):c + snap + 1]
            area[k] = float(win.max()) if win.size else 0.0
        # catchment only grows downstream; a running maximum fixes points that snapped onto a side gully
        area = np.maximum.accumulate(area[::-1])[::-1] if rev else np.maximum.accumulate(area)
        for plon, plat, pb, pa in zip(lon2, lat2, bed, area):
            if not np.isnan(pb):
                pts.append([round(plat, 6), round(plon, 6), round(float(pb), 1), round(float(pa), 1), name_idx[name], n])
        if n % 200 == 0:
            print(f'{n}/{len(ways)} ways, {len(pts)} points', flush=True)

    with gzip.open(a.out, 'wt') as f:
        json.dump({
            'source': 'River lines (c) OpenStreetMap contributors (ODbL); elevations from the validated 12.5 m ALOS DEM for Sri Lanka',
            'step_m': STEP_M,
            'fields': ['lat', 'lon', 'bed_m', 'catchment_km2', 'river', 'way'],   # river = index into rivers, way = OSM line number
            'rivers': names,
            'points': pts,
        }, f, separators=(',', ':'))
    print(f'wrote {a.out}: {len(pts)} points, {len(names)} names')


if __name__ == '__main__':
    main()
