const db = require('../config/db.js')


// rivers -> their gauge stations with the latest reading each (filled by get-realtime-river-levels.py)
exports.getRivers = async (req, res, next) =>{
    try{
        // prev = a reading 2-24h older than the latest, so the portal can tell rising / falling
        const r = await db.query(
            `SELECT l.*, p.water_level AS prev_level, p.creation_date AS prev_at
             FROM (
                 SELECT DISTINCT ON (basin, station)
                        basin, station, latitude, longitude, water_level, rain_fall,
                        alertpull, minorpull, majorpull, creation_date
                 FROM river_level_realtime
                 WHERE basin IS NOT NULL AND station IS NOT NULL
                 ORDER BY basin, station, creation_date DESC
             ) l
             LEFT JOIN LATERAL (
                 SELECT water_level, creation_date FROM river_level_realtime o
                 WHERE o.basin = l.basin AND o.station = l.station AND o.water_level IS NOT NULL
                   AND o.creation_date BETWEEN l.creation_date - INTERVAL '24 hours' AND l.creation_date - INTERVAL '2 hours'
                 ORDER BY o.creation_date DESC LIMIT 1
             ) p ON true
             ORDER BY l.basin, l.station`
        )

        const rivers = []
        for (const row of r.rows) {
            let rv = rivers[rivers.length - 1]
            if (!rv || rv.name !== row.basin) {
                rv = { name: row.basin, stations: [] }
                rivers.push(rv)
            }
            rv.stations.push({
                name: row.station,
                latitude: row.latitude,
                longitude: row.longitude,
                water_level: row.water_level,
                rain_fall: row.rain_fall,
                alert_level: row.alertpull,
                minor_flood_level: row.minorpull,
                major_flood_level: row.majorpull,
                reading_at: row.creation_date,
                prev_level: row.prev_level,
                prev_reading_at: row.prev_at
            })
        }

        res.status(200).json(
            {
                status: "success",
                data: rivers
            }
        )
    }
    catch(err){
        next(err)
    }
}
