
const db = require('../config/db.js')
const crypto = require('crypto')
const { withTransaction, saveFarm, getFarm, cropSummary } = require('./farmService.js')

// farm_id is a random 6 hex code, retry if it clashes
const FARM_ID_ATTEMPTS = 5



//Check if farmer already exists
async function findFarmerByPhone(phone) {
    const r = await db.query(
        'SELECT farmer_id, full_name, phone FROM farmers WHERE phone = $1 LIMIT 1',
        [phone]
    )
    return r.rows[0] || null
}

async function createFarmer(farmer) {
    // farm (optional) comes from validateFarm
    const { nic, land_acres, primary_crop, farm } = farmer

    if (!process.env.NIC_PEPPER) throw new Error('NIC_PEPPER is not set')

    // security: NIC is never stored, only a keyed hash (HMAC with a secret pepper)
    const hashedNic = crypto
        .createHmac('sha256', process.env.NIC_PEPPER)
        .update(nic.trim().toUpperCase())
        .digest('hex')

    const summary = farm?.crops ? cropSummary(farm.crops) : { land_acres, primary_crop }

    const farmDtl = farm?.crops || !(summary.primary_crop && Number(summary.land_acres) > 0)
        ? farm
        : { ...farm, crops: [{ category: null, crop_type: summary.primary_crop, variety: null, acres: Number(summary.land_acres), last_yield: null, yield_unit: null }] }

    for (let tries = 1; ; tries++) {
        try {
            return await withTransaction(async (client) => {
                const result = await insertFarmer(client, { ...farmer, ...summary }, hashedNic)
                await saveFarm(client, result.farm_id, {
                    water_source: null, water_name: null, location_label: null, ...farmDtl
                })
                return { result, hashedNic }
            })
        } catch (err) {
            if (err.code === '23505' && err.constraint === 'farmers_farm_id_key' && tries < FARM_ID_ATTEMPTS) continue
            throw err
        }
    }
}

async function insertFarmer(client, farmer, hashedNic) {
    const { full_name, phone, address, district, division, farm_latitude, farm_longitude, reservoir_id, tank_id, land_acres, primary_crop } = farmer
    const r = await client.query(
        `INSERT INTO farmers (
            full_name, hashed_nic, phone, address, district, division,
            farm_latitude, farm_longitude, reservoir_id, tank_id,
            land_acres, primary_crop
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING farmer_id, farm_id, full_name, phone`,
        [
            full_name,
            hashedNic,
            phone,
            address,
            district,
            division || null,
            farm_latitude ?? null,
            farm_longitude ?? null,
            reservoir_id ?? null,
            tank_id ?? null,
            land_acres ?? null,
            primary_crop || null
        ]
    )
    return r.rows[0]
}

const FARMER_COLUMNS = 'farmer_id, farm_id, full_name,phone,address,district,division,farm_latitude, farm_longitude,reservoir_id, tank_id,land_acres, primary_crop, created_at, updated_at'

// needs requireFarmer before it
async function getFarmerDetails(req,res){
    // security: only ever the logged in farmer's own row (id from the token, not the request)
    const r = await db.query(`SELECT ${FARMER_COLUMNS} FROM farmers WHERE farmer_id =$1`, [req.farmerId])
    const farmers = await Promise.all(r.rows.map(async (row) => ({ ...row, farm: await getFarm(row.farm_id) })))
    res.status(200).json(
        {
            status: "success",
            data: farmers
        }
    )
}

// security: farmers can only change these. phone + NIC are their identity so they stay fixed
const UPDATABLE_FIELDS = [
    'full_name', 'address', 'district', 'division', 'farm_latitude', 'farm_longitude',
    'reservoir_id', 'tank_id', 'land_acres', 'primary_crop'
]

// admins get these on top
const ADMIN_UPDATABLE_FIELDS = [...UPDATABLE_FIELDS, 'phone', 'hashed_nic', 'is_active']

// returns { error } or { changes } with only the fields that were sent, cleaned (empty optional text -> null)
function validateFarmerChanges(body) {
    const chg = {}
    for (const f of UPDATABLE_FIELDS) {
        if (body[f] !== undefined) chg[f] = body[f]
    }
    for (const f of ['full_name', 'address', 'district']) {
        if (chg[f] === undefined) continue
        if (typeof chg[f] !== 'string' || !chg[f].trim()) return { error: `${f} cannot be empty.` }
        chg[f] = chg[f].trim()
    }
    for (const f of ['division', 'primary_crop']) {
        if (chg[f] === undefined) continue
        if (chg[f] != null && typeof chg[f] !== 'string') return { error: `${f} must be text.` }
        chg[f] = chg[f]?.trim() || null
    }
    for (const f of ['farm_latitude', 'farm_longitude', 'reservoir_id', 'tank_id', 'land_acres']) {
        if (chg[f] != null && !Number.isFinite(Number(chg[f]))) return { error: `${f} must be a number.` }
    }
    if (chg.reservoir_id != null && chg.tank_id != null) {
        return { error: 'A farmer can be linked to a reservoir or a tank, not both.'}
    }
    return { changes: chg }
}

async function updateFarmer(farmerId, changes, { fields: allowed = UPDATABLE_FIELDS, client = db } = {}) {
    // security: column names only come from the allowed list, values are always $n params
    const flds = allowed.filter(f => changes[f] !== undefined)
    if (flds.length === 0) {
        const r = await client.query(`SELECT ${FARMER_COLUMNS} FROM farmers WHERE farmer_id = $1`, [farmerId])
        return r.rows[0] || null
    }

    const sets = flds.map((f, i) => `${f} = $${i + 2}`)
    const r = await client.query(
        `UPDATE farmers SET ${sets.join(', ')} WHERE farmer_id = $1 RETURNING ${FARMER_COLUMNS}`,
        [farmerId, ...flds.map(f => changes[f])]
    )
    return r.rows[0] || null
}

// security: same keyed hash as on register, used to look NICs up without storing them
function hashNic(nic) {
    if (!process.env.NIC_PEPPER) throw new Error('NIC_PEPPER is not set')
    return crypto.createHmac('sha256', process.env.NIC_PEPPER).update(nic.trim().toUpperCase()).digest('hex')
}


module.exports = {
    findFarmerByPhone, createFarmer, getFarmerDetails, updateFarmer, validateFarmerChanges, hashNic,
    FARMER_COLUMNS, UPDATABLE_FIELDS, ADMIN_UPDATABLE_FIELDS
}
