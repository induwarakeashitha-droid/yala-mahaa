// automatic flood alert sms from the Irrigation Department river gauges (river_level_realtime).
// per gauge and per flood: one message when it reaches the alert level (or minor flood),
// and one more only if it reaches the major flood level. Back below the alert level resets it.
// turned on / off from the admin portal (app_settings.flood_auto_alerts).
const db = require('../config/db.js')
const logger = require('../utils/logger.js')
const { sendCampaign } = require('./campaignService.js')
const { validateSriLankanMobile } = require('./smsService.js')

const EVERY_MS = 10 * 60 * 1000
const NEAR_KM = 20
const STALE_MS = 3 * 60 * 60 * 1000
// a farmer near two gauges of the same flooding river gets one alert, not one per gauge
const REPEAT_WINDOW = '12 hours'
const LABEL = 'Auto flood alert'

async function autoAlertsOn() {
  const r = await db.query("SELECT value FROM app_settings WHERE key = 'flood_auto_alerts'")
  return r.rows[0] ? r.rows[0].value === true : true
}

function km(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// last two level readings of every gauge that has flood levels
async function gauges() {
  const r = await db.query(
    `SELECT basin, station, latitude, longitude, alertpull, minorpull, majorpull,
            array_agg(water_level ORDER BY creation_date DESC) AS levels,
            max(creation_date) AS latest_at
     FROM (
       SELECT *, row_number() OVER (PARTITION BY basin, station ORDER BY creation_date DESC) AS n
       FROM river_level_realtime
       WHERE basin IS NOT NULL AND station IS NOT NULL AND water_level IS NOT NULL
     ) x
     WHERE n <= 2 AND (alertpull IS NOT NULL OR majorpull IS NOT NULL)
     GROUP BY basin, station, latitude, longitude, alertpull, minorpull, majorpull`
  )
  return r.rows.map((g) => {
    const num = (v) => (v == null ? null : Number(v))
    const [now, prev] = g.levels.map(Number)
    // both readings have to be over a level, so one bad reading doesn't send anything
    const sure = prev === undefined ? null : Math.min(now, prev)
    return {
      basin: g.basin, station: g.station,
      lat: num(g.latitude), lng: num(g.longitude),
      alert: num(g.alertpull), minor: num(g.minorpull), major: num(g.majorpull),
      level: now, sure, latestAt: new Date(g.latest_at),
      below: Math.max(now, prev ?? now) < (num(g.alertpull) ?? num(g.minorpull) ?? num(g.majorpull)),
    }
  })
}

// active farmers within NEAR_KM of the gauge, plus farmers who said they use this river and whose
// nearest gauge on it is this one (or who have no farm pin)
async function relatedFarmers(gauge, allGauges) {
  const r = await db.query(
    `SELECT f.full_name, f.phone, f.farm_latitude, f.farm_longitude, fm.water_source, fm.water_name
     FROM farmers f LEFT JOIN farms fm ON fm.farm_id = f.farm_id
     WHERE f.is_active`
  )
  const onRiver = allGauges.filter((g) => g.basin === gauge.basin && g.lat != null)
  return r.rows.filter((f) => {
    const pin = f.farm_latitude != null ? { lat: Number(f.farm_latitude), lng: Number(f.farm_longitude) } : null
    if (pin && gauge.lat != null && km(pin, gauge) <= NEAR_KM) return true
    if (f.water_source !== 'river' || f.water_name !== gauge.basin) return false
    if (!pin) return true
    const nearest = onRiver.reduce((best, g) => (!best || km(pin, g) < km(pin, best) ? g : best), null)
    return nearest?.station === gauge.station
  })
}

// kept short so it fits one 160-character sms
function messageFor(kind, g) {
  const where = `${g.basin} at ${g.station}`
  if (kind === 'major') {
    return `Yala Maha MAJOR FLOOD: ${where} reached major flood level (${g.level.toFixed(2)}m, Irrigation Dept). Move to higher ground now.`
  }
  const what = g.minor != null && g.sure >= g.minor ? 'minor flood level' : 'alert level'
  return `Yala Maha FLOOD ALERT: ${where} reached ${what} (${g.level.toFixed(2)}m, Irrigation Dept). Move livestock & pumps to high ground.`
}

// marks the message as sent before sending, so two api instances never both send it
async function claim(g, kind) {
  const col = kind === 'major' ? 'major_sent_at' : 'alert_sent_at'
  const r = await db.query(
    `INSERT INTO gauge_alert_state (basin, station, ${col}) VALUES ($1, $2, now())
     ON CONFLICT (basin, station) DO UPDATE SET ${col} = now(), updated_at = now()
     WHERE gauge_alert_state.${col} IS NULL
     RETURNING basin`,
    [g.basin, g.station]
  )
  return r.rowCount === 1
}

async function checkGauges() {
  const all = await gauges()
  const on = await autoAlertsOn()
  const sent = []

  for (const g of all) {
    if (Date.now() - g.latestAt > STALE_MS) continue

    // flood over: the next one gets its own messages
    if (g.below) {
      await db.query(
        `UPDATE gauge_alert_state SET alert_sent_at = NULL, major_sent_at = NULL, updated_at = now()
         WHERE basin = $1 AND station = $2 AND (alert_sent_at IS NOT NULL OR major_sent_at IS NOT NULL)`,
        [g.basin, g.station]
      )
      continue
    }
    if (!on || g.sure === null) continue

    let kind = null
    if (g.major != null && g.sure >= g.major) kind = 'major'
    else if (g.sure >= (g.alert ?? g.minor ?? Infinity)) kind = 'alert'
    if (!kind || !(await claim(g, kind))) continue
    // a major flood message also covers the alert one
    if (kind === 'major') await claim(g, 'alert')

    let farmers = await relatedFarmers(g, all)
    if (kind === 'alert') {
      const recent = await db.query(
        `SELECT DISTINCT m.phone FROM sms_messages m JOIN sms_campaigns c ON c.id = m.campaign_id
         WHERE c.audience LIKE $1 AND c.created_at > now() - $2::interval`,
        [`${LABEL} - ${g.basin}%`, REPEAT_WINDOW]
      )
      const had = new Set(recent.rows.map((x) => x.phone))
      farmers = farmers.filter((f) => !had.has(validateSriLankanMobile(f.phone).normalized))
    }
    if (!farmers.length) {
      logger.info(`flood ${kind} at ${g.basin}/${g.station}: no farmers to alert`)
      continue
    }

    const label = `${LABEL} - ${g.basin} at ${g.station} - ${kind === 'major' ? 'major flood' : 'alert level'}`
    const result = await sendCampaign({ label, message: messageFor(kind, g), farmers })
    await db.query(
      `UPDATE gauge_alert_state SET ${kind === 'major' ? 'major_campaign_id' : 'alert_campaign_id'} = $3
       WHERE basin = $1 AND station = $2`,
      [g.basin, g.station, result.id]
    )
    logger.info(`flood ${kind} sms: ${g.basin}/${g.station} to ${result.recipients} farmer(s)`)
    sent.push({ gauge: `${g.basin}/${g.station}`, kind, ...result })
  }
  return sent
}

function startFloodAlertJob() {
  const run = () => checkGauges().catch((err) => logger.error(`flood alert job failed: ${err.message}`))
  run()
  return setInterval(run, EVERY_MS)
}

module.exports = { startFloodAlertJob, checkGauges, autoAlertsOn }
