# shared bits for the flood model scripts: db connection + gauge list
import os
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'


def _load_env():
    # reads API/config.env so the scripts use the same db as the api
    env = {}
    p = ROOT.parent / 'API' / 'config.env'
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def db():
    env = {**_load_env(), **os.environ}
    return psycopg.connect(
        host=env.get('APIDBHOST', 'localhost'),
        port=int(env.get('APIDBPORT', 5432)),
        dbname=env.get('APIDATABASE', 'yala-maha-api'),
        user=env.get('APIDBUSERN', 'postgres'),
        password=env.get('APIDBPASSWORD', ''),
    )


# name in the live feed -> other spellings used in DMC reports over the years.
# up = gauges upstream on the same river system (my reading of the river maps - CHECK THIS).
# order of up doesn't matter, the model learns the lag itself from their rise rates.
GAUGES = {
    # kelani ganga
    'Norwood':          {'basin': 'Kelani Ganga', 'alias': [], 'up': []},
    'Kithulgala':       {'basin': 'Kelani Ganga', 'alias': ['Kitulgala'], 'up': ['Norwood']},
    'Deraniyagala':     {'basin': 'Kelani Ganga', 'alias': [], 'up': []},
    'Holombuwa':        {'basin': 'Kelani Ganga', 'alias': [], 'up': []},
    'Glencourse':       {'basin': 'Kelani Ganga', 'alias': ['Glen Course'], 'up': ['Kithulgala', 'Deraniyagala']},
    'Hanwella':         {'basin': 'Kelani Ganga', 'alias': [], 'up': ['Glencourse', 'Holombuwa']},
    'Nagalagam Street': {'basin': 'Kelani Ganga', 'alias': ["N' Street", 'N Street', 'Nagalagam St', "N'Street"], 'up': ['Hanwella']},
    # kalu ganga
    'Rathnapura':       {'basin': 'Kalu Ganga', 'alias': ['Ratnapura'], 'up': []},
    'Magura':           {'basin': 'Kalu Ganga', 'alias': [], 'up': []},
    'Ellagawa':         {'basin': 'Kalu Ganga', 'alias': [], 'up': ['Rathnapura']},
    'Kalawellawa (Millakanda)': {'basin': 'Kalu Ganga', 'alias': ['Kalawellawa', 'Millakanda'], 'up': []},
    'Putupaula':        {'basin': 'Kalu Ganga', 'alias': ['Putupawla'], 'up': ['Ellagawa', 'Magura', 'Kalawellawa (Millakanda)']},
    # gin ganga
    'Thawalama':        {'basin': 'Gin Ganga', 'alias': ['Tawalama'], 'up': []},
    'Baddegama':        {'basin': 'Gin Ganga', 'alias': [], 'up': ['Thawalama']},
    # nilwala ganga
    'Pitabeddara':      {'basin': 'Nilwala Ganga', 'alias': ['Pitabaddara'], 'up': []},
    'Urawa':            {'basin': 'Nilwala Ganga', 'alias': [], 'up': []},
    'Panadugama':       {'basin': 'Nilwala Ganga', 'alias': [], 'up': ['Pitabeddara']},
    'Thalgahagoda':     {'basin': 'Nilwala Ganga', 'alias': ['Talgahagoda'], 'up': ['Panadugama', 'Urawa']},
    # walawe / kirindi / menik / kumbukkan / heda
    'Moraketiya':       {'basin': 'Walawe Ganga', 'alias': [], 'up': []},
    'Wellawaya':        {'basin': 'Kirindi Oya', 'alias': [], 'up': []},
    'Kuda Oya':         {'basin': 'Kirindi Oya', 'alias': [], 'up': []},
    'Thanamalwila':     {'basin': 'Kirindi Oya', 'alias': ['Tanamalwila'], 'up': ['Wellawaya', 'Kuda Oya']},
    'Katharagama':      {'basin': 'Menik Ganga', 'alias': ['Kataragama'], 'up': []},
    'Nakkala':          {'basin': 'Kumbukkan Oya', 'alias': [], 'up': []},
    'Siyambalanduwa':   {'basin': 'Heda Oya', 'alias': [], 'up': []},
    # mahaweli
    'Nawalapitiya':     {'basin': 'Mahaweli Ganga', 'alias': [], 'up': []},
    'Peradeniya':       {'basin': 'Mahaweli Ganga', 'alias': [], 'up': ['Nawalapitiya']},
    'Thaldena':         {'basin': 'Mahaweli Ganga', 'alias': [], 'up': []},
    'Weraganthota':     {'basin': 'Mahaweli Ganga', 'alias': ['Weragantota'], 'up': ['Thaldena']},
    'Manampitiya':      {'basin': 'Mahaweli Ganga', 'alias': [], 'up': ['Weraganthota']},
    'Padiyathalawa':    {'basin': 'Maduru Oya', 'alias': ['Padiyatalawa'], 'up': []},
    # north / west
    'Moragaswewa':      {'basin': 'Deduru Oya', 'alias': [], 'up': []},
    'Galgamuwa':        {'basin': 'Mee Oya', 'alias': [], 'up': []},
    'Giriulla':         {'basin': 'Maha Oya', 'alias': [], 'up': []},
    'Badalgama':        {'basin': 'Maha Oya', 'alias': [], 'up': ['Giriulla']},
    'Dunamale':         {'basin': 'Aththanagalu Oya', 'alias': [], 'up': []},
    'Thanthirimale':    {'basin': 'Malwathu Oya', 'alias': ['Tantirimale'], 'up': []},
    'Yaka Wewa':        {'basin': 'Ma Oya', 'alias': ['Yakawewa'], 'up': []},
    'Horowpothana':     {'basin': 'Yan Oya', 'alias': ['Horowpathana', 'Horowpatana'], 'up': []},
    'Ampara':           {'basin': 'Gal Oya', 'alias': [], 'up': []},
}
