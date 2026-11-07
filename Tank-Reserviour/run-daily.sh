#!/bin/sh
# The scripts read three different names for the same DB settings
export PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGDATABASE="$DB_NAME" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD"
export APIDBHOST="$DB_HOST" APIDBPORT="$DB_PORT" APIDATABASE="$DB_NAME" APIDBUSERN="$DB_USER" APIDBPASSWORD="$DB_PASSWORD"
for script in reservious_daily.py get-mahaweli-tank-data.py get-realtime-rainfall.py get-realtime-river-levels.py; do
  echo "=== $(date +%T) $script"
  python "$script"
  echo "exit code $?"
done
# new farms and moved pins only; skips itself when the DEM folder is not mounted
echo "=== $(date +%T) farm flood risk"
python farm_risk/score_farms.py
echo "exit code $?"
