const db = require('../config/db.js')

const WATER_SOURCES = ['tank', 'canal', 'river', 'well', 'rain']
const YIELD_UNITS = ['kg', 'bu', 't']
const MAX_CROPS = 20

// runs fn(client) in a transaction, rolls back if it throws
async function withTransaction(fn) {
    const client = await db.pool.connect()
    try {
        await client.query('BEGIN')
        const res = await fn(client)
        await client.query('COMMIT')
        return res
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
    } finally {
        client.release()
    }
}

const text = (val, max = 120) => (typeof val === 'string' && val.trim() ? val.trim().slice(0, max) : null)

// returns { error } or { farm }. crops stays undefined if it wasn't sent
//whitelists water source / yield unit, caps crop count, number ranges and text length
function validateFarm(body, { requireCrops = false } = {}) {
    const { water_source, water_name, location_label, crops } = body || {}

    if (water_source != null && !WATER_SOURCES.includes(water_source)) {
        return { error: `water_source must be one of: ${WATER_SOURCES.join(', ')}.` }
    }
    if (crops === undefined && !requireCrops) {
        return { farm: { water_source: water_source ?? null, water_name: text(water_name), location_label: text(location_label) } }
    }
    if (!Array.isArray(crops) || crops.length === 0) {
        return { error: 'Add at least one crop.' }
    }
    if (crops.length > MAX_CROPS) {
        return { error: `A farm can have at most ${MAX_CROPS} crops.` }
    }

    const cleaned = []
    for (const [i, crop] of crops.entries()) {
        const n = i + 1
        const type = text(crop?.crop_type, 80)
        if (!type) return { error: `Crop ${n}: crop_type is required.` }
        const acres = Number(crop.acres)
        if (!Number.isFinite(acres) || acres <= 0 || acres > 100000) {
            return { error: `Crop ${n}: acres must be a number above 0.` }
        }
        const lastYld = crop.last_yield == null || crop.last_yield === '' ? null : Number(crop.last_yield)
        if (lastYld !== null && (!Number.isFinite(lastYld) || lastYld < 0)) {
            return { error: `Crop ${n}: last_yield must be a number of 0 or more.` }
        }
        if (crop.yield_unit != null && !YIELD_UNITS.includes(crop.yield_unit)) {
            return { error: `Crop ${n}: yield_unit must be one of: ${YIELD_UNITS.join(', ')}.` }
        }
        cleaned.push({
            category: text(crop.category, 40),
            crop_type: type,
            variety: text(crop.variety, 80),
            acres: Math.round(acres * 100) / 100,
            last_yield: lastYld,
            yield_unit: crop.yield_unit ?? null
        })
    }

    return {
        farm: { water_source: water_source ?? null, water_name: text(water_name), location_label: text(location_label), crops: cleaned }
    }
}

// totals also kept on the farmers row so the old queries still work
function cropSummary(crops) {
    return {
        land_acres: Math.round(crops.reduce((sum, c) => sum + c.acres, 0) * 100) / 100,
        primary_crop: crops[0].crop_type
    }
}

// insert/replace farm details. if farm.crops is there the whole crop list gets replaced
async function saveFarm(client, farmId, farm) {
    await client.query(
        `INSERT INTO farms (farm_id, water_source, water_name, location_label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (farm_id) DO UPDATE SET
             water_source   = EXCLUDED.water_source,
             water_name     = EXCLUDED.water_name,
             location_label = EXCLUDED.location_label`,
        [farmId, farm.water_source, farm.water_name, farm.location_label]
    )
    if (!farm.crops) return

    await client.query('DELETE FROM farm_crops WHERE farm_id = $1', [farmId])
    for (const [pos, crop] of farm.crops.entries()) {
        await client.query(
            `INSERT INTO farm_crops (farm_id, position, category, crop_type, variety, acres, last_yield, yield_unit)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [farmId, pos, crop.category, crop.crop_type, crop.variety, crop.acres, crop.last_yield, crop.yield_unit]
        )
    }
    const { land_acres, primary_crop } = cropSummary(farm.crops)
    await client.query('UPDATE farmers SET land_acres = $2, primary_crop = $3 WHERE farm_id = $1', [farmId, land_acres, primary_crop])
}

// null if nothing saved yet
async function getFarm(farmId, client = db) {
    const farm = await client.query(
        'SELECT farm_id, water_source, water_name, location_label, created_at, updated_at FROM farms WHERE farm_id = $1',
        [farmId]
    )
    if (!farm.rows[0]) return null
    const crops = await client.query(
        `SELECT category, crop_type, variety, acres, last_yield, yield_unit
         FROM farm_crops WHERE farm_id = $1 ORDER BY position`,
        [farmId]
    )
    return { ...farm.rows[0], crops: crops.rows }
}

module.exports = { withTransaction, validateFarm, cropSummary, saveFarm, getFarm }
