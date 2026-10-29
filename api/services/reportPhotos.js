// canal report photos
const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const multer = require('multer')
const sharp = require('sharp')

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'reports')
const MAX_PHOTOS = 3
const MAX_BYTES = 5 * 1024 * 1024
const MAX_INPUT_PIXELS = 40_000_000     // ~7700 x 5200
const MAX_SIDE = 1600
const ALLOWED = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp']
}
const STORED_NAME = /^[a-f0-9]{32}\.jpg$/

sharp.cache(false)

class PhotoError extends Error {
  constructor(msg, status = 400) {
    super(msg)
    this.status = status
  }
}

// security: first gate - mime type AND extension both have to be jpg/png/webp (neither is trusted alone, the byte checks come later)
function checkUpload(req, file, cb) {
  const exts = ALLOWED[file.mimetype]
  const ext = path.extname(file.originalname || '').toLowerCase()
  if (file.fieldname !== 'photos' || !exts || !exts.includes(ext)) {
    return cb(new PhotoError('Only JPG, PNG or WebP photos can be attached.'))
  }
  return cb(null, true)
}

// security: uploads stay in memory (never written raw to disk) and size / count / field limits stop huge or flood uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: checkUpload,
  limits: {
    fileSize: MAX_BYTES,
    files: MAX_PHOTOS,
    fields: 10,
    fieldSize: 4000,
    fieldNameSize: 40,
    parts: MAX_PHOTOS + 10,
    headerPairs: 40
  }
})

// multer errors -> 400/413 instead of 500
function receivePhotos(req, res, next) {
  upload.array('photos', MAX_PHOTOS)(req, res, (err) => {
    if (!err) return next()
    if (err instanceof PhotoError) return res.status(400).json({ status: 'fail', message: err.message })
    if (err instanceof multer.MulterError) {
      const msgs = {
        LIMIT_FILE_SIZE: 'Each photo must be 5 MB or smaller.',
        LIMIT_FILE_COUNT: `Attach at most ${MAX_PHOTOS} photos.`,
        LIMIT_UNEXPECTED_FILE: `Attach only photos, at most ${MAX_PHOTOS}.`
      }
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ status: 'fail', message: msgs[err.code] || 'The upload was not accepted.' })
    }
    return next(err)
  })
}

// security: checks the real file type from its magic bytes, not from what the client says
function detectImageType(buf) {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

// uploaded file -> clean jpeg buffer (or throws PhotoError)
async function cleanPhoto(file) {
  const type = detectImageType(file.buffer)
  if (!type) throw new PhotoError('One of the files is not a photo. Attach JPG, PNG or WebP photos only.')

  // security: sharp has to decode it as the same format, with a pixel cap so decompression bombs get refused
  let img
  try {
    img = sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false })
    const meta = await img.metadata()
    if (meta.format !== type) throw new PhotoError('One of the photos is damaged or not what it claims to be.')
  } catch (err) {
    if (err instanceof PhotoError) throw err
    throw new PhotoError('One of the photos could not be read. Take it again or choose another.')
  }

  // security: re-encode to a brand new jpeg so nothing hidden in the original (scripts, polyglots, exif/gps) survives
  // rotate() first so the camera orientation is kept before metadata is dropped
  const out = await img
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer()
  return out
}

// security: random file name we pick + fixed .jpg, folder isn't served statically, 'wx' never overwrites
async function savePhoto(buf) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true, mode: 0o750 })
  const fname = `${crypto.randomBytes(16).toString('hex')}.jpg`
  await fs.writeFile(path.join(UPLOAD_DIR, fname), buf, { flag: 'wx', mode: 0o640 })
  return fname
}

// security: only names we generated are accepted, so no ../ path traversal
function photoPath(fname) {
  if (!STORED_NAME.test(fname)) throw new PhotoError('Photo not found.', 404)
  return path.join(UPLOAD_DIR, fname)
}

// security: nosniff + sandbox CSP so the browser only ever treats it as an image
function sendPhoto(res, fname) {
  res.set({
    'Content-Type': 'image/jpeg',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Disposition': 'inline; filename="photo.jpg"',
    'Cache-Control': 'private, max-age=86400'
  })
  return res.sendFile(photoPath(fname), { dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ status: 'fail', message: 'Photo not found.' })
  })
}

async function removePhotos(fnames) {
  await Promise.all(fnames.map(n => fs.unlink(photoPath(n)).catch(() => {})))
}

module.exports = {
  MAX_PHOTOS, UPLOAD_DIR, PhotoError,
  receivePhotos, detectImageType, cleanPhoto, savePhoto, photoPath, sendPhoto, removePhotos
}
