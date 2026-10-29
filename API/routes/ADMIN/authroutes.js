//ADMIN Auth Routes (mounted at /admin/auth)
const express = require('express')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const db =require('../../config/db.js')
const redisClient = require('../../config/redis.js')
const {
  ADMIN_ROLES, validatePassword, verifyAdminLogin, createAdmin, changeAdminPassword, findAdminById
} = require('../../services/adminService.js')
const { requireAdmin, superAdminOnly, ADMIN_TOKEN_ROLE, ADMIN_TOKEN_AUDIENCE } = require('../../middleware/requireAdmin.js')

const JWT_ADMIN_SECRET = process.env.JWT_ADMIN_SECRET

const adminauthrouter = express.Router()
const ACCESS_TOKEN_TTL = '15m'
const REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000  //7days
const LOGIN_FAIL_LIMIT = 5
const LOGIN_LOCK_SECONDS = 15 * 60


const REFRESH_COOKIE = 'adminRefreshToken'
// security: refresh cookie is httpOnly (js can't read it), secure in prod, samesite strict, only sent to /admin/auth
const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SAMESITE === 'none',
  sameSite: process.env.COOKIE_SAMESITE || 'strict',
  path: '/admin/auth'
}

// security: only a sha256 of the refresh token goes in the db, so a db leak doesn't give working tokens
const hashToken = (tok) => crypto.createHash('sha256').update(tok).digest('hex')

function signAccessToken(admin, sessId) {
  return jwt.sign(
    { sub: admin.admin_id, role: ADMIN_TOKEN_ROLE, access: admin.role, sessionId: sessId },
    JWT_ADMIN_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL, audience: ADMIN_TOKEN_AUDIENCE }
  )
}

function signRefreshToken(adminId) {
  return jwt.sign({ sub: adminId, type: 'admin-refresh' }, JWT_ADMIN_SECRET, {
    expiresIn: '7d', audience: ADMIN_TOKEN_AUDIENCE, jwtid: crypto.randomUUID()
  })
}

const loginFailKey = (username) => `admin-login-fail:${username.toLowerCase()}`

