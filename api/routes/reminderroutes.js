// SMS reminders before a canal's water issue starts (/api/reminders)
//   GET    /              my reminders
//   POST   /              { schedule_id }  remind me the day before that issue starts
//   DELETE /:scheduleId   stop that reminder
// the SMS itself goes out from services/reminderJob.js
const express = require('express')
const db = require('../config/db.js')
const requireFarmer = require('../middleware/requireFarmer.js')

const reminderrouter = express.Router()

const MAX_PENDING = 10
const SL_TODAY = `(now() AT TIME ZONE 'Asia/Colombo')::date`

const validId = (id) => /^[1-9]\d{0,8}$/.test(String(id))

const publicReminder = (row) => ({
  schedule_id: row.schedule_id,
  scheme: row.tank_name,
  section: row.section,
  water_start: row.water_start,
  water_end: row.water_end,
  sent_at: row.sent_at,
  created_at: row.created_at
})

reminderrouter.get('/', requireFarmer, async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT m.schedule_id, m.sent_at, m.created_at, w.tank_name, w.section,
              to_char(w.water_start, 'YYYY-MM-DD') AS water_start,
              to_char(w.water_end, 'YYYY-MM-DD') AS water_end
       FROM water_reminders m
       JOIN water_issue_schedule w ON w.id = m.schedule_id
       WHERE m.farmer_id = $1
       ORDER BY w.water_start DESC`,
      [req.farmerId]
    )
    return res.status(200).json({ status: 'success', data: r.rows.map(publicReminder) })
  } catch (err) {
    return next(err)
  }
})

reminderrouter.post('/', requireFarmer, async (req, res, next) => {
  const scheduleId = req.body?.schedule_id
  // security: plain positive int only
  if (!validId(scheduleId)) {
    return res.status(400).json({ status: 'fail', message: 'schedule_id must be a positive integer.' })
  }

  try {
    const sched = await db.query(
      `SELECT id, water_start > ${SL_TODAY} AS upcoming FROM water_issue_schedule WHERE id = $1`,
      [scheduleId]
    )
    if (!sched.rows[0]) {
      return res.status(404).json({ status: 'fail', message: 'That water issue was not found.' })
    }
    if (!sched.rows[0].upcoming) {
      return res.status(400).json({ status: 'fail', message: 'That water issue has already started.' })
    }

    // security: cap pending reminders so one account can't queue up lots of sms
    const pending = await db.query(
      'SELECT count(*)::int AS n FROM water_reminders WHERE farmer_id = $1 AND sent_at IS NULL',
      [req.farmerId]
    )
    if (pending.rows[0].n >= MAX_PENDING) {
      return res.status(429).json({ status: 'fail', message: `You can have up to ${MAX_PENDING} reminders waiting.` })
    }

    await db.query(
      `INSERT INTO water_reminders (farmer_id, schedule_id) VALUES ($1, $2)
       ON CONFLICT (farmer_id, schedule_id) DO NOTHING`,
      [req.farmerId, scheduleId]
    )
    return res.status(201).json({ status: 'success', data: { schedule_id: Number(scheduleId) } })
  } catch (err) {
    // 23503 = farmer row is gone
    if (err.code === '23503') return res.status(401).json({ status: 'fail', message: 'Account not found.' })
    return next(err)
  }
})

reminderrouter.delete('/:scheduleId', requireFarmer, async (req, res, next) => {
  if (!validId(req.params.scheduleId)) {
    return res.status(400).json({ status: 'fail', message: 'schedule id must be a positive integer.' })
  }
  try {
    await db.query(
      'DELETE FROM water_reminders WHERE farmer_id = $1 AND schedule_id = $2',
      [req.farmerId, req.params.scheduleId]
    )
    return res.status(204).end()
  } catch (err) {
    return next(err)
  }
})

module.exports = reminderrouter
