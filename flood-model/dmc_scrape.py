#!/usr/bin/env python3
# downloads DMC river reports (water level tables + flood warnings / withdrawals) from 2021 on.
# 2018-2020 ones are mostly scanned images so we skip them.
#   python flood-model/dmc_scrape.py            # all of 2021+
#   python flood-model/dmc_scrape.py --since 2025-01-01
import argparse
import csv
import html
import re
import time
from pathlib import Path

import requests

LIST_URL = ('https://www.dmc.gov.lk/index.php?option=com_dmcreports&view=reports&Itemid=277'
            '&limit=0&search=&report_type_id=6&fromdate=&todate=&lang=en')
BASE = 'https://www.dmc.gov.lk'
DATA = Path(__file__).with_name('data') / 'dmc'
UA = {'User-Agent': 'YalaMaha research (flood model training)'}


def kind_of(title):
    t = title.lower()
    if 'withdraw' in t: return 'withdrawal'
    if 'warning' in t: return 'warning'
    if 'level' in t or 'rainfall' in t: return 'level'
    return None


def get_list():
    r = requests.get(LIST_URL, headers=UA, timeout=60)
    r.raise_for_status()
    rows = []
    for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', r.text, re.S):
        link = re.search(r'href="([^"]+\.(?:pdf|PDF))"', tr)
        tds = [re.sub(r'<[^>]+>', '', html.unescape(td)).strip() for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if not link or len(tds) < 3: continue
        title, date, tm = tds[0], tds[1], tds[2]
        if not re.match(r'\d{4}-\d\d-\d\d$', date): continue
        k = kind_of(title)
        if k: rows.append({'title': title, 'date': date, 'time': tm, 'kind': k, 'url': html.unescape(link.group(1))})
    return rows


def write_manifest(rows):
    with open(DATA / 'manifest.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['date', 'time', 'kind', 'title', 'url', 'file'])
        w.writeheader()
        w.writerows(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--since', default='2021-01-01')
    ap.add_argument('--delay', type=float, default=0.7, help='seconds between downloads, be nice to their server')
    args = ap.parse_args()

    (DATA / 'pdf').mkdir(parents=True, exist_ok=True)
    rows = [r for r in get_list() if r['date'] >= args.since]
    print(f'{len(rows)} reports since {args.since}')

    for r in rows:
        # security: build our own file name from the url's last part (letters/digits only), never trust the path
        r['file'] = re.sub(r'[^A-Za-z0-9_.-]', '_', r['url'].rsplit('/', 1)[-1])[-150:]
    write_manifest(rows)

    got = skip = fail = 0
    for i, r in enumerate(rows, 1):
        dest = DATA / 'pdf' / r['file']
        if dest.exists() and dest.stat().st_size > 0:
            skip += 1
            continue
        try:
            res = requests.get(BASE + r['url'], headers=UA, timeout=60)
            res.raise_for_status()
            if not res.content.startswith(b'%PDF'):
                raise ValueError('not a pdf')
            dest.write_bytes(res.content)
            got += 1
        except Exception as e:
            fail += 1
            print(f'  ! {r["date"]} {r["title"]}: {e}')
        if i % 100 == 0: print(f'  {i}/{len(rows)}  new={got} had={skip} failed={fail}')
        time.sleep(args.delay)

    print(f'done. new={got} already had={skip} failed={fail}  -> {DATA}')


if __name__ == '__main__':
    main()