adminauthrouter.post('/login', async (req,res,next)=>{
  try {
    const { username, password } = req.body || {}
    if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({ status: 'fail', message: 'Username and password are required.' })
    }
    const uname = username.trim()

    // security: brute force lock - 5 wrong passwords locks that username for 15 min (counted in redis)
    const failKey = loginFailKey(uname)
    const fails = Number(await redisClient.get(failKey)) || 0
    if (fails >= LOGIN_FAIL_LIMIT) {
      const wait = Math.ceil((await redisClient.ttl(failKey)) / 60)
      return res.status(429).json({ status: 'fail', message: `Too many failed sign-ins. Try again in ${wait} minutes.` })
      }

    const admin = await verifyAdminLogin(uname, password)
    if (!admin) {
      await redisClient.multi().incr(failKey).expire(failKey, LOGIN_LOCK_SECONDS).exec()
      return res.status(401).json({ status: 'fail', message: 'Wrong username or password.' })
    }
    await redisClient.del(failKey)

    const refreshTok = signRefreshToken(admin.admin_id)
    const sess = await db.query(
      `INSERT INTO admin_sessions (admin_id, refresh_token_hash, ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [admin.admin_id, hashToken(refreshTok), req.ip, req.headers['user-agent'] || 'unknown', new Date(Date.now() + REFRESH_TOKEN_MS)]
    )
    await db.query('UPDATE admins SET last_login_at = NOW() WHERE admin_id = $1', [admin.admin_id])

    res.cookie(REFRESH_COOKIE, refreshTok, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_MS })
    return res.status(200).json({
      status: 'success',
      message: 'Signed in.',
      admin,
      accessToken: signAccessToken(admin, sess.rows[0].id)
    })
  }catch(err){
    return next(err)
  }
})

// new access token from the refresh cookie
adminauthrouter.post('/refresh_token', async (req, res, next) => {
  try {
    const refreshTok = req.cookies[REFRESH_COOKIE]
    if(!refreshTok){
      return res.status(401).json({ status: 'fail', message: 'refreshToken not found' })
    }
    try {
      jwt.verify(refreshTok, JWT_ADMIN_SECRET, { audience: ADMIN_TOKEN_AUDIENCE })
    } catch {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions)
      return res.status(401).json({ status: 'fail', message: 'refreshToken invalid or expired' })
    }

    const sess = await db.query(
      `SELECT s.id, a.admin_id, a.role
       FROM admin_sessions s JOIN admins a ON a.admin_id = s.admin_id
       WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND a.is_active`,
      [hashToken(refreshTok)]
    )
    if (!sess.rows[0]) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions)
      return res.status(401).json({ status: 'fail', message: 'Session ended, sign in again.' })
    }
    const { id: sessId, ...admin } = sess.rows[0]

    // security: refresh token rotation - every refresh swaps in a new one, so an old stolen token stops working
    const newRefreshTok = signRefreshToken(admin.admin_id)
    await db.query(
      `UPDATE admin_sessions SET refresh_token_hash = $2, expires_at = $3, last_used_at = NOW() WHERE id = $1`,
      [sessId, hashToken(newRefreshTok), new Date(Date.now() + REFRESH_TOKEN_MS)]
    )

    res.cookie(REFRESH_COOKIE, newRefreshTok, { ...refreshCookieOptions, maxAge: REFRESH_TOKEN_MS })
    return res.status(200).json({ status: 'success', accessToken: signAccessToken(admin, sessId) })
  } catch (err) {
    return next(err)
  }
})

adminauthrouter.post('/logout', async(req, res, next)=>{
  try {
    const refreshTok = req.cookies[REFRESH_COOKIE]
    // security: revokes the session server side, not just clearing the cookie
    if (refreshTok) {
      await db.query('UPDATE admin_sessions SET revoked_at = NOW() WHERE refresh_token_hash = $1 AND revoked_at IS NULL', [hashToken(refreshTok)])
    }
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions)
    return res.status(200).json({ status: 'success', message: 'Signed out.' })
  }catch(err){
    return next(err)
  }
})

adminauthrouter.get('/me', requireAdmin, async (req,res, next) => {
  try {
    return res.status(200).json({ status: 'success', admin: await findAdminById(req.admin.admin_id) })
  }catch(err){
    return next(err)
  }
})

adminauthrouter.patch('/password', requireAdmin, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {}
    if (typeof current_password !== 'string' || !current_password) {
      return res.status(400).json({ status: 'fail', message: 'current_password is required.' })
    }
    const problem = validatePassword(new_password)
    if (problem) {
      return res.status(400).json({ status: 'fail', message: problem })
        }
    if (!(await changeAdminPassword(req.admin.admin_id, current_password, new_password))) {
      return res.status(401).json({ status: 'fail', message: 'Current password is wrong.' })
    }
    // security: password change logs out every other session of this admin
    await db.query(
      'UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_id = $1 AND id <> $2 AND revoked_at IS NULL',
      [req.admin.admin_id, req.adminSessionId]
    )
    return res.status(200).json({ status: 'success', message: 'Password changed.' })
  } catch (err) {
    return next(err)
  }
})

// super_admin only
adminauthrouter.post('/admins', requireAdmin, superAdminOnly, async (req, res, next) => {
  try {
    const { username, password, full_name, role } = req.body || {}
    if ([username, full_name].some(v => typeof v !== 'string' || !v.trim())) {
      return res.status(400).json({ status: 'fail', message: 'username and full_name are required.' })
    }
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username.trim())) {
      return res.status(400).json({ status: 'fail', message: 'username must be 3-40 letters, numbers, dots, dashes or underscores.' })
    }
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(400).json({ status: 'fail', message: `role must be one of: ${ADMIN_ROLES.join(', ')}.` })
    }
    const problem = validatePassword(password)
    if (problem) {
      return res.status(400).json({ status: 'fail', message: problem })
    }
    const admin = await createAdmin({ username: username.trim(), password, full_name: full_name.trim(), role })
    return res.status(201).json({ status: 'success', message: 'Admin created.', data: admin })
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ status: 'fail', message: 'An admin with that username already exists.' })
    }
    return next(err)
  }
})



module.exports = adminauthrouter
