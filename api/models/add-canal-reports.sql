-- Canal problems reported by farmers ("Report canal problem" in the farmer portal), and their photos.
-- Photos are files (api/uploads/reports/ for now, object storage later); only their file names are stored here.
-- Also adds each farmer's SMS preference (farmers.sms_enabled), set from the farmer portal.
-- Safe to run more than once.

BEGIN;

ALTER TABLE farmers ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- An earlier version of this file made a simpler canal_reports (location, note, one photo in the row).
-- On such a database, set that table aside as canal_reports_v1; its reports are copied over below,
-- and scripts/move-old-report-photos.js then moves the photos and drops it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'canal_reports' AND column_name = 'location') THEN
    ALTER TABLE canal_reports RENAME TO canal_reports_v1;
    ALTER INDEX IF EXISTS idx_canal_reports_farmer RENAME TO idx_canal_reports_v1_farmer;
    ALTER INDEX IF EXISTS idx_canal_reports_status RENAME TO idx_canal_reports_v1_status;
    DROP TRIGGER IF EXISTS trg_canal_reports_updated_at ON canal_reports_v1;
  END IF;
END $$;

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

-- Reports from the earlier table, under the same ids (the photo script matches them by id)
DO $$
BEGIN
  IF to_regclass('public.canal_reports_v1') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM canal_reports) THEN
    INSERT INTO canal_reports (id, farmer_id, farm_id, issue_type, canal_name, description, status, created_at, updated_at)
    OVERRIDING SYSTEM VALUE
    SELECT r.id, r.farmer_id, f.farm_id, r.issue_type, left(r.location, 120), left(r.note, 1000),
           CASE r.status WHEN 'inProgress' THEN 'in_progress' WHEN 'fixed' THEN 'resolved' ELSE 'new' END,
           r.created_at, r.updated_at
    FROM canal_reports_v1 r LEFT JOIN farmers f ON f.farmer_id = r.farmer_id
    ORDER BY r.id;
    PERFORM setval(pg_get_serial_sequence('canal_reports', 'id'), (SELECT max(id) FROM canal_reports));
  END IF;
END $$;

COMMIT;
