CREATE TABLE IF NOT EXISTS mahawelitanks (
  id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tank_name          TEXT NOT NULL UNIQUE,
  tot_capacity_mcm   NUMERIC(10,3) NOT NULL CHECK (tot_capacity_mcm > 0),
  covered_land_acres NUMERIC(12,2) CHECK (covered_land_acres >= 0),
  latitude           NUMERIC(10,6) CHECK (latitude  BETWEEN -90  AND 90),   -- set by hand, not by get-mahaweli-tank-data.py
  longitude          NUMERIC(10,6) CHECK (longitude BETWEEN -180 AND 180),
  createdat          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mahaweli_water_level (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tank_id            INTEGER NOT NULL REFERENCES mahawelitanks(id) ON DELETE CASCADE,
  reading_date       DATE NOT NULL,
  water_level_msl    NUMERIC(7,2),
  storage_mcm        NUMERIC(10,3) CHECK (storage_mcm >= 0),
  storage_percentage NUMERIC(5,2) CHECK (storage_percentage >= 0),
  rainfall_24h_mm    NUMERIC(6,1) CHECK (rainfall_24h_mm >= 0),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tank_day UNIQUE (tank_id, reading_date)
);

CREATE INDEX IF NOT EXISTS idx_water_level_date ON mahaweli_water_level (reading_date DESC);

CREATE TABLE reservoirs (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  district           TEXT,          -- Range
  division           TEXT,
  latitude           NUMERIC(10,6),
  longitude          NUMERIC(10,6),
  farmland_acres       NUMERIC,
  full_depth_ft NUMERIC,
  gross_capacity_acft  NUMERIC,
  dead_storage_acft    NUMERIC,
  active_capacity_acft NUMERIC,
  type               TEXT,          -- 'medium' or 'major'
  UNIQUE (name, latitude, longitude)
);

CREATE TABLE reservoir_levels (
  id                    SERIAL PRIMARY KEY,
  reservoir_id          INT NOT NULL REFERENCES reservoirs(id),
  reading_date          DATE NOT NULL,
  water_depth_ft        NUMERIC,
  gross_storage_acft    NUMERIC,
  usable_storage_acft   NUMERIC,
  usable_storage_percent NUMERIC,
  rainfall_prev_day_mm  NUMERIC,    -- NULL when "-"
  is_spilling            TEXT,
  ds_impact              TEXT,      -- "Yes"/"No"
  spilling_rate_cusec         NUMERIC,      -- NULL if not spilling or not reported
  fetched_at            TIMESTAMP DEFAULT now(),
  UNIQUE (reservoir_id, reading_date)
);
CREATE INDEX idx_levels_lookup ON reservoir_levels (reservoir_id, reading_date DESC);


--This is just the schemas for all of API Related Databases !!!  -D3n3th
--TODO   - ADD ANOTHER TABLE TO STORE RAIN_DATA
--CREATE A DATABASES WITH : 
CREATE TABLE IF NOT EXISTS farmers (
  farmer_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id         TEXT NOT NULL UNIQUE                           -- shown to the farmer, e.g. FAR-3FEEFE
                  DEFAULT ('FAR-' || upper(substr(md5(gen_random_uuid()::text), 1, 6)))
                  CHECK (farm_id ~ '^FAR-[0-9A-F]{6}$'),
  full_name       TEXT NOT NULL,
  hashed_nic      TEXT unique not NULL,
  phone           TEXT unique not NULL,
  address         TEXT not NULL,
  district        TEXT not NULL,
  division        TEXT,                                          -- Divisional Secretariat
  farm_latitude   NUMERIC(10,6) CHECK (farm_latitude  BETWEEN -90  AND 90),
  farm_longitude  NUMERIC(10,6) CHECK (farm_longitude BETWEEN -180 AND 180),

  -- Water source: a reservoir OR a tank, never both (both NULL is allowed)
  reservoir_id    INTEGER REFERENCES reservoirs(id)    ON DELETE SET NULL,
  tank_id         INTEGER REFERENCES mahawelitanks(id) ON DELETE SET NULL,

  land_acres      NUMERIC(10,2) CHECK (land_acres >= 0),
  primary_crop    TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_single_water_source
    CHECK (reservoir_id IS NULL OR tank_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_farmers_reservoir ON farmers (reservoir_id);
CREATE INDEX IF NOT EXISTS idx_farmers_tank      ON farmers (tank_id);
CREATE INDEX IF NOT EXISTS idx_farmers_district  ON farmers (district, division);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_farmers_updated_at ON farmers;
CREATE TRIGGER trg_farmers_updated_at
  BEFORE UPDATE ON farmers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Farm details, one farm per farmer (farmers.farm_id). land_acres and primary_crop on
-- farmers are kept as the total and the first crop of farm_crops.
CREATE TABLE IF NOT EXISTS farms (
  farm_id         TEXT PRIMARY KEY REFERENCES farmers(farm_id) ON DELETE CASCADE ON UPDATE CASCADE,
  water_source    TEXT CHECK (water_source IN ('tank', 'canal', 'river', 'well', 'rain')),
  water_name      TEXT,           -- tank / canal / river name as the farmer gave it
  location_label  TEXT,           -- nearest place to the farm pin, as shown in the portal
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_farms_updated_at ON farms;
CREATE TRIGGER trg_farms_updated_at
  BEFORE UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A farm can grow several crops
CREATE TABLE IF NOT EXISTS farm_crops (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_id     TEXT NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE ON UPDATE CASCADE,
  position    SMALLINT NOT NULL CHECK (position >= 0),   -- order the farmer listed them; 0 is the main crop
  category    TEXT,                                      -- 'paddy', 'vegetables', ... (NULL if not known)
  crop_type   TEXT NOT NULL,
  variety     TEXT,
  acres       NUMERIC(10,2) NOT NULL CHECK (acres > 0),
  last_yield  NUMERIC(12,2) CHECK (last_yield >= 0),     -- per acre, in yield_unit
  yield_unit  TEXT CHECK (yield_unit IN ('kg', 'bu', 't')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_farm_crop_position UNIQUE (farm_id, position)
);




  -- for farmer sessions,

CREATE TABLE IF NOT EXISTS farmer_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id          UUID NOT NULL REFERENCES farmers(farmer_id) ON DELETE CASCADE,
  refresh_token_hash CHAR(64) NOT NULL UNIQUE
                     CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 hex of the token
  family_id          UUID NOT NULL DEFAULT gen_random_uuid(),         -- groups tokens from one login chain (rotation)
  ip                 INET NOT NULL,
  user_agent         TEXT NOT NULL,
  revoked            BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at         TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_farmer  ON farmer_sessions (farmer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_family  ON farmer_sessions (family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON farmer_sessions (expires_at);


CREATE TABLE IF NOT EXISTS admins (
  admin_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      TEXT NOT NULL,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,    -- Argon2 or bcrypt
  role           TEXT NOT NULL CHECK (role IN ('officer', 'admin', 'super_admin')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);

-- Admin portal sign-ins (refresh tokens), like farmer_sessions
CREATE TABLE IF NOT EXISTS admin_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id           UUID NOT NULL REFERENCES admins(admin_id) ON DELETE CASCADE,
  refresh_token_hash CHAR(64) NOT NULL UNIQUE
                     CHECK (refresh_token_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 hex of the token
  ip                 INET NOT NULL,
  user_agent         TEXT NOT NULL,
  revoked_at         TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin   ON admin_sessions (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);




CREATE TABLE IF NOT EXISTS river_level_realtime (
    global_id TEXT PRIMARY KEY,
    basin TEXT,
    gauge TEXT,
    station TEXT,
    water_level DOUBLE PRECISION,
    rain_fall DOUBLE PRECISION,
    creation_date TIMESTAMPTZ,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    alertpull DOUBLE PRECISION,
    minorpull DOUBLE PRECISION,
    majorpull DOUBLE PRECISION,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rainfall_realtime (
    global_id TEXT PRIMARY KEY,
    basin TEXT,
    gauge TEXT,
    station TEXT,
    rain_fall DOUBLE PRECISION,
    creation_date TIMESTAMPTZ,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    alertpull DOUBLE PRECISION,
    minorpull DOUBLE PRECISION,
    majorpull DOUBLE PRECISION,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Mahaweli water issue schedule, loaded by Tank-Reserviour/add-cropcalendertodb.py
CREATE TABLE IF NOT EXISTS water_issue_schedule (
    id SERIAL PRIMARY KEY,
    no INT,
    tank_name TEXT NOT NULL,
    section TEXT,
    initial_extent_ha NUMERIC,
    water_start DATE,
    water_end DATE,
    paddy_target_days INT,
    paddy_target_area NUMERIC,
    paddy_area_percentage NUMERIC,
    other_crops_target_days INT,
    other_crops_target_area NUMERIC,
    other_crops_area_percentage NUMERIC,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tank_section_start UNIQUE NULLS NOT DISTINCT (tank_name, section, water_start)
);

-- SMS campaigns sent from the admin portal (one row per send)
CREATE TABLE IF NOT EXISTS sms_campaigns (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id    UUID REFERENCES admins(admin_id) ON DELETE SET NULL,
  audience    TEXT NOT NULL,
  message     TEXT NOT NULL,
  recipients  INT NOT NULL CHECK (recipients >= 0),
  delivered   INT NOT NULL DEFAULT 0 CHECK (delivered >= 0),
  failed      INT NOT NULL DEFAULT 0 CHECK (failed >= 0),
  dry_run     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_campaigns_created ON sms_campaigns (created_at DESC);

-- One row per SMS a campaign sent, with Text.lk's message id for its real delivery status
CREATE TABLE IF NOT EXISTS sms_messages (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id  BIGINT NOT NULL REFERENCES sms_campaigns(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  uid          TEXT,
  status       TEXT NOT NULL,
  sms_count    INT,
  cost         NUMERIC,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_campaign ON sms_messages (campaign_id);


-- Canal problems reported by farmers, and their photos (see models/add-canal-reports.sql)
CREATE TABLE IF NOT EXISTS canal_reports (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- shown to farmers as REP-000123
  -- Kept when a farmer is deleted, so the department's record stays complete
  farmer_id       UUID REFERENCES farmers(farmer_id) ON DELETE SET NULL,
  farm_id         TEXT REFERENCES farmers(farm_id) ON UPDATE CASCADE ON DELETE SET NULL,
  issue_type      TEXT NOT NULL CHECK (issue_type IN ('blockage', 'leak', 'gate', 'no_water', 'other')),
  -- The canal from the water issue schedule, or a name the farmer typed when it wasn't listed
  schedule_id     INT REFERENCES water_issue_schedule(id) ON DELETE SET NULL,
  canal_name      TEXT NOT NULL CHECK (length(canal_name) BETWEEN 1 AND 120),
  scheme          TEXT,
  latitude        NUMERIC(10,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude       NUMERIC(10,6) CHECK (longitude BETWEEN -180 AND 180),
  description     TEXT CHECK (length(description) <= 1000),
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'forwarded', 'in_progress', 'resolved', 'rejected')),
  -- Filled in by admins when the report is passed on to the Irrigation Department
  forwarded_at    TIMESTAMPTZ,
  forwarded_to    TEXT,                                               -- office name, email or phone
  forwarded_by    UUID REFERENCES admins(admin_id) ON DELETE SET NULL,
  admin_note      TEXT CHECK (length(admin_note) <= 1000),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_canal_reports_farmer  ON canal_reports (farmer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canal_reports_status  ON canal_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canal_reports_scheme  ON canal_reports (scheme);

DROP TRIGGER IF EXISTS trg_canal_reports_updated_at ON canal_reports;
CREATE TRIGGER trg_canal_reports_updated_at BEFORE UPDATE ON canal_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Up to 3 photos per report (the API enforces the limit)
CREATE TABLE IF NOT EXISTS canal_report_photos (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id   BIGINT NOT NULL REFERENCES canal_reports(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL UNIQUE,                 -- random name given by the API, e.g. 3f9c...e1.jpg
  mime_type   TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes  INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canal_report_photos_report ON canal_report_photos (report_id);


-- SMS reminders before a water issue starts (services/reminderJob.js)

CREATE TABLE IF NOT EXISTS water_reminders (
  farmer_id    UUID NOT NULL REFERENCES farmers(farmer_id) ON DELETE CASCADE,
  schedule_id  INT  NOT NULL REFERENCES water_issue_schedule(id) ON DELETE CASCADE,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (farmer_id, schedule_id)
);

CREATE INDEX IF NOT EXISTS idx_water_reminders_unsent ON water_reminders (schedule_id) WHERE sent_at IS NULL;


-- Automatic flood alert SMS from the river gauges (services/floodAlertJob.js)
-- Settings changed from the admin portal
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES admins(admin_id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_settings (key, value) VALUES ('flood_auto_alerts', 'true') ON CONFLICT (key) DO NOTHING;

-- One row per gauge: which messages this flood has already sent.
-- Both reset once the river is back below the alert level.
CREATE TABLE IF NOT EXISTS gauge_alert_state (
  basin             TEXT NOT NULL,
  station           TEXT NOT NULL,
  alert_sent_at     TIMESTAMPTZ,
  major_sent_at     TIMESTAMPTZ,
  alert_campaign_id BIGINT REFERENCES sms_campaigns(id) ON DELETE SET NULL,
  major_campaign_id BIGINT REFERENCES sms_campaigns(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (basin, station)
);
