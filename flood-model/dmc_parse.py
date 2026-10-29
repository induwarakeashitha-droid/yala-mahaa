#!/usr/bin/env python3
# reads the downloaded DMC pdfs -> dmc_river_levels + dmc_flood_warnings
#   python flood-model/dmc_parse.py
import csv
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

from common import DATA, GAUGES, db

LK = timezone(timedelta(hours=5, minutes=30))
PDF = DATA / 'dmc' / 'pdf'

# every spelling -> name used in the live feed, longest first so "Kalawellawa (Millakanda)" wins over "Kalawellawa"
NAMES = sorted(
    [(a, k) for k, g in GAUGES.items() for a in [k, *g['alias']]],
    key=lambda x: -len(x[0]),
)
NAME_RE = re.compile('|'.join(re.escape(a) for a, _ in NAMES), re.I)
NAME_OF = {a.lower(): k for a, k in NAMES}

NUM = r'(-?\d+(?:\.\d+)?|-+|N/?A|\*+)'
ROW_RE = re.compile(
    rf'\b(m|ft)\s+{NUM}\s+{NUM}\s+{NUM}\s+{NUM}\s+{NUM}\s+'
    r'(Normal|Alert|Minor\s*Flood|Major\s*Flood|Flood|Below\s+Normal|Gauge\s+not\s+working|[A-Za-z][A-Za-z ]{0,20}?)'
    r'(?:\s+(Rising|Falling|Steady))?(?:\s+(-?\d+(?:\.\d+)?|-+|N/?A))?\s*$',
    re.I | re.M,
)


def text_of(path):
    r = subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, text=True, timeout=60)
    return r.stdout


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def report_time(txt, fallback):
    # header like "DATE : 29-Oct-2026 ... TIME : 12:30 PM"
    d = re.search(r'DATE\s*:\s*(\d{1,2})[-/ .]([A-Za-z]{3})[A-Za-z]*[-/ .](\d{4})', txt)
    t = re.search(r'TIME\s*:\s*(\d{1,2})[.:](\d{2})\s*([AP]\.?M|Noon|Midnight)?', txt, re.I)
    if not d or not t:
        return fallback
    try:
        day = datetime.strptime(f'{d.group(1)} {d.group(2).title()} {d.group(3)}', '%d %b %Y')
    except ValueError:
        return fallback
    h, mi, ap = int(t.group(1)), int(t.group(2)), (t.group(3) or '').upper().replace('.', '')
    if ap == 'PM' and h < 12: h += 12
    if ap == 'AM' and h == 12: h = 0
    if ap == 'NOON': h = 12
    if ap == 'MIDNIGHT': h = 0
    return day.replace(hour=h % 24, minute=mi, tzinfo=LK)


def parse_levels(txt, fallback_at, fname):
    at = report_time(txt, fallback_at)
    # the second level column is "level at" the full hour before the report (12:30 report -> 12:00)
    reading_at = at.replace(minute=0)
    m = re.search(r'(\d+)\s*Hr\s*RF', txt, re.I)
    rain_h = int(m.group(1)) if m else None

    rows, last_end = [], 0
    for mt in ROW_RE.finditer(txt):
        # station name is somewhere between the previous row and this one (same line, or the lines above in the 2021 layout)
        block = txt[last_end:mt.start()]
        names = list(NAME_RE.finditer(block))
        last_end = mt.end()
        if not names:
            continue
        st = NAME_OF[names[-1].group(0).lower()]
        if any(x['station'] == st for x in rows):
            continue
        unit, al, mi, ma, before, now, rem, trend, rain = mt.groups()
        rows.append({
            'station': st, 'basin': GAUGES[st]['basin'], 'reading_at': reading_at,
            'water_level': num(now), 'level_1h_before': num(before), 'unit': unit.lower(),
            'alert_level': num(al), 'minor_flood_level': num(mi), 'major_flood_level': num(ma),
            'remarks': re.sub(r'\s+', ' ', rem).strip().title(), 'trend': trend.title() if trend else None,
            'rain_mm': num(rain), 'rain_hours': rain_h, 'source_file': fname,
        })
    return rows


# "Kalu" -> "Kalu Ganga" etc so warnings match the gauge basins
BASINS = {g['basin'].split()[0].lower(): g['basin'] for g in GAUGES.values()}
BASINS.update({'attanagalu': 'Aththanagalu Oya', 'kelani': 'Kelani Ganga', 'maa': 'Ma Oya', 'kala': 'Kala Oya'})
NOT_BASIN = {'river', 'the', 'flood', 'all', 'following', 'above', 'these', 'this', 'other', 'relevant'}


def basin_name(b):
    return BASINS.get(b.split()[0].lower(), b)


