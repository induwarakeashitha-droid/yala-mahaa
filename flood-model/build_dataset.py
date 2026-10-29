#!/usr/bin/env python3
# builds the training table: one row per (gauge, time) where we also know the level H hours later
#   python flood-model/build_dataset.py            # -> data/dataset_6h.pkl
#   python flood-model/build_dataset.py --hours 12
#
# levels are scaled by each gauge's own flood levels *as printed that day* (they change over the years):
#   lvl = (level - alert) / (major - alert)   -> 0 at alert, 1 at major
# so one model works for every gauge, metres or feet.
import argparse

import numpy as np
import pandas as pd

from common import DATA, GAUGES, db

TOL = pd.Timedelta('1h')
RAIN_WIN = [1, 3, 6, 12, 24, 72, 168]   # hours
MAX_UP = 3


def sql_df(sql, con):
    cur = con.execute(sql)
    return pd.DataFrame(cur.fetchall(), columns=[d.name for d in cur.description])


def load_obs():
    with db() as con:
        dmc = sql_df(
            '''SELECT station, reading_at AS at, water_level, level_1h_before, alert_level, minor_flood_level, major_flood_level
               FROM dmc_river_levels''', con)
        live = sql_df(
            '''SELECT station, date_trunc('hour', creation_date + interval '30 minutes') AS at, water_level,
                      alertpull AS alert_level, minorpull AS minor_flood_level, majorpull AS major_flood_level
               FROM river_level_realtime WHERE station IS NOT NULL''', con)
    # typos in the reports (eg 1.63 for 7.63): a jump bigger than the whole alert->major range in 1h isn't real
    span = dmc['major_flood_level'] - dmc['alert_level']
    dmc = dmc[~((dmc['water_level'] - dmc['level_1h_before']).abs() > span.clip(lower=1))]
    # each dmc report has 2 readings: the hour before + the hour of the report
    prev = dmc.assign(at=dmc['at'] - pd.Timedelta('1h'), water_level=dmc['level_1h_before'])
    dmc = pd.concat([dmc, prev]).drop(columns='level_1h_before')
    dmc['src'], live['src'] = 1, 0
    obs = pd.concat([live, dmc])
    obs['at'] = pd.to_datetime(obs['at'], utc=True)
    obs = obs.dropna(subset=['water_level', 'alert_level', 'major_flood_level'])
    obs = obs[obs['major_flood_level'] > obs['alert_level']]
    # live feed wins when both have the same hour
    obs = obs.sort_values('src').drop_duplicates(['station', 'at'], keep='first')
    obs = obs[obs['station'].isin(GAUGES)]
    obs['span'] = obs['major_flood_level'] - obs['alert_level']
    obs['lvl'] = (obs['water_level'] - obs['alert_level']) / obs['span']
    obs['to_minor'] = (obs['water_level'] - obs['minor_flood_level']) / obs['span']
    return obs.sort_values(['station', 'at']).reset_index(drop=True)


def load_rain():
    with db() as con:
        r = sql_df("SELECT station, at, rain_mm FROM gauge_rain_hourly WHERE source = 'era5'", con)
    r['at'] = pd.to_datetime(r['at'], utc=True)
    out = {}
    for st, g in r.groupby('station'):
        s = g.set_index('at')['rain_mm'].sort_index().asfreq('1h').fillna(0)
        cs = s.cumsum()
        # past k hours = cs(t) - cs(t-k), next 6h = cs(t+6) - cs(t)
        d = {f'rain_{k}h': cs - cs.shift(k) for k in RAIN_WIN}
        d['rain_next6h'] = cs.shift(-6) - cs
        out[st] = pd.DataFrame(d)
    return out


def near(series, times):
    # value at each time, from a reading within +-1h, else nan
    if series.empty:
        return np.full(len(times), np.nan)
    return series.reindex(times, method='nearest', tolerance=TOL).to_numpy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=int, default=6)
    args = ap.parse_args()
    H = pd.Timedelta(hours=args.hours)

    obs = load_obs()
    rain = load_rain()
    by = {st: g.set_index('at') for st, g in obs.groupby('station')}
    print(f'{len(obs)} readings, {obs.station.nunique()} gauges, {obs['at'].min():%Y-%m-%d} .. {obs['at'].max():%Y-%m-%d}')

    parts = []
    for st, g in by.items():
        t = g.index
        lvl = g['lvl']
        f = pd.DataFrame(index=t)
        f['station'] = st
        f['lvl'] = lvl.to_numpy()
        f['to_minor'] = g['to_minor'].to_numpy()
        f['span'] = g['span'].to_numpy()
        for k in (1, 3, 6):
            f[f'rise_{k}h'] = f['lvl'] - near(lvl, t - pd.Timedelta(hours=k))
        # target: scaled level H hours later (+ the raw numbers to judge it in metres)
        f['y_lvl'] = near(lvl, t + H)
        f['y_level'] = near(g['water_level'], t + H)
        f['level'] = g['water_level'].to_numpy()
        f['minor'] = g['minor_flood_level'].to_numpy()
        f['major'] = g['major_flood_level'].to_numpy()

        # upstream gauges, same slots every time
        ups = GAUGES[st]['up'][:MAX_UP]
        for i in range(MAX_UP):
            u = by.get(ups[i]) if i < len(ups) else None
            ul = u['lvl'] if u is not None else pd.Series(dtype=float)
            f[f'up{i+1}_lvl'] = near(ul, t)
            for k in (1, 3):
                f[f'up{i+1}_rise_{k}h'] = f[f'up{i+1}_lvl'] - near(ul, t - pd.Timedelta(hours=k))
        f['up_max_lvl'] = f[[f'up{i+1}_lvl' for i in range(MAX_UP)]].max(axis=1)
        f['up_max_rise_3h'] = f[[f'up{i+1}_rise_3h' for i in range(MAX_UP)]].max(axis=1)

        # rain at the gauge and summed over the upstream gauges (rough catchment)
        rs = rain.get(st)
        for c in [f'rain_{k}h' for k in RAIN_WIN] + ['rain_next6h']:
            f[c] = near(rs[c], t) if rs is not None else np.nan
            upv = [near(rain[u][c], t) for u in ups if u in rain]
            f[f'up_{c}'] = np.nansum(upv, axis=0) if upv else np.nan

        parts.append(f)

    ds = pd.concat(parts).reset_index(names='at')
    ds['month'] = ds['at'].dt.tz_convert('Asia/Colombo').dt.month
    ds['m_sin'] = np.sin(2 * np.pi * ds['month'] / 12)
    ds['m_cos'] = np.cos(2 * np.pi * ds['month'] / 12)
    have = ds['y_lvl'].notna()
    print(f'rows: {len(ds)}, with a target {args.hours}h later: {have.sum()}')
    ds = ds[have]
    print(ds.groupby(ds['at'].dt.year).size().rename('rows').to_string())
    out = DATA / f'dataset_{args.hours}h.pkl'
    ds.to_pickle(out)
    print(f'-> {out}')


if __name__ == '__main__':
    main()
