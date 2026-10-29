const express = require('express')
const db = require('../../config/db.js')
const smsrouter = express.Router()
const { runAlertCheck } = require('../../services/alertservice.js')
const {
  sendSms,
  getSmsStatus,
  getBalance,
  sendRegistrationConfirmation
} = require('../../services/smsService.js')
const { sendCampaign } = require('../../services/campaignService.js')

// Text.lk statuses that won't change any more
const FINAL = ['Delivered', 'Undelivered', 'Failed', 'Rejected', 'Expired', 'Dry run']
const STATUS_REFRESH_MS = 60 * 1000
const BALANCE_CACHE_MS = 60 * 1000
let lastRefresh = 0
let balanceCache = null


// dry run, just shows what would be sent
smsrouter.route('/alerts/preview').get(async (req, res, next) => {
  try {
    res.json(await runAlertCheck({ send: false }))
  } catch (e) {
    next(e)
  }
})

// actually sends
smsrouter.route('/alerts/check').post(async (req, res, next) => {
  try {
    res.json(await runAlertCheck({ send: true }))
  } catch (e) {
    next(e)
  }
})

// registration confirmation sms
smsrouter.route('/confirm-registration').post(async (req, res, next) => {
  try {
    const { phone, farmerName, farmId, acres, forceLive } = req.body || {}
    if (!phone) {
      return res.status(400).json({ status: 'fail', message: 'Phone number is required.' })
    }
    const result = await sendRegistrationConfirmation(phone, { farmerName, farmId, acres }, { forceLive })
    res.status(200).json({ status: 'success', data: result })
  } catch (e) {
    next(e)
  }
})

// live credit balance from Text.lk, cached for a minute
async function accountBalance() {
  if (!process.env.TEXTLK_API_TOKEN) return null
  if (balanceCache && Date.now() - balanceCache.at < BALANCE_CACHE_MS) return balanceCache.data
  try {
    const b = await getBalance()
    const data = { credits: Number(b.remaining_balance), expires: b.expired_on || null, error: null }
    balanceCache = { at: Date.now(), data }
    return data
  } catch (e) {
    return { credits: null, expires: null, error: e.message }
  }
}

// security: gateway info for the portal - only says if a token is set, never sends the token
smsrouter.route('/status').get(async (req, res, next) => {
  try {
    res.status(200).json({
      status: 'success',
      data: {
        provider: 'Text.lk',
        senderId: process.env.TEXTLK_SENDER_ID || 'TextLKDemo',
        configured: Boolean(process.env.TEXTLK_API_TOKEN),
        dryRun: process.env.SMS_DRY_RUN === 'true',
        alertThreshold: Number(process.env.ALERT_THRESHOLD) || 90,
        balance: await accountBalance()
      }
    })
  } catch (e) {
    next(e)
  }
})

// asks Text.lk again about messages still on their way (last 3 days, at most once a minute)
async function refreshStatuses() {
  if (!process.env.TEXTLK_API_TOKEN || Date.now() - lastRefresh < STATUS_REFRESH_MS) return
  lastRefresh = Date.now()
  const open = await db.query(
    `SELECT id, uid FROM sms_messages
     WHERE uid IS NOT NULL AND NOT (status = ANY($1)) AND created_at > now() - INTERVAL '3 days'
     ORDER BY created_at DESC LIMIT 50`,
    [FINAL]
  )
  await Promise.all(open.rows.map(async (m) => {
    try {
      const d = await getSmsStatus(m.uid)
      await db.query(
        'UPDATE sms_messages SET status = $2, sms_count = $3, cost = $4, checked_at = now() WHERE id = $1',
        [m.id, String(d.status || 'Sent'), d.sms_count ?? null, d.cost ?? null]
      )
    } catch (e) {
      await db.query('UPDATE sms_messages SET checked_at = now() WHERE id = $1', [m.id])
    }
  }))
}

const MAX_CAMPAIGN_RECIPIENTS = 500

// type: all | district | reservoir | tank | farmer | farmers, value = name, id or list of farmer ids. active farmers only
async function audienceFarmers(aud) {
  const type = aud?.type
  const val = aud?.value
  if (type === 'all') {
    return db.query('SELECT full_name, phone FROM farmers WHERE is_active')
  }
  if (type === 'district' && val) {
    return db.query('SELECT full_name, phone FROM farmers WHERE is_active AND district ILIKE $1', [String(val)])
  }
  // security: type is checked to be exactly reservoir/tank before it goes in the column name, value is a $1 param
  if ((type === 'reservoir' || type === 'tank') && Number.isInteger(Number(val))) {
    return db.query(`SELECT full_name, phone FROM farmers WHERE is_active AND ${type}_id = $1`, [Number(val)])
  }
  if (type === 'farmer' && val) {
    return db.query('SELECT full_name, phone FROM farmers WHERE farmer_id::text = $1', [String(val)])
  }
  // farmers picked one by one in the portal. security: only uuids, as one array param
  if (type === 'farmers' && Array.isArray(val) && val.length && val.length <= MAX_CAMPAIGN_RECIPIENTS && val.every(isUuid)) {
    return db.query('SELECT full_name, phone FROM farmers WHERE is_active AND farmer_id = ANY($1::uuid[])', [[...new Set(val)]])
  }
  return null
}

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

