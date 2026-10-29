#!/usr/bin/env python3
# trains the flood model on data/dataset_<H>h.pkl and compares it with the dumb baselines
#   python flood-model/train.py               # 6h
#   python flood-model/train.py --hours 12
# trained on everything before --test-from, scored only on what came after (never shuffle time series)
import argparse
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from common import DATA

BASE = ['lvl', 'to_minor', 'span', 'rise_1h', 'rise_3h', 'rise_6h',
        'up1_lvl', 'up1_rise_1h', 'up1_rise_3h', 'up2_lvl', 'up2_rise_1h', 'up2_rise_3h',
        'up3_lvl', 'up3_rise_1h', 'up3_rise_3h', 'up_max_lvl', 'up_max_rise_3h',
        'm_sin', 'm_cos']
RAIN = [f'{p}rain_{k}h' for p in ('', 'up_') for k in (1, 3, 6, 12, 24, 72, 168)]
FUTURE = ['rain_next6h', 'up_rain_next6h']   # only known if we have a rain forecast


def score(df, pred_level, name):
    err = (pred_level - df['y_level']).abs()
    # flood = at/above minor flood level H hours later
    real = df['y_level'] >= df['minor']
    said = pred_level >= df['minor']
    new = df['level'] < df['minor']           # not flooding yet - the ones that matter for a warning
    tp, fp, fn = (real & said).sum(), (~real & said).sum(), (real & ~said).sum()
    ntp, nfp, nfn = (real & said & new).sum(), (~real & said & new).sum(), (real & ~said & new).sum()
    pct = lambda a, b: round(100 * a / b, 1) if b else None
    return {
        'model': name,
        'mae_m': round(float(err.mean()), 3),   # metres (Nagalagam St is in ft, it's 1 gauge of 40)
        'mae_scaled': round(float((err / df['span']).mean()), 3),
        'flood_caught_%': pct(tp, tp + fn), 'flood_false_alarm_%': pct(fp, tp + fp),
        'NEW_floods': int(ntp + nfn), 'new_caught_%': pct(ntp, ntp + nfn), 'new_false_alarm_%': pct(nfp, ntp + nfp),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=int, default=6)
    ap.add_argument('--test-from', default='2025-01-01')
    args = ap.parse_args()
    H = args.hours

    ds = pd.read_pickle(DATA / f'dataset_{H}h.pkl')
    ds = ds[ds['span'] > 0].copy()
    ds['y'] = ds['y_lvl'] - ds['lvl']                 # predict the change, scaled
    cut = pd.Timestamp(args.test_from, tz='UTC')
    tr, te = ds[ds['at'] < cut], ds[ds['at'] >= cut]
    print(f'train {len(tr)} rows (< {args.test_from}), test {len(te)} rows. floods in test: {(te.y_level >= te.minor).sum()}')

    res = [
        score(te, te['level'], 'baseline: stays the same'),
        score(te, te['level'] + (te['rise_3h'].fillna(te['rise_1h'] * 3) / 3 * H).fillna(0) * te['span'], 'baseline: keeps rising'),
    ]
    models = {}
    for name, feats in [('now (no forecast)', BASE + RAIN), ('with 6h rain forecast', BASE + RAIN + FUTURE)]:
        m = HistGradientBoostingRegressor(
            max_iter=400, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40,
            l2_regularization=1.0, random_state=1)
        m.fit(tr[feats], tr['y'])
        pred = te['level'] + m.predict(te[feats]) * te['span']
        res.append(score(te, pred, 'model: ' + name))
        models[name] = (m, feats)

    tbl = pd.DataFrame(res).set_index('model')
    print(tbl.to_string())

    # keep the no-forecast one for now - it only needs data we really have at prediction time
    m, feats = models['now (no forecast)']
    joblib.dump({'model': m, 'features': feats, 'horizon_hours': H, 'test_from': args.test_from},
                DATA / f'flood_model_{H}h.pkl')
    (DATA / f'flood_metrics_{H}h.json').write_text(json.dumps(res, indent=1))
    print(f'-> {DATA}/flood_model_{H}h.pkl')


if __name__ == '__main__':
    main()
