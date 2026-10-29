// canal reports for the admin portal (/admin/reports)
//   GET    /?status=&issue_type=&q=&page=&limit=
//   GET    /:id
//   PATCH  /:id                      status, admin_note, forwarded_to
//   DELETE /:id                      report + its photo files
//   GET    /:id/photos/:photoId
const express = require('express')
const db = require('../../config/db.js')
const { canEdit } = require('../../middleware/requireAdmin.js')
const { sendPhoto, removePhotos } = require('../../services/reportPhotos.js')
const { sendDbError } = require('./dbErrors.js')

const adminreportrouter = express.Router()

const STATUSES = ['new', 'forwarded', 'in_progress', 'resolved', 'rejected']
const ISSUE_TYPES = ['blockage', 'leak', 'gate', 'no_water', 'other']
const MAX_PAGE_SIZE = 100
// security: ids must be plain digits before they reach a query
const isId = (val) => /^\d{1,18}$/.test(val)

const REPORT_SELECT = `
  SELECT r.id, 'REP-' || lpad(r.id::text, 6, '0') AS code, r.issue_type, r.schedule_id, r.canal_name, r.scheme,
         r.latitude, r.longitude, r.description, r.status, r.forwarded_at, r.forwarded_to, r.admin_note,
         r.resolved_at, r.created_at, r.updated_at, r.farmer_id, r.farm_id,
         f.full_name AS farmer_name, f.phone AS farmer_phone, initcap(f.district) AS district,
         a.full_name AS forwarded_by_name,
         coalesce((SELECT json_agg(json_build_object('id', p.id) ORDER BY p.id)
                   FROM canal_report_photos p WHERE p.report_id = r.id), '[]') AS photos
  FROM canal_reports r
  LEFT JOIN farmers f ON f.farmer_id = r.farmer_id
  LEFT JOIN admins a ON a.admin_id = r.forwarded_by`

adminreportrouter.get('/', async (req, res, next) => {
  try {
    const { status, issue_type, q } = req.query
    const where = []
    const params = []
    // security: filters are whitelisted and every value goes in as a $n param (no sql injection)
    if (status) {
      if (!STATUSES.includes(status)) return res.status(400).json({ status: 'fail', message: 'Unknown status.' })
      params.push(status)
      where.push(`r.status = $${params.length}`)
    }
    if (issue_type) {
      if (!ISSUE_TYPES.includes(issue_type)) return res.status(400).json({ status: 'fail', message: 'Unknown issue type.' })
      params.push(issue_type)
      where.push(`r.issue_type = $${params.length}`)
    }
    if (typeof q === 'string' && q.trim()) {
      params.push(`%${q.trim()}%`)
      const n = params.length
      where.push(`(r.canal_name ILIKE $${n} OR r.scheme ILIKE $${n} OR r.description ILIKE $${n} OR f.full_name ILIKE $${n}
                   OR f.district ILIKE $${n} OR r.farm_id ILIKE $${n} OR 'REP-' || lpad(r.id::text, 6, '0') ILIKE $${n})`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), MAX_PAGE_SIZE)
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1)

    const [rows, total, cnts] = await Promise.all([
      db.query(`${REPORT_SELECT} ${whereSql} ORDER BY r.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params),
      db.query(`SELECT count(*)::int AS n FROM canal_reports r LEFT JOIN farmers f ON f.farmer_id = r.farmer_id ${whereSql}`, params),
      db.query(`SELECT status, count(*)::int AS n FROM canal_reports GROUP BY status`)
    ])
    return res.status(200).json({
      status: 'success',
      page,
      limit,
      total: total.rows[0].n,
      counts: Object.fromEntries(STATUSES.map(s => [s, cnts.rows.find(row => row.status === s)?.n || 0])),
      data: rows.rows
    })
  } catch (err) {
    return next(err)
  }
})

adminreportrouter.get('/:id', async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ status: 'fail', message: 'Report not found.' })
    const r = await db.query(`${REPORT_SELECT} WHERE r.id = $1`, [req.params.id])
    if (!r.rows[0]) return res.status(404).json({ status: 'fail', message: 'Report not found.' })
    return res.status(200).json({ status: 'success', data: r.rows[0] })
  }catch(err){
    return next(err)
  }
})

// forwarded -> saves who + when, resolved -> saves when. farmer sees status + note in the app
adminreportrouter.patch('/:id', canEdit, async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ status: 'fail', message: 'Report not found.' })
    const { status, admin_note, forwarded_to } = req.body || {}
    const sets = []
    const params = [req.params.id]
    const set = (sql, val) => { params.push(val); sets.push(sql.replace('?', `$${params.length}`)) }

    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ status: 'fail', message: 'Unknown status.' })
      set('status = ?', status)
      if (status === 'forwarded') {
        sets.push('forwarded_at = coalesce(forwarded_at, now())')
        set('forwarded_by = coalesce(forwarded_by, ?::uuid)', req.admin.admin_id)
      }
      sets.push(status === 'resolved' ? 'resolved_at = coalesce(resolved_at, now())' : 'resolved_at = NULL')
    }
    // security: note fields - control chars stripped and length capped
    for (const [fld, val, max] of [['admin_note', admin_note, 1000], ['forwarded_to', forwarded_to, 200]]) {
      if (val === undefined) continue
      if (val !== null && typeof val !== 'string') return res.status(400).json({ status: 'fail', message: `${fld} must be text.` })
      const txt = val?.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim() || null
      if (txt && txt.length > max) return res.status(400).json({ status: 'fail', message: `${fld} is too long (${max} characters at most).` })
      set(`${fld} = ?`, txt)
    }
    if (!sets.length) return res.status(400).json({ status: 'fail', message: 'Nothing to update.' })

    const upd = await db.query(`UPDATE canal_reports SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, params)
    if (!upd.rows[0]) return res.status(404).json({ status: 'fail', message: 'Report not found.' })
    const r = await db.query(`${REPORT_SELECT} WHERE r.id = $1`, [req.params.id])
    return res.status(200).json({ status: 'success', message: 'Report updated.', data: r.rows[0] })
  } catch (err) {
    return sendDbError(res, next, err)
  }
})

adminreportrouter.delete('/:id', canEdit, async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ status: 'fail', message: 'Report not found.' })
    const photos = await db.query('SELECT file_name FROM canal_report_photos WHERE report_id = $1', [req.params.id])
    const del = await db.query('DELETE FROM canal_reports WHERE id = $1 RETURNING id', [req.params.id])
    if (!del.rows[0]) return res.status(404).json({ status: 'fail', message: 'Report not found.' })
    await removePhotos(photos.rows.map(row => row.file_name))
    return res.status(200).json({ status: 'success', message: 'Report deleted.' })
  } catch (err) {
    return next(err)
  }
})

adminreportrouter.get('/:id/photos/:photoId', async (req, res, next) => {
  try {
    if (!isId(req.params.id) || !isId(req.params.photoId)) return res.status(404).json({ status: 'fail', message: 'Photo not found.' })
    // photo has to belong to this report
    const r = await db.query(
      'SELECT file_name FROM canal_report_photos WHERE id = $1 AND report_id = $2',
      [req.params.photoId, req.params.id]
    )
    if (!r.rows[0]) return res.status(404).json({ status: 'fail', message: 'Photo not found.' })
    return sendPhoto(res, r.rows[0].file_name)
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ status: 'fail', message: 'Photo not found.' })
    return next(err)
  }
})

module.exports = adminreportrouter
