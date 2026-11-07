FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir psycopg2-binary pdfplumber tzdata numpy scipy rasterio
COPY Tank-Reserviour/ ./
# farm flood risk score; needs the DEM tiles mounted at FLOOD_DEM_DIR (see docker-compose.yml)
COPY flood-model/farm_risk/dem.py flood-model/farm_risk/score_farms.py flood-model/farm_risk/rivers_lk.json.gz ./farm_risk/
ENV PYTHONUTF8=1
CMD ["sh", "run-daily.sh"]
