-- Automatic flood alert SMS from the river gauges (services/floodAlertJob.js). Safe to run more than once.

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
