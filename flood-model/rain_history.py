#!/usr/bin/env python3
# hourly rain at every gauge from open-meteo's archive (ERA5 reanalysis) -> gauge_rain_hourly
# free for non-commercial use, no key. if yalamaha goes commercial switch to their paid api or pull ERA5 from copernicus directly
#   python flood-model/rain_history.py                     # 2021-01-01 .. 5 days ago
#   python flood-model/rain_history.py --start 2025-01-01
import argparse
import time
from datetime import date, timedelta

import requests

from common import GAUGES, db

URL = 'https://archive-api.open-meteo.com/v1/archive'


def gauge_coords():
    with db() as con:
        rows = con.execute(
            '''SELECT DISTINCT ON (station) station, latitude, longitude FROM river_level_realtime
               WHERE latitude IS NOT NULL ORDER BY station, creation_date DESC''').fetchall()
    return {s: (lat, lng) for s, lat, lng in rows if s in GAUGES}


def fetch(lat, lng, start, end):
    # free tier: a 1 year request counts as ~26 calls (1 per 2 weeks), limit is 5000/hour + 10000/day,
    # so a full reload hits the hourly cap - just wait it out
    for tries in range(12):
        try:
            r = requests.get(URL, params={
                'latitude': lat, 'longitude': lng, 'start_date': start, 'end_date': end,
                'hourly': 'precipitation', 'timezone': 'GMT',
            }, timeout=180)
        except requests.RequestException as e:
            print(f'    retry ({e.__class__.__name__})')
            time.sleep(20)
            continue
        if r.status_code == 429:
            print(f'    rate limited, waiting 5 min ({r.text[:80]})')
            time.sleep(300)
            continue
        r.raise_for_status()
        h = r.json()['hourly']
        return list(zip(h['time'], h['precipitation']))
    raise RuntimeError('open-meteo kept failing')


def have_year(con, st, y):
    n = con.execute(
        """SELECT count(*) FROM gauge_rain_hourly WHERE station = %s AND source = 'era5'
           AND at >= make_date(%s, 1, 1) AND at < make_date(%s + 1, 1, 1)""", (st, y, y)).fetchone()[0]
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--start', default='2021-01-01')
    ap.add_argument('--end', default=str(date.today() - timedelta(days=5)))   # era5 lags ~5 days
    args = ap.parse_args()

    coords = gauge_coords()
    print(f'{len(coords)} gauges, {args.start} .. {args.end}')
    y0, y1 = int(args.start[:4]), int(args.end[:4])
    with db() as con:
        for st, (lat, lng) in sorted(coords.items()):
            n = 0
            # a year per request keeps each call small
            for y in range(y0, y1 + 1):
                s = max(args.start, f'{y}-01-01')
                e = min(args.end, f'{y}-12-31')
                # resume: skip years already loaded
                want = (date.fromisoformat(e) - date.fromisoformat(s)).days * 24
                if have_year(con, st, y) >= want:
                    continue
                rows = [(st, f'{t}:00+00', 'era5', p) for t, p in fetch(lat, lng, s, e)]
                with con.cursor() as cur:
                    cur.executemany(
                        '''INSERT INTO gauge_rain_hourly (station, at, source, rain_mm) VALUES (%s, %s, %s, %s)
                           ON CONFLICT (station, at, source) DO UPDATE SET rain_mm = EXCLUDED.rain_mm''', rows)
                con.commit()
                n += len(rows)
                time.sleep(1)
            print(f'  {st}: {n} hours')


if __name__ == '__main__':
    main()
