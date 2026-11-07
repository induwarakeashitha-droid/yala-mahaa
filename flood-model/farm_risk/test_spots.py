# scores well-known places to sanity-check the method: python test_spots.py [DEM folder]
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from score_farms import *
dem = Dem(sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent / 'dem'))
rv = Rivers(str(HERE / 'rivers_lk.json.gz'))
spots = [
 ('Ratnapura town (floods often)', 6.6828, 80.3992),
 ('Kelani floodplain, Kaduwela/Biyagama', 6.9400, 79.9800),
 ('Hanwella (Kelani)', 6.9090, 80.0850),
 ('Manampitiya Mahaweli floodplain', 7.9050, 81.0950),
 ('Polonnaruwa test farm', 8.1345, 80.9952),
 ('Vavuniya test farm', 8.7123, 80.4897),
 ('Kolonnawa (Kelani 2016 floods)', 6.9330, 79.8880),
 ('Kelani bank Malwana/Dompe', 6.9580, 80.0000),
 ('Polonnaruwa Mahaweli bank Somawathiya', 8.1260, 81.1720),
 ('Kandy city (hill by Mahaweli)', 7.2936, 80.6350),
 ('Nuwara Eliya', 6.9497, 80.7891),
 ('Dambulla', 7.8570, 80.6510),
 ('Anuradhapura old town', 8.3450, 80.3900),
]
for n,la,lo in spots:
    r = score_point(dem, rv, la, lo); t = r['rivers'][0] if r['rivers'] else {}
    print(f"{r['score']:3d} {r['category']:9s} {n:38s} elev {r['elevation_m']:6.1f}  {t.get('river') or '-'} d={t.get('distance_m')} above={t.get('farm_above_river_m')} rise={t.get('rise_needed_m')} A={t.get('catchment_km2')}")
