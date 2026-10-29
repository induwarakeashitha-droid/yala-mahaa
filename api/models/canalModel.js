const db = require('../config/db.js')


// canals farmers can pick, from the water issue schedule.
// canals have no coords so they borrow the scheme tank's (mahawelitanks first, then reservoirs by name).
// tissawewa skipped on purpose - there's one in anuradhapura and one in hambantota
exports.getCanals = async (req, res, next) =>{
    try{
        const r = await db.query(
            `SELECT DISTINCT ON (w.tank_name, w.section)
                    w.id, w.tank_name, w.section,
                    to_char(w.water_start, 'YYYY-MM-DD') AS water_start,
                    to_char(w.water_end, 'YYYY-MM-DD') AS water_end,
                    COALESCE(t.latitude, r.latitude) AS latitude,
                    COALESCE(t.longitude, r.longitude) AS longitude
             FROM water_issue_schedule w
             LEFT JOIN LATERAL (
                 SELECT latitude, longitude FROM mahawelitanks m
                 WHERE m.latitude IS NOT NULL
                   AND (lower(w.tank_name) = lower(m.tank_name) OR lower(w.tank_name) LIKE lower(m.tank_name) || ' %')
                 ORDER BY length(m.tank_name) DESC LIMIT 1
             ) t ON true
             LEFT JOIN LATERAL (
                 SELECT latitude, longitude FROM reservoirs x
                 WHERE lower(w.tank_name) <> 'tissawewa'
                   AND (lower(w.tank_name) = lower(x.name) OR lower(w.tank_name) LIKE lower(x.name) || ' %')
                 ORDER BY length(x.name) DESC LIMIT 1
             ) r ON true
             ORDER BY w.tank_name, w.section, w.water_start DESC`
        )

        res.status(200).json(
            {
                status: "success",
                data: r.rows.map(row => ({
                    id: row.id,
                    name: row.section ? `${row.tank_name} - ${row.section}` : `${row.tank_name} canals`,
                    scheme: row.tank_name,
                    section: row.section,
                    water_start: row.water_start,
                    water_end: row.water_end,
                    latitude: row.latitude,
                    longitude: row.longitude
                }))
            }
        )
    }
    catch(err){
        next(err)
    }
}
