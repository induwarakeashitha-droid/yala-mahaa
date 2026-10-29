-- SMS reminders a farmer turned on for a water issue (water_issue_schedule row).
-- services/reminderJob.js sends one the day before water_start and sets sent_at.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS water_reminders (
  farmer_id    UUID NOT NULL REFERENCES farmers(farmer_id) ON DELETE CASCADE,
  schedule_id  INT  NOT NULL REFERENCES water_issue_schedule(id) ON DELETE CASCADE,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (farmer_id, schedule_id)
);

CREATE INDEX IF NOT EXISTS idx_water_reminders_unsent ON water_reminders (schedule_id) WHERE sent_at IS NULL;