smsrouter.route('/audiences').get(async (req, res, next) => {
  try {
    const [all, dists, resvs, tanks] = await Promise.all([
      db.query('SELECT count(*)::int AS n FROM farmers WHERE is_active'),
      db.query(`SELECT initcap(district) AS name, count(*)::int AS farmers FROM farmers WHERE is_active
                GROUP BY initcap(district) ORDER BY farmers DESC, name`),
      db.query(`SELECT r.id, r.name, count(*)::int AS farmers FROM farmers f JOIN reservoirs r ON r.id = f.reservoir_id
                WHERE f.is_active GROUP BY r.id ORDER BY farmers DESC, r.name`),
      db.query(`SELECT t.id, t.tank_name AS name, count(*)::int AS farmers FROM farmers f JOIN mahawelitanks t ON t.id = f.tank_id
                WHERE f.is_active GROUP BY t.id ORDER BY farmers DESC, t.tank_name`)
    ])
    res.status(200).json({
      status: 'success',
      data: {
        all: all.rows[0].n,
        districts: dists.rows,
        reservoirs: resvs.rows,
        tanks: tanks.rows
      }
    })
  } catch (e) {
    next(e)
  }
})

smsrouter.route('/campaigns').get(async (req, res, next) => {
  try {
    await refreshStatuses().catch((e) => console.error(`[SMS status] ${e.message}`))
    // delivered = accepted by Text.lk; handset_* = what Text.lk says happened on the phone.
    // tracked = how many messages have a row here (campaigns sent before tracking have none)
    const r = await db.query(
      `SELECT c.id, c.audience, c.message, c.recipients, c.delivered, c.failed, c.dry_run, c.created_at,
              a.full_name AS sent_by,
              count(m.id) FILTER (WHERE m.uid IS NOT NULL OR m.status = 'Dry run')::int AS tracked,
              count(m.id) FILTER (WHERE m.status = 'Delivered')::int AS handset_delivered,
              count(m.id) FILTER (WHERE m.uid IS NOT NULL AND NOT (m.status = ANY($1)))::int AS handset_pending,
              count(m.id) FILTER (WHERE m.uid IS NOT NULL AND m.status = ANY($1) AND m.status NOT IN ('Delivered', 'Dry run'))::int AS handset_failed,
              coalesce(sum(m.cost), 0)::float AS cost,
              coalesce(sum(m.sms_count), 0)::int AS sms_parts
       FROM sms_campaigns c
       LEFT JOIN admins a ON a.admin_id = c.admin_id
       LEFT JOIN sms_messages m ON m.campaign_id = c.id
       GROUP BY c.id, a.full_name
       ORDER BY c.created_at DESC LIMIT 200`,
      [FINAL]
    )
    res.status(200).json({ status: 'success', data: r.rows })
  } catch (e) {
    next(e)
  }
})

// one sms per farmer ({{name}} -> their name), then logs the campaign
smsrouter.route('/campaigns').post(async (req, res, next) => {
  try {
    const { audience, audienceLabel, message } = req.body || {}
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ status: 'fail', message: 'Write a message first.' })
    }
    // security: caps message length + recipients so one request can't run up a huge sms bill
    if (message.length > 640) {
      return res.status(400).json({ status: 'fail', message: 'Keep the message to 640 characters (4 SMS).' })
    }
    const farmers = await audienceFarmers(audience)
    if (!farmers) {
      return res.status(400).json({ status: 'fail', message: 'Choose who gets the message.' })
    }
    if (farmers.rows.length === 0) {
      return res.status(400).json({ status: 'fail', message: 'No active farmers in this group.' })
    }
    if (farmers.rows.length > MAX_CAMPAIGN_RECIPIENTS) {
      return res.status(400).json({ status: 'fail', message: `This group has ${farmers.rows.length} farmers; send to at most ${MAX_CAMPAIGN_RECIPIENTS} at a time.` })
    }

    const label = typeof audienceLabel === 'string' && audienceLabel.trim() ? audienceLabel.trim().slice(0, 120) : String(audience.type)
    const result = await sendCampaign({ adminId: req.admin.admin_id, label, message, farmers: farmers.rows })
    balanceCache = null
    res.status(201).json({ status: 'success', data: result })
  } catch (e) {
    next(e)
  }
})

// automatic flood alert sms (services/floodAlertJob.js): the on/off switch and what each flood has sent
smsrouter.route('/auto-alerts')
  .get(async (req, res, next) => {
    try {
      const setting = await db.query(
        `SELECT s.value, s.updated_at, a.full_name AS updated_by
         FROM app_settings s LEFT JOIN admins a ON a.admin_id = s.updated_by
         WHERE s.key = 'flood_auto_alerts'`
      )
      const active = await db.query(
        `SELECT basin, station, alert_sent_at, major_sent_at, alert_campaign_id, major_campaign_id
         FROM gauge_alert_state
         WHERE alert_sent_at IS NOT NULL OR major_sent_at IS NOT NULL
         ORDER BY greatest(alert_sent_at, major_sent_at) DESC`
      )
      const row = setting.rows[0]
      res.status(200).json({
        status: 'success',
        data: {
          enabled: row ? row.value === true : true,
          updated_at: row?.updated_at || null,
          updated_by: row?.updated_by || null,
          active: active.rows
        }
      })
    } catch (e) {
      next(e)
    }
  })
  .put(async (req, res, next) => {
    try {
      const { enabled } = req.body || {}
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ status: 'fail', message: 'enabled must be true or false.' })
      }
      await db.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('flood_auto_alerts', $1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [JSON.stringify(enabled), req.admin.admin_id]
      )
      res.status(200).json({ status: 'success', data: { enabled } })
    } catch (e) {
      next(e)
    }
  })

// custom sms / direct message
smsrouter.route('/send-custom').post(async (req, res, next) => {
  try {
    const { recipients, message, forceLive } = req.body || {}
    if (!recipients || !message) {
      return res.status(400).json({ status: 'fail', message: 'Recipients and message are required.' })
    }
    const result = await sendSms(recipients, message, { forceLive })
    res.status(200).json({ status: 'success', data: result })
  } catch (e) {
    next(e)
  }
})



module.exports = smsrouter