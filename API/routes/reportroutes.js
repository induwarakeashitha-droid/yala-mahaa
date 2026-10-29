// canal problem reports from farmers (/api/reports)
//   POST /                        multipart: issue_type, schedule_id or canal_name, description, latitude, longitude + up to 3 "photos"
//   GET  /                        my reports
//   GET  /:id/photos/:photoId     a photo from my own report
const express = require('express')
const db = require('../config/db.js')
const requireFarmer = require('../middleware/requireFarmer.js')
const {
  receivePhotos, cleanPhoto, savePhoto, sendPhoto, removePhotos, PhotoError
} = require('../services/reportPhotos.js')

const reportrouter = express.Router()

const ISSUE_TYPES = ['blockage', 'leak', 'gate', 'no_water', 'other']
const REPORTS_PER_DAY = 10

// security: strips control chars and enforces max length on form text
function cleanText(val, max, { multiline = false } = {}) {
  if (val === undefined || val === null) return null
  if (typeof val !== 'string') return undefined
  const pat = multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g
  const txt = val.replace(pat, ' ').trim()
  if (txt.length > max) return undefined
  return txt || null
}

const coord = (val, limit) => {
  if (val === undefined || val === null || val === '') return null
  const n = Number(val)
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 1e6) / 1e6 : undefined
}

const publicReport = (row) => ({
  id: row.id,
  code: `REP-${String(row.id).padStart(6, '0')}`,
  issue_type: row.issue_type,
  canal_name: row.canal_name,
  scheme: row.scheme,
  description: row.description,
  latitude: row.latitude,
  longitude: row.longitude,
  status: row.status,
  admin_note: row.admin_note,
  forwarded_at: row.forwarded_at,
  resolved_at: row.resolved_at,
  created_at: row.created_at,
  photos: row.photos || []
})

reportrouter.post('/', requireFarmer, receivePhotos, async (req, res, next) => {
  const saved = []
  try {
    const body = req.body || {}
    const files = req.files || []

    const farmer = await db.query(
      'SELECT farmer_id, farm_id, farm_latitude, farm_longitude, is_active FROM farmers WHERE farmer_id = $1',
      [req.farmerId]
    )
    if (!farmer.rows[0] || !farmer.rows[0].is_active) {
      return res.status(403).json({ status: 'fail', message: 'This account cannot send reports.' })
    }
    // security: max 10 reports a day per farmer so nobody can spam reports / fill the disk with photos
    const recent = await db.query(
      `SELECT count(*)::int AS n FROM canal_reports WHERE farmer_id = $1 AND created_at > now() - interval '1 day'`,
      [req.farmerId]
    )
    if (recent.rows[0].n >= REPORTS_PER_DAY) {
      return res.status(429).json({ status: 'fail', message: 'You have sent many reports today. Try again tomorrow.' })
    }

    if (!ISSUE_TYPES.includes(body.issue_type)) {
      return res.status(400).json({ status: 'fail', message: 'Choose what is wrong with the canal.' })
    }
    const desc = cleanText(body.description, 1000, { multiline: true })
    if (desc === undefined) {
      return res.status(400).json({ status: 'fail', message: 'Keep the description to 1000 characters.' })
    }

    // canal from the schedule list, or a typed name
    let canalName = null
    let scheme = null
    let schedId = null
    if (body.schedule_id !== undefined && body.schedule_id !== '') {
      if (!/^\d{1,9}$/.test(String(body.schedule_id))) {
        return res.status(400).json({ status: 'fail', message: 'Choose a canal from the list.' })
      }
      const canal = await db.query('SELECT id, tank_name, section FROM water_issue_schedule WHERE id = $1', [Number(body.schedule_id)])
      if (!canal.rows[0]) {
        return res.status(400).json({ status: 'fail', message: 'That canal is not in the list any more. Choose it again.' })
      }
      const { id, tank_name: tank, section } = canal.rows[0]
      schedId = id
      scheme = tank
      canalName = section ? `${tank} - ${section}` : `${tank} canals`
    } else {
      canalName = cleanText(body.canal_name, 120)
      if (!canalName) {
        return res.status(400).json({ status: 'fail', message: 'Say which canal has the problem.' })
      }
    }

    let lat = coord(body.latitude, 90)
    let lng = coord(body.longitude, 180)
    if (lat === undefined || lng === undefined || (lat === null) !== (lng === null)) {
      return res.status(400).json({ status: 'fail', message: 'The location is not valid.' })
    }
    // no location sent -> use the farm pin
    if (lat === null) {
      lat = farmer.rows[0].farm_latitude
      lng = farmer.rows[0].farm_longitude
    }

    // check + re-encode every photo before saving anything
    const photos = []
    for (const f of files) photos.push(await cleanPhoto(f))

    const client = await db.pool.connect()
    let rep
    try {
      await client.query('BEGIN')
      const ins = await client.query(
        `INSERT INTO canal_reports (farmer_id, farm_id, issue_type, schedule_id, canal_name, scheme, latitude, longitude, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [req.farmerId, farmer.rows[0].farm_id, body.issue_type, schedId, canalName, scheme, lat, lng, desc]
      )
      rep = ins.rows[0]
      rep.photos = []
      for (const p of photos) {
        const fname = await savePhoto(p)
        saved.push(fname)
        const row = await client.query(
          `INSERT INTO canal_report_photos (report_id, file_name, mime_type, size_bytes)
           VALUES ($1, $2, 'image/jpeg', $3) RETURNING id`,
          [rep.id, fname, p.length]
        )
        rep.photos.push({ id: row.rows[0].id })
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }

    return res.status(201).json({ status: 'success', message: 'Report received.', data: publicReport(rep) })
  } catch(err){
    // delete any files already written so nothing is half saved
    if (saved.length) await removePhotos(saved)
    if (err instanceof PhotoError) {
      return res.status(err.status).json({ status: 'fail', message: err.message })
    }
    return next(err)
  }
})

reportrouter.get('/', requireFarmer, async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT r.*,
              coalesce((SELECT json_agg(json_build_object('id', p.id) ORDER BY p.id)
                        FROM canal_report_photos p WHERE p.report_id = r.id), '[]') AS photos
       FROM canal_reports r
       WHERE r.farmer_id = $1
       ORDER BY r.created_at DESC
       LIMIT 100`,
      [req.farmerId]
    )
    return res.status(200).json({ status: 'success', data: r.rows.map(publicReport) })
  } catch (err) {
    return next(err)
  }
})

reportrouter.get('/:id/photos/:photoId', requireFarmer, async (req, res, next) => {
  try {
    if (!/^\d{1,18}$/.test(req.params.id) || !/^\d{1,18}$/.test(req.params.photoId)) {
      return res.status(404).json({ status: 'fail', message: 'Photo not found.' })
    }
    // security: ownership check - only the farmer who sent the report can get its photos (stops IDOR)
    const r = await db.query(
      `SELECT p.file_name FROM canal_report_photos p JOIN canal_reports r ON r.id = p.report_id
       WHERE p.id = $1 AND r.id = $2 AND r.farmer_id = $3`,
      [req.params.photoId, req.params.id, req.farmerId]
    )
    if (!r.rows[0]) {
      return res.status(404).json({ status: 'fail', message: 'Photo not found.' })
    }
    return sendPhoto(res, r.rows[0].file_name)
  }catch(err){
    if (err instanceof PhotoError) return res.status(err.status).json({ status: 'fail', message: err.message })
    return next(err)
  }
})

module.exports = reportrouter
