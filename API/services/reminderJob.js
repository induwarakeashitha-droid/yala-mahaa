// sends the water issue sms reminders farmers turned on (routes/reminderroutes.js).
// runs every hour; a reminder goes out the day before water_start, after 7am Sri Lanka time.
const db = require('../config/db.js')
const logger = require('../utils/logger.js')
const { sendSms } = require('./smsService.js')

const EVERY_MS = 60 * 60 * 1000

const fmtDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

async function sendDue() {
  // claim rows first (sent_at set) so two api instances can't both send the same one
  const due = await db.query(
    `UPDATE water_reminders m SET sent_at = now()
     FROM water_issue_schedule w, farmers f
     WHERE w.id = m.schedule_id AND f.farmer_id = m.farmer_id
       AND m.sent_at IS NULL AND f.is_active
       AND w.water_start = (now() AT TIME ZONE 'Asia/Colombo')::date + 1
       AND extract(hour FROM now() AT TIME ZONE 'Asia/Colombo') >= 7
     RETURNING m.farmer_id, m.schedule_id, f.phone, w.tank_name, w.section,
               to_char(w.water_start, 'YYYY-MM-DD') AS water_start,
               to_char(w.water_end, 'YYYY-MM-DD') AS water_end`
  )

  for (const r of due.rows) {
    const canal = r.section ? `${r.tank_name} ${r.section}` : r.tank_name
    const msg = `Yala Maha: Water issue for ${canal} starts tomorrow (${fmtDay(r.water_start)}) and runs until ${fmtDay(r.water_end)}.`
    try {
      await sendSms(r.phone, msg)
    } catch (err) {
      // put it back so the next run tries again
      logger.error(`reminder sms failed (schedule ${r.schedule_id}): ${err.message}`)
      await db.query(
        'UPDATE water_reminders SET sent_at = NULL WHERE farmer_id = $1 AND schedule_id = $2',
        [r.farmer_id, r.schedule_id]
      ).catch(() => {})
    }
  }
  return due.rows.length
}

function startReminderJob() {
  const run = () => sendDue()
    .then((n) => { if (n) logger.info(`sent ${n} water issue reminder(s)`) })
    .catch((err) => logger.error(`reminder job failed: ${err.message}`))
  run()
  return setInterval(run, EVERY_MS)
}

module.exports = { startReminderJob, sendDue }