BASIN_RE = re.compile(r'([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+(?:River|Ganga|Oya)?\s*Basin', re.M)


def parse_warning(txt, r, issued):
    eng = '\n'.join(l for l in txt.splitlines() if re.search(r'[A-Za-z]{3}', l))
    basins = []
    for b in BASIN_RE.findall(eng + '\n' + r['title']):
        b = re.sub(r'\s+(River|Ganga|Oya)$', '', b.strip()).strip()
        if b.split()[0].lower() not in NOT_BASIN and b not in basins:
            basins.append(b)
    # titles like "Flood Warning for Mahaweli River - No 01"
    t = re.search(r'for\s+(?:the\s+)?([A-Z][A-Za-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:River|Ganga|Oya)', r['title'])
    if t and t.group(1) not in basins:
        basins.append(t.group(1))
    no = re.search(r'(?:Number|No)\.?\s*[-:]?\s*(\d{1,3})', eng + ' ' + r['title'], re.I)
    col = re.search(r'Colou?r\s*[-–:]?\s*(Red|Amber|Yellow|Orange)', eng, re.I)
    vu = None
    v = re.search(r'Valid till\s+(\d{1,2})[.:](\d{2})\s*([AP]M)\s+on\s+(\d{1,2})\w*\s+of\s+([A-Za-z]+)\s+(\d{4})', eng, re.I)
    if v:
        try:
            h = int(v.group(1)) % 12 + (12 if v.group(3).upper() == 'PM' else 0)
            vu = datetime.strptime(f'{v.group(4)} {v.group(5)[:3].title()} {v.group(6)}', '%d %b %Y').replace(hour=h, minute=int(v.group(2)), tzinfo=LK)
        except ValueError:
            pass
    return [{
        'kind': r['kind'], 'basin': b, 'issued_at': issued, 'valid_until': vu,
        'warning_no': int(no.group(1)) if no else None, 'colour': col.group(1).title() if col else None,
        'title': r['title'], 'source_file': r['file'],
    } for b in (dict.fromkeys(basin_name(x) for x in basins) or [None])]


def main():
    man = list(csv.DictReader(open(DATA / 'dmc' / 'manifest.csv')))
    lv, wr, bad = [], [], []
    for i, r in enumerate(man, 1):
        if not r['file'] or not (PDF / r['file']).exists():
            continue
        hh, mm = (r['time'] or '00:00').split(':')[:2]
        listed = datetime.strptime(r['date'], '%Y-%m-%d').replace(hour=int(hh), minute=int(mm), tzinfo=LK)
        txt = text_of(PDF / r['file'])
        if r['kind'] == 'level':
            rows = parse_levels(txt, listed, r['file'])
            if len(rows) < 10:
                bad.append((r['file'], len(rows)))
            lv += rows
        else:
            wr += parse_warning(txt, r, listed)
        if i % 250 == 0:
            print(f'  {i}/{len(man)}  levels={len(lv)} warnings={len(wr)} weak={len(bad)}')

    with db() as con, con.cursor() as cur:
        cur.executemany(
            '''INSERT INTO dmc_river_levels (station, basin, reading_at, water_level, level_1h_before, unit, alert_level,
                   minor_flood_level, major_flood_level, remarks, trend, rain_mm, rain_hours, source_file)
               VALUES (%(station)s, %(basin)s, %(reading_at)s, %(water_level)s, %(level_1h_before)s, %(unit)s, %(alert_level)s,
                   %(minor_flood_level)s, %(major_flood_level)s, %(remarks)s, %(trend)s, %(rain_mm)s, %(rain_hours)s, %(source_file)s)
               ON CONFLICT (station, reading_at) DO UPDATE SET water_level = EXCLUDED.water_level,
                   level_1h_before = EXCLUDED.level_1h_before, remarks = EXCLUDED.remarks, trend = EXCLUDED.trend,
                   rain_mm = EXCLUDED.rain_mm, rain_hours = EXCLUDED.rain_hours, source_file = EXCLUDED.source_file''',
            lv,
        )
        cur.executemany(
            '''INSERT INTO dmc_flood_warnings (kind, basin, issued_at, valid_until, warning_no, colour, title, source_file)
               VALUES (%(kind)s, %(basin)s, %(issued_at)s, %(valid_until)s, %(warning_no)s, %(colour)s, %(title)s, %(source_file)s)
               ON CONFLICT (source_file, basin) DO NOTHING''',
            wr,
        )
    print(f'levels: {len(lv)} rows from {sum(1 for r in man if r["kind"] == "level")} reports, warnings: {len(wr)} rows')
    print(f'reports with <10 gauges parsed: {len(bad)}')
    for f, n in bad[:25]:
        print(f'   {n:3d}  {f}')


if __name__ == '__main__':
    sys.exit(main())
