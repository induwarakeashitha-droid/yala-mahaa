// data for the admin portal pages (/admin/data)
//   GET  /reservoirs                 every reservoir, latest reading + 30 days history
//   POST /reservoirs/:id/readings    log a field reading
//   GET  /rivers                     gauges, latest + last 24h
//   GET  /schedule                   mahaweli water issue schedule
//   GET  /farmer-stats
const express = require('express')
const db = require('../../config/db.js')
const { canEdit } = require('../../middleware/requireAdmin.js')
const { sendDbError } = require('./dbErrors.js')

const datarouter = express.Router()

const HISTORY_DAYS = 30
// days with fewer reservoirs reporting than this are skipped in the network average
const MIN_DAILY_READINGS = 20

datarouter.get('/reservoirs', async(req, res, next)=>{
  try {
    const resvs = await db.query(
      `SELECT r.id, r.name, r.district, r.division, r.latitude, r.longitude, r.type,
              r.farmland_acres, r.full_depth_ft, r.gross_capacity_acft, r.dead_storage_acft, r.active_capacity_acft,
              to_char(l.reading_date, 'YYYY-MM-DD') AS reading_date, l.water_depth_ft, l.gross_storage_acft,
              l.usable_storage_acft, l.usable_storage_percent, l.rainfall_prev_day_mm, l.is_spilling,
              l.ds_impact, l.spilling_rate_cusec
       FROM reservoirs r
       LEFT JOIN LATERAL (
         SELECT * FROM reservoir_levels WHERE reservoir_id = r.id ORDER BY reading_date DESC LIMIT 1
       ) l ON true
       ORDER BY r.name`
    )
    const hist = await db.query(
      `SELECT reservoir_id, to_char(reading_date, 'YYYY-MM-DD') AS date,
              usable_storage_percent AS percent, water_depth_ft AS depth, rainfall_prev_day_mm AS rainfall
       FROM reservoir_levels
       WHERE reading_date >= CURRENT_DATE - $1::int
       ORDER BY reading_date`,
      [HISTORY_DAYS]
    )
    // not every reservoir reports daily, so each day takes each reservoir's latest reading from the week before.
    // rainfall = highest reported that day
    const daily = await db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date, count(*)::int AS reservoirs,
              round(avg(l.usable_storage_percent), 1) AS storage,
              count(*) FILTER (WHERE l.is_spilling = 'Yes' AND l.reading_date = d)::int AS spilling,
              (SELECT max(rainfall_prev_day_mm) FROM reservoir_levels WHERE reading_date = d) AS rainfall
       FROM generate_series(CURRENT_DATE - $1::int, CURRENT_DATE, interval '1 day') AS g(day)
       CROSS JOIN LATERAL (SELECT g.day::date AS d) dd
       CROSS JOIN reservoirs r
       JOIN LATERAL (
         SELECT usable_storage_percent, is_spilling, reading_date FROM reservoir_levels
         WHERE reservoir_id = r.id AND reading_date <= d AND reading_date > d - 7
         ORDER BY reading_date DESC LIMIT 1
       ) l ON true
       GROUP BY d HAVING count(*) >= $2
       ORDER BY d`,
      [HISTORY_DAYS, MIN_DAILY_READINGS]
    )

    const byResv = {}
    for (const row of hist.rows) {
      (byResv[row.reservoir_id] ||= []).push({ date: row.date, percent: row.percent, depth: row.depth, rainfall: row.rainfall })
    }
    return res.status(200).json({
      status: 'success',
      data: resvs.rows.map(row => ({ ...row, history: byResv[row.id] || [] })),
      daily: daily.rows
    })
  } catch (err) {
    return next(err)
  }
})

const toNum = (val) => (val === '' || val === null || val === undefined ? null : Number(val))

// body: usable_storage_percent, water_depth_ft, rainfall_prev_day_mm?, reading_date? (default today)
// same day again = replaces it
datarouter.post('/reservoirs/:id/readings', canEdit, async (req, res, next) => {
  try {
    const body = req.body || {}
    const pct = toNum(body.usable_storage_percent)
    const depth = toNum(body.water_depth_ft)
    const rain = toNum(body.rainfall_prev_day_mm)
    // security: range checks on every number + date format so junk can't get into the readings
    if (pct === null || !Number.isFinite(pct) || pct < 0 || pct > 150) {
      return res.status(400).json({ status: 'fail', message: 'Usable storage must be a percentage between 0 and 150.' })
    }
    if (depth === null || !Number.isFinite(depth) || depth < 0) {
      return res.status(400).json({ status: 'fail', message: 'Water depth must be 0 ft or more.' })
    }
    if (rain !== null && (!Number.isFinite(rain) || rain < 0)) {
      return res.status(400).json({ status: 'fail', message: 'Rainfall must be 0 mm or more.' })
      }
    const date = body.reading_date || new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || Date.parse(date) > Date.now()) {
      return res.status(400).json({ status: 'fail', message: 'Reading date must be a past date (YYYY-MM-DD).' })
    }

    const resv = await db.query('SELECT id, active_capacity_acft, dead_storage_acft FROM reservoirs WHERE id = $1', [req.params.id])
    if (!resv.rows[0]) {
      return res.status(404).json({ status: 'fail', message: 'Reservoir not found.' })
    }
    const { active_capacity_acft: active, dead_storage_acft: dead } = resv.rows[0]
    const usable = active != null ? Math.round((pct / 100) * Number(active)) : null
    const gross = usable != null ? usable + Number(dead || 0) : null

    const r = await db.query(
      `INSERT INTO reservoir_levels (reservoir_id, reading_date, water_depth_ft, gross_storage_acft, usable_storage_acft,
                                     usable_storage_percent, rainfall_prev_day_mm, is_spilling)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (reservoir_id, reading_date) DO UPDATE SET
         water_depth_ft = EXCLUDED.water_depth_ft, gross_storage_acft = EXCLUDED.gross_storage_acft,
         usable_storage_acft = EXCLUDED.usable_storage_acft, usable_storage_percent = EXCLUDED.usable_storage_percent,
         rainfall_prev_day_mm = EXCLUDED.rainfall_prev_day_mm, is_spilling = EXCLUDED.is_spilling, fetched_at = now()
       RETURNING reservoir_id, to_char(reading_date, 'YYYY-MM-DD') AS reading_date, water_depth_ft, gross_storage_acft,
                 usable_storage_acft, usable_storage_percent, rainfall_prev_day_mm, is_spilling`,
      [req.params.id, date, depth, gross, usable, pct, rain, pct >= 100 ? 'Yes' : 'No']
    )
    return res.status(201).json({ status: 'success', message: 'Reading saved.', data: r.rows[0] })
  } catch(err){
    return sendDbError(res, next, err)
  }
})

datarouter.get('/rivers', async (req, res, next) => {
  try {
    const latest = await db.query(
      `SELECT DISTINCT ON (basin, station)
              basin, station, latitude, longitude, water_level, rain_fall,
              alertpull, minorpull, majorpull, creation_date
       FROM river_level_realtime
       WHERE basin IS NOT NULL AND station IS NOT NULL
       ORDER BY basin, station, creation_date DESC`
    )
    // 24h before the newest reading (not now) so charts still work if the loader is behind
    const hist = await db.query(
      `SELECT basin, station, water_level, rain_fall, creation_date
       FROM river_level_realtime
       WHERE station IS NOT NULL
         AND creation_date >= (SELECT max(creation_date) FROM river_level_realtime) - interval '24 hours'
       ORDER BY creation_date`
    )
    // each rain report = rain since that station's last report, so 24h total is the sum
    const rain = await db.query(
      `SELECT station, basin, round(sum(rain_fall)::numeric, 1) AS rain_total, max(creation_date) AS creation_date
       FROM rainfall_realtime
       WHERE rain_fall IS NOT NULL AND creation_date >= now() - interval '24 hours'
       GROUP BY station, basin
       ORDER BY rain_total DESC LIMIT 1`
    )

    const series = {}
    for (const row of hist.rows) {
      (series[`${row.basin}|${row.station}`] ||= []).push({ level: row.water_level, rainfall: row.rain_fall, at: row.creation_date })
    }
    return res.status(200).json({
      status: 'success',
      data: latest.rows.map(row => ({
        river: row.basin,
        station: row.station,
        latitude: row.latitude,
        longitude: row.longitude,
        water_level: row.water_level,
        rain_fall: row.rain_fall,
        alert_level: row.alertpull,
        minor_flood_level: row.minorpull,
        major_flood_level: row.majorpull,
        reading_at: row.creation_date,
        history: series[`${row.basin}|${row.station}`] || []
      })),
      topRainfall: rain.rows[0] || null
    })
  }catch(err){
    return next(err)
  }
})

datarouter.get('/schedule', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT id, no, tank_name, section, initial_extent_ha,
              to_char(water_start, 'YYYY-MM-DD') AS water_start, to_char(water_end, 'YYYY-MM-DD') AS water_end,
              paddy_target_days, paddy_target_area, paddy_area_percentage,
              other_crops_target_days, other_crops_target_area, other_crops_area_percentage
       FROM water_issue_schedule
       ORDER BY water_start NULLS LAST, tank_name, section NULLS FIRST`
    )
    return res.status(200).json({ status: 'success', data: r.rows })
  } catch (err) {
    return next(err)
  }
})

