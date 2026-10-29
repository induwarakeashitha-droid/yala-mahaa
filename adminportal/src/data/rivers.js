import { slugify } from '../utils/format'

// The Irrigation Department's three gauge thresholds: alert, minor flood and major flood
export const RIVER_STATUS = {
  major: {
    key: 'major',
    label: 'Major flood',
    tone: 'critical',
    description: 'Level at or above the major flood level',
  },
  warning: {
    key: 'warning',
    label: 'Minor flood',
    tone: 'warning',
    description: 'Level at or above the minor flood level',
  },
  watch: {
    key: 'watch',
    label: 'Alert level',
    tone: 'info',
    description: 'Level at or above the alert level',
  },
  unset: {
    key: 'unset',
    label: 'No flood levels',
    tone: 'neutral',
    description: 'This gauge has no alert or flood levels in the source data',
  },
  normal: {
    key: 'normal',
    label: 'Normal',
    tone: 'success',
    description: 'Below the alert level',
  },
}

const riverStatus = (level, alert, minor, major) => {
  if (alert === null && minor === null && major === null) return 'unset'
  if (level === null) return 'normal'
  if (major !== null && level >= major) return 'major'
  if (minor !== null && level >= minor) return 'warning'
  if (alert !== null && level >= alert) return 'watch'
  return 'normal'
}

const num = (value) => (value === null || value === undefined ? null : Number(value))

// Gauges with no flood levels in the feed are rain-only stations (Ampara): their level comes in as 0,
// which means "no level", not a river at 0 m
const levelOf = (value, hasLevels) => (!hasLevels && Number(value) === 0 ? null : num(value))

const HOUR = 3600 * 1000
const SEVERITY = { major: 0, warning: 1, watch: 2 }

// rows: GET /admin/data/rivers data, topRainfall: the rain gauge with the most rain in the last 24 hours
export function buildRivers(rows = [], topRainfall = null) {
  const RIVER_STATIONS = rows
    .map((row) => {
      const alert = num(row.alert_level)
      const minor = num(row.minor_flood_level)
      const major = num(row.major_flood_level)
      const hasLevels = alert !== null || minor !== null || major !== null
      const level = levelOf(row.water_level, hasLevels)
      const status = riverStatus(level, alert, minor, major)
      const readingAt = row.reading_at ? new Date(row.reading_at) : null
      const history = (row.history || []).map((point) => {
        const at = new Date(point.at)
        return {
          time: at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
          at,
          level: levelOf(point.level, hasLevels),
          warning: alert,
          major,
          // Rain since the previous reading (readings are about hourly)
          rainfall: num(point.rainfall),
        }
      })
      // Change since the reading closest to 3 hours before the latest one
      const before = readingAt
        ? [...history].reverse().find((point) => readingAt - point.at >= 3 * HOUR - 15 * 60 * 1000)
        : null
      // null when there is no reading about 3 hours earlier to compare with
      const change = level !== null && before && before.level !== null ? Number((level - before.level).toFixed(2)) : null
      // The 24-hour trend compares the first and last reading of the day shown in the chart
      const levels = history.filter((point) => point.level !== null)
      const dayChange = levels.length >= 2 ? levels.at(-1).level - levels[0].level : null
      const rained = history.filter((point) => point.rainfall !== null)
      return {
        id: slugify(`${row.station}-${row.river}`),
        name: row.station,
        river: row.river,
        latitude: num(row.latitude),
        longitude: num(row.longitude),
        // null when the gauge sent no level reading; shown as "—"
        level,
        // null when the gauge has no such level; shown as "—"
        warning: alert,
        minor,
        major,
        // Total of the readings in the last 24 hours; null when the gauge reported no rainfall figure
        rainfall: rained.length ? Number(rained.reduce((total, point) => total + point.rainfall, 0).toFixed(1)) : null,
        change,
        trend: dayChange === null ? null : Math.abs(dayChange) < 0.02 ? 'steady' : dayChange > 0 ? 'rising' : 'falling',
        status,
        statusMeta: RIVER_STATUS[status],
        thresholdHeadroom: major !== null && level !== null ? Number((major - level).toFixed(2)) : null,
        percentOfMajor: major && level !== null ? (level / major) * 100 : 0,
        readingAt,
        history,
      }
    })
    .sort((a, b) => a.river.localeCompare(b.river) || a.name.localeCompare(b.name))

  const latest = RIVER_STATIONS.reduce((newest, station) => (station.readingAt > newest ? station.readingAt : newest), null)
  const count = (status) => RIVER_STATIONS.filter((station) => station.status === status).length

  return {
    RIVER_STATIONS,
    RIVER_SUMMARY: {
      total: RIVER_STATIONS.length,
      normal: count('normal'),
      watch: count('watch'),
      warning: count('warning'),
      major: count('major'),
      rivers: new Set(RIVER_STATIONS.map((station) => station.river)).size,
      // Gauges with a reading in the last 3 hours (from now, so a stalled feed shows up)
      reporting: RIVER_STATIONS.filter((station) => station.readingAt && Date.now() - station.readingAt <= 3 * HOUR).length,
      updatedAt: latest,
    },
    // Every gauge at or above its alert level: major flood first, then minor flood, then alert level
    FLOOD_ALERTS: RIVER_STATIONS.filter((station) => station.status !== 'normal' && station.status !== 'unset').sort(
      (a, b) => SEVERITY[a.status] - SEVERITY[b.status] || b.percentOfMajor - a.percentOfMajor,
    ),
    TOP_RAINFALL: topRainfall
      ? {
          station: topRainfall.station,
          river: topRainfall.basin,
          rainfall: num(topRainfall.rain_total),
          at: topRainfall.creation_date ? new Date(topRainfall.creation_date) : null,
        }
      : null,
  }
}
