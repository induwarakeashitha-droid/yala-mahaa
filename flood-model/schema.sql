-- flood model tables. run: psql -d yala-maha-api -f flood-model/schema.sql

-- one row per gauge per DMC water level report
CREATE TABLE IF NOT EXISTS dmc_river_levels (
    id            BIGSERIAL PRIMARY KEY,
    station       TEXT NOT NULL,          -- same name as river_level_realtime.station
    basin         TEXT,
    reading_at    TIMESTAMPTZ NOT NULL,   -- time of the "level at" column
    water_level   DOUBLE PRECISION,
    level_1h_before DOUBLE PRECISION,
    unit          TEXT,                   -- m, or ft for Nagalagam Street (same as the live feed)
    alert_level   DOUBLE PRECISION,       -- thresholds as printed that day, they change over the years
    minor_flood_level DOUBLE PRECISION,
    major_flood_level DOUBLE PRECISION,
    remarks       TEXT,                   -- Normal / Alert / Minor Flood / Major Flood
    trend         TEXT,                   -- Rising / Falling / null
    rain_mm       DOUBLE PRECISION,
    rain_hours    INT,                    -- rain_mm covers this many hours (3, or 24 in the 9:30 report)
    source_file   TEXT NOT NULL,
    UNIQUE (station, reading_at)
);
CREATE INDEX IF NOT EXISTS dmc_river_levels_at ON dmc_river_levels (reading_at);

-- flood warnings + withdrawals from the Irrigation Dept (via DMC)
CREATE TABLE IF NOT EXISTS dmc_flood_warnings (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL,            -- warning / withdrawal
    basin       TEXT,                     -- one row per basin named in the notice
    issued_at   TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ,
    warning_no  INT,
    colour      TEXT,                     -- Yellow / Amber / Red
    title       TEXT,
    source_file TEXT NOT NULL,
    UNIQUE (source_file, basin)
);
CREATE INDEX IF NOT EXISTS dmc_flood_warnings_at ON dmc_flood_warnings (issued_at);

-- hourly rain at each gauge from outside sources (open-meteo era5, imerg)
CREATE TABLE IF NOT EXISTS gauge_rain_hourly (
    station   TEXT NOT NULL,
    at        TIMESTAMPTZ NOT NULL,
    source    TEXT NOT NULL,              -- era5 / imerg
    rain_mm   DOUBLE PRECISION,
    PRIMARY KEY (station, at, source)
);
