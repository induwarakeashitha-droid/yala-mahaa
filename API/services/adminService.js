const db =require('../config/db.js')
const bcrypt =require('bcryptjs')
const crypto = require('crypto')

const BCRYPT_ROUNDS = 12
const ADMIN_ROLES = ['officer', 'admin', 'super_admin']
const ADMIN_COLUMNS = 'admin_id, full_name, username, role, is_active, created_at, last_login_at'

// security: compared against when the username doesn't exist, so a wrong username takes as long as a wrong password (no user enumeration by timing)
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS)

const isBcryptHash = (val) => /^\$2[aby]\$\d{2}\$/.test(val || '')

// security: constant time compare for old plain-text passwords, so timing doesn't leak how much matched
function sameText(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest()
    const hb = crypto.createHash('sha256').update(String(b)).digest()
    return crypto.timingSafeEqual(ha, hb)
}

// security: min length 10, max 72 because bcrypt ignores anything past 72 bytes
function validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.'
    if (pw.length > 72) return 'Password must be at most 72 characters.'
    return null
}

// returns the active admin or null. old plain-text passwords get upgraded to bcrypt on first login
async function verifyAdminLogin(username, pw) {
    const r = await db.query(
        `SELECT ${ADMIN_COLUMNS}, password_hash FROM admins WHERE username = $1`,
        [username]
    )
    const admin = r.rows[0]
    if (!admin){
        await bcrypt.compare(pw, DUMMY_HASH)
        return null
      }

    const { password_hash, ...pub } = admin
    let ok
    if (isBcryptHash(password_hash)) {
        ok = await bcrypt.compare(pw, password_hash)
    }
    else {
        ok = sameText(pw, password_hash)
        if (ok) {
            await db.query('UPDATE admins SET password_hash = $2 WHERE admin_id = $1', [admin.admin_id, await bcrypt.hash(pw, BCRYPT_ROUNDS)])
        }
    }
    if (!ok || !admin.is_active) return null
    return pub
}

async function createAdmin({ username, password, full_name, role }) {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const r = await db.query(
        `INSERT INTO admins (full_name, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING ${ADMIN_COLUMNS}`,
        [full_name, username, hash, role]
    )
    return r.rows[0]
}

async function changeAdminPassword(adminId, curPw, newPw) {
    const r = await db.query('SELECT password_hash FROM admins WHERE admin_id = $1', [adminId])
    const stored = r.rows[0]?.password_hash
    if (!stored) return false
    // security: must know the current password before it can be changed
    const ok = isBcryptHash(stored) ? await bcrypt.compare(curPw, stored) : sameText(curPw, stored)
    if (!ok) return false
    await db.query('UPDATE admins SET password_hash = $2 WHERE admin_id = $1', [adminId, await bcrypt.hash(newPw, BCRYPT_ROUNDS)])
    return true
}



async function findAdminById(adminId){
    const r = await db.query(`SELECT ${ADMIN_COLUMNS} FROM admins WHERE admin_id = $1`, [adminId])
    return r.rows[0] || null
}

module.exports = {
    ADMIN_ROLES, ADMIN_COLUMNS, BCRYPT_ROUNDS,
    isBcryptHash, validatePassword, verifyAdminLogin, createAdmin, changeAdminPassword, findAdminById
}