datarouter.get('/farmer-stats', async (req,res,next) => {
  try {
    const [totals, dists, months, crops, srcs] = await Promise.all([
      db.query(
        `SELECT count(*)::int AS registered,
                count(*) FILTER (WHERE is_active)::int AS active,
                count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_this_month,
                count(*) FILTER (WHERE created_at >= date_trunc('month', now()) - interval '1 month'
                                   AND created_at < date_trunc('month', now()))::int AS new_last_month,
                count(DISTINCT district)::int AS districts,
                coalesce(sum(land_acres), 0) AS total_acres
         FROM farmers`
      ),
      db.query(
        `SELECT initcap(district) AS district, count(*)::int AS farmers, count(*) FILTER (WHERE is_active)::int AS active
         FROM farmers GROUP BY initcap(district) ORDER BY farmers DESC, district`
      ),
      db.query(
        `SELECT to_char(m, 'YYYY-MM') AS month,
                count(f.farmer_id)::int AS farmers,
                count(f.farmer_id) FILTER (WHERE f.is_active)::int AS active
         FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
         LEFT JOIN farmers f ON date_trunc('month', f.created_at) = m
         GROUP BY m ORDER BY m`
      ),
      // by category (paddy, vegetables..). a farmer with 2 crops counts for both
      db.query(
        `SELECT coalesce(nullif(c.category, ''), 'not_given') AS crop,
                count(DISTINCT f.farmer_id)::int AS farmers
         FROM farmers f LEFT JOIN farm_crops c ON c.farm_id = f.farm_id
         GROUP BY 1 ORDER BY farmers DESC, crop`
      ),
      db.query(
        `SELECT coalesce(fm.water_source, 'unknown') AS source, count(*)::int AS farmers
         FROM farmers f LEFT JOIN farms fm ON fm.farm_id = f.farm_id
         GROUP BY 1 ORDER BY farmers DESC`
      )
    ])
    return res.status(200).json({
      status: 'success',
      data: {
        ...totals.rows[0],
        byDistrict: dists.rows,
        byMonth: months.rows,
        crops: crops.rows,
        waterSources: srcs.rows
      }
    })
  }catch(err){
    return next(err)
  }
})

module.exports = datarouter
