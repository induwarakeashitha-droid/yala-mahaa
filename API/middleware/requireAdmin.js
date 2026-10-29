const jwt = require('jsonwebtoken')
const db =require('../config/db.js')



const ADMIN_TOKEN_ROLE = 'admin-yalamaha'
const ADMIN_TOKEN_AUDIENCE = 'yalamaha-admin-portal'

async function requireAdmin(req, res, next) {
    const tok = req.headers.authorization?.split(' ')[1]
    if (!tok) {
        return res.status(401).json({ status: 'error', message: 'token not found' })
    }

    // security: token must be signed with the admin secret + admin audience, so farmer tokens never get in
    let dec
    try {
        dec = jwt.verify(tok, process.env.JWT_ADMIN_SECRET, { audience: ADMIN_TOKEN_AUDIENCE })
    } catch {
        return res.status(401).json({ status: 'error', message: 'token invalid or expired' })
      }
    if (dec.role !== ADMIN_TOKEN_ROLE || !dec.sessionId) {
        return res.status(401).json({ status: 'error', message: 'token invalid or expired' })
    }

    try {
        // security: session has to still be open and the account active, so logout / disabling an admin works right away
        const r = await db.query(
            `SELECT a.admin_id, a.username, a.full_name, a.role
             FROM admin_sessions s JOIN admins a ON a.admin_id = s.admin_id
             WHERE s.id = $1 AND s.admin_id = $2 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND a.is_active`,
            [dec.sessionId, dec.sub]
        )
        if (!r.rows[0]) {
            return res.status(401).json({ status: 'error', message: 'session ended, sign in again' })
        }
        req.admin = r.rows[0]
        req.adminSessionId = dec.sessionId
        return next()
    }catch(err){
        return next(err)
    }

}

// use after requireAdmin
function allowRoles(...roles) {
    return (req,res,next)=>{
        // security: blocks any role not in the list (eg officers are view only)
        if (!roles.includes(req.admin?.role)) {
            return res.status(403).json({ status: 'fail', message: 'Your account is not allowed to do this.' })
          }
        return next()
    }
}

const canEdit = allowRoles('admin', 'super_admin')
const superAdminOnly = allowRoles('super_admin')

module.exports = { requireAdmin, allowRoles, canEdit, superAdminOnly, ADMIN_TOKEN_ROLE, ADMIN_TOKEN_AUDIENCE }
