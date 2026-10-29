const db = require('../config/db.js')

// security: ids are plain positive ints, days is 1-365 (default 14)
const validId = (id) => /^[1-9]\d*$/.test(id)
const dayCount = (v) => {
    if (v === undefined || v === '') return 14
    return /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 365 ? Number(v) : null
}

exports.getAllResvData = async (req, res, next) =>{
    try{
        const result = await db.query('SELECT * FROM reservoirs ORDER BY id') //SORT BY Name if needed
        res.status(200).json(
            {
                status: "success",
                data: result.rows
            }
        )

    }
    catch(error){
        next(error)
    }
}

exports.getResById = async (req, res, next) =>{
    if (!validId(req.params.id)) {
        return res.status(400).json({ status: 'fail', message: 'Reservoir ID must be a positive integer.' })
    }
    try{
        const result = await db.query(`SELECT * FROM reservoirs WHERE id = $1;`, [req.params.id])
        // skip rows the scraper left without a percent, else the portal shows them as 0%
        const latest = await db.query(
            `SELECT * FROM reservoir_levels
             WHERE reservoir_id = $1 AND usable_storage_percent IS NOT NULL
             ORDER BY reading_date DESC LIMIT 1`,
            [req.params.id]
        )

        if (!result.rows[0]) {
            return res.status(404).json({ status: 'fail', message: `Reservoir with ID ${req.params.id} not found.` })
        }

        res.status(200).json(
            {
                status: "success",
                data: {
                        const : result.rows[0],
                        latest: latest.rows[0]  //GET THE LATEST DATE UPDATED WATER LEVEL AND EVRYTHING
                }
            }
        )
    }
   catch(error){
    next(error)
   }
}


exports.getReslevels = async (req, res , next)=>{
    const days = dayCount(req.query.days)
    if (!validId(req.params.id) || days === null) {
        return res.status(400).json({ status: 'fail', message: 'Reservoir ID must be a positive integer and days 1-365.' })
    }
    try{
        const reslevel = await db.query(
            `SELECT * FROM reservoir_levels
             WHERE reservoir_id = $1 AND reading_date >= CURRENT_DATE - $2::int
             ORDER BY reading_date`,
            [req.params.id, days]
        )
        res.status(200).json(
            {
                status:"success",
                data: reslevel.rows
            }
        )
    }
    catch(error){
        next(error)
    }
}
