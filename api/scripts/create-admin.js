// make an admin portal account from the terminal (for the first super_admin, after that use POST /admin/auth/admins)
//   node scripts/create-admin.js <username> "<full name>" [officer|admin|super_admin]
// password is asked for (hidden) or taken from ADMIN_PASSWORD
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', 'config.env'), quiet: true })
const db = require('../config/db.js')
const { ADMIN_ROLES, validatePassword, createAdmin } = require('../services/adminService.js')

// security: reads the password without echoing it to the terminal
function askHidden(q) {
  return new Promise((resolve) => {
    process.stdout.write(q)
    const stdin = process.stdin
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let val = ''
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode?.(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolve(val)
      } else if (ch === '\u0003') {
        process.exit(1)
      } else if (ch === '\u007f') {
        val = val.slice(0, -1)
      } else {
        val += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const [username, fullName, role = 'super_admin'] = process.argv.slice(2)
  if (!username || !fullName) {
    console.error('Usage: node scripts/create-admin.js <username> "<full name>" [officer|admin|super_admin]')
    process.exit(1)
  }
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    console.error('username must be 3-40 letters, numbers, dots, dashes or underscores.')
    process.exit(1)
  }
  if (!ADMIN_ROLES.includes(role)) {
    console.error(`role must be one of: ${ADMIN_ROLES.join(', ')}`)
    process.exit(1)
  }

  const pw = process.env.ADMIN_PASSWORD || await askHidden('Password: ')
  // security: same password rules as the api
  const problem = validatePassword(pw)
  if (problem) {
    console.error(problem)
    process.exit(1)
  }
  if (!process.env.ADMIN_PASSWORD && pw !== await askHidden('Repeat password: ')) {
    console.error('Passwords do not match.')
    process.exit(1)
  }

  try {
    const admin = await createAdmin({ username, password: pw, full_name: fullName, role })
    console.log(`Created ${admin.role} '${admin.username}' (${admin.admin_id}).`)
  } catch (err) {
    console.error(err.code === '23505' ? `An admin called '${username}' already exists.` : err.message)
    process.exitCode = 1
  } finally {
    await db.pool.end()
  }
}

main()
