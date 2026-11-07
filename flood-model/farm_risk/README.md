# Farm river flood risk

Gives every farm a river flood risk score from 0 to 100 and a category, based on where the field sits compared with the rivers around it. Results go to the `farm_flood_risk` table.

| Score | Category |
|---|---|
| 70–100 | `very_high` |
| 50–69 | `high` |
| 30–49 | `medium` |
| 15–29 | `low` |
| 0–14 | `very_low` |

## How a farm is scored

For each river within 6 km of the farm:

1. **Farm level.** The 12.5 m DEM at the pin (median of the 3×3 cells around it). If the farmer drew the field boundary, it uses the lowest quarter of the field instead, because that part floods first.
2. **River level.** The river's normal water level at its point nearest the farm.
3. **Rise needed.** How far the river must rise to reach the field: the farm's height above the river, or the height of any high ground in between if that is higher. High ground only counts if it is at least 60 m wide. Tree belts, houses and narrow flood bunds are ignored, because the radar DEM sees treetops and bunds can breach.
4. **Height score.** Comes from the rise needed. The anchors are the DMC river gauges: across 38 gauges, the median rise above the river's normal level is
   - 3.0 m for alert,
   - 4.3 m for a minor flood,
   - 5.9 m for a major flood.

   | Rise needed | Height score |
   |---|---|
   | ≤ 0.5 m | 100 |
   | 3.0 m | 80 |
   | 4.3 m | 60 |
   | 5.9 m | 40 |
   | 9 m | 10 |
   | ≥ 12 m | 0 |
5. **Distance and river size.** The height score is reduced with distance from the river. Big rivers' floods spread further, from about 250 m for a 30 km² stream to 2.5 km for the Mahaweli. Small streams also count for less. Both come from the catchment area upstream of that river point.

The rivers are combined as independent sources: `risk = 1 − (1 − r1)(1 − r2)…`. The `rivers` column lists the top 5 rivers, each with its distance, the rise needed and its part of the score.

This is flood **susceptibility**: it says which fields flood first and worst when the rivers rise, not when that will happen. It does not include tank spills, canals or rainwater ponding.

## Known limits

- **The DEM shows treetops and roofs.** In villages and towns, ground heights can come out 5–20 m too high, so the risk there is too low. Open paddy fields are measured well.
- **Thresholds come from gauges, not from mapped floods.** Check them against reality once real farms are registered:
  ```
  python score_farms.py --report
  ```
  This compares the scores with what farmers said about past floods (`farms.flood_history`).
- **Rivers come from OpenStreetMap.** Main rivers are complete. Some small streams are missing.

## Files

- `score_farms.py` scores new farms and moved pins; the jobs container runs it every 30 minutes.
  - `--all` rescores every farm.
  - `--at lat,lon` scores one spot and only prints the result.
- `dem.py` reads the DEM tiles.
- `rivers_lk.json.gz` holds every OSM river as points 50 m apart, each with its normal water level and catchment area.
- `build_rivers.py` rebuilds that river file. It needs `pysheds`, and is only worth re-running when the DEM or the OSM rivers change.
- `test_spots.py` scores well-known places, to sanity-check changes to the method.

These are local only and git-ignored:

- `../dem/` holds the 44 unzipped DEM tiles, the default `--dem` folder.
- `../data/farm_risk/` holds the inputs used to build and calibrate:
  - `rivers_osm.json`: the OpenStreetMap river download (`build_rivers.py --osm`).
  - `catchment_200m.tif`: the catchment area grid.
  - `gauges_calibration.csv`: the gauge flood levels the height anchors came from.

To set up Python locally:

```
pip install numpy scipy rasterio psycopg2-binary
```

Add `pysheds` only if you need to run `build_rivers.py`.

## Server setup (one time)

1. Copy the 44 unzipped `ALOS_DEM_T*.tif` tiles (244 MB) to `flood-model/dem/` in the project folder on the server:
   ```
   scp *.tif ubuntu@SERVER:/home/ubuntu/yala-mahaa/flood-model/dem/
   ```
   To keep them somewhere else, set `FLOOD_DEM_DIR` in `.env`.
2. Rebuild the jobs image:
   ```
   docker compose build jobs
   ```
   The cron entry you already have then scores farms on every run. The table is created on the first run.

Without the tiles, the step prints "skipping" and the other jobs run as normal.
