// sends one sms per farmer and logs it as a campaign (sms_campaigns + sms_messages).
// used by the admin portal's "Send message" and the automatic flood alerts.
const db = require('../config/db.js')
const { sendSms, validateSriLankanMobile } = require('./smsService.js')

// farmers: [{ full_name, phone }]. {{name}} in the message becomes each farmer's name.
// adminId is null for automatic sends
async function sendCampaign({ adminId = null, label, message, farmers }) {
  const text = message.trim()
  let delivered = 0
  let failed = 0
  let dryRun = false
  const sent = []
  for (const f of farmers) {
    const phone = validateSriLankanMobile(f.phone).normalized
    try {
      const r = await sendSms(f.phone, text.replace(/\{\{\s*name\s*\}\}/g, f.full_name))
      if (r?.dryRun) dryRun = true
      delivered += 1
      // Text.lk answers with the message's uid and first status
      const d = r?.data || {}
      sent.push({ phone, uid: d.uid || null, status: r?.dryRun ? 'Dry run' : String(d.status || 'Sent'), sms_count: d.sms_count ?? null, cost: d.cost ?? null, error: null })
    } catch (e) {
      console.error(`[SMS campaign] ${f.phone}: ${e.message}`)
      failed += 1
      sent.push({ phone, uid: null, status: 'Failed', sms_count: null, cost: null, error: e.message.slice(0, 300) })
    }
  }

  const saved = await db.query(
    `INSERT INTO sms_campaigns (admin_id, audience, message, recipients, delivered, failed, dry_run)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at`,
    [adminId, label, text, farmers.length, delivered, failed, dryRun]
  )
  await db.query(
    `INSERT INTO sms_messages (campaign_id, phone, uid, status, sms_count, cost, error)
     SELECT $1, x.phone, x.uid, x.status, x.sms_count, x.cost, x.error
     FROM json_to_recordset($2) AS x(phone text, uid text, status text, sms_count int, cost numeric, error text)`,
    [saved.rows[0].id, JSON.stringify(sent)]
  )
  return { ...saved.rows[0], audience: label, recipients: farmers.length, delivered, failed, dry_run: dryRun }
}

module.exports = { sendCampaign }
