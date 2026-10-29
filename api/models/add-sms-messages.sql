-- One row per SMS a campaign sent, with Text.lk's message id so its real delivery status
-- can be fetched later (routes/ADMIN/alertroutes.js). Safe to run more than once.

CREATE TABLE IF NOT EXISTS sms_messages (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id  BIGINT NOT NULL REFERENCES sms_campaigns(id) ON DELETE CASCADE,
  phone        TEXT NOT NULL,
  uid          TEXT,                 -- Text.lk message id, null for dry runs and failed sends
  status       TEXT NOT NULL,        -- Text.lk's status (Delivered, Sent, Undelivered…), or Failed / Dry run
  sms_count    INT,
  cost         NUMERIC,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_campaign ON sms_messages (campaign_id);
