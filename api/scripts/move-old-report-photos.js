// One-off: moves photos from the earlier canal_reports_v1 table (one JPEG per row) into the
// canal_report_photos files, then drops canal_reports_v1. Run after models/add-canal-reports.sql:
//   node scripts/move-old-report-photos.js
// Does nothing when there is no canal_reports_v1.
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', 'config.env') })
const db = require('../config/db.js')
const { savePhoto } = require('../services/reportPhotos.js')

;(async () => {
  const old = await db.query("SELECT to_regclass('public.canal_reports_v1') AS t")
  if (!old.rows[0].t) {
    console.log('No canal_reports_v1 table, nothing to move.')
    return
  }
  const rows = await db.query(
    `SELECT v.id, v.photo FROM canal_reports_v1 v
     JOIN canal_reports r ON r.id = v.id
     WHERE v.photo IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM canal_report_photos p WHERE p.report_id = v.id)`
  )
  for (const row of rows.rows) {
    // The earlier portal already resized and re-encoded these as JPEG
    const fileName = await savePhoto(row.photo)
    await db.query(
      `INSERT INTO canal_report_photos (report_id, file_name, mime_type, size_bytes) VALUES ($1, $2, 'image/jpeg', $3)`,
      [row.id, fileName, row.photo.length]
    )
    console.log(`Report ${row.id}: photo saved as ${fileName}`)
  }
  const missing = await db.query('SELECT count(*)::int AS n FROM canal_reports_v1 v WHERE NOT EXISTS (SELECT 1 FROM canal_reports r WHERE r.id = v.id)')
  if (missing.rows[0].n > 0) {
    console.log(`${missing.rows[0].n} old reports were not copied; keeping canal_reports_v1.`)
  } else {
    await db.query('DROP TABLE canal_reports_v1')
    console.log(`Moved ${rows.rows.length} photos; dropped canal_reports_v1.`)
  }
})()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => db.pool.end())
