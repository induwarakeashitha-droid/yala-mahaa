import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CloudRain,
  Download,
  MapPin,
  MessageSquareText,
  Radio,
  Search,
  Send,
  ShieldAlert,
  Signal,
  Waves,
  X,
} from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { cn, csvTime, downloadCsv, formatDateTime } from '../utils/format'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge, StatusBadge } from '../components/ui/Badge'
import { Gauge } from '../components/ui/Gauge'
import { Progress } from '../components/ui/Progress'
import { Sparkline } from '../components/ui/Sparkline'
import { RiverHydrograph } from '../components/charts'
import { AutoFloodAlerts } from '../components/AutoFloodAlerts'

const TONE_HEX = {
  critical: '#dc2626',
  warning: '#d97706',
  info: '#0891b2',
  success: '#16a34a',
}

const severityRank = { major: 0, warning: 1, watch: 2, normal: 3, unset: 4 }
// most serious first, then closest to its major flood level
const bySeverity = (a, b) => {
  const rank = severityRank[a.status] - severityRank[b.status]
  return rank !== 0 ? rank : b.percentOfMajor - a.percentOfMajor
}

// A threshold or headroom in metres, or "—" when the gauge has none
const metres = (value, digits = 2) => (value === null || value === undefined ? '—' : `${value.toFixed(digits)} m`)
// Change in level: "+0.12 m", "0.00 m" when steady, "—" when there is nothing to compare with
const signed = (value) => (value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)} m`)
const changeClass = (value) => (value > 0 ? 'is-rising' : value < 0 ? 'is-falling' : '')
const rain = (value) => (value === null ? '—' : `${value} mm`)
// Distance to the major flood level, or how far above it the river is
const toMajor = (value) => (value === null ? '—' : value >= 0 ? `${value.toFixed(2)} m below` : `${(-value).toFixed(2)} m above`)
const TREND_LABEL = { rising: 'Rising', falling: 'Falling', steady: 'Steady' }

export function Rivers() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const { RIVER_STATIONS, RIVER_SUMMARY, FLOOD_ALERTS, TOP_RAINFALL } = useData()
  const initialStation =
    searchParams.get('station') || FLOOD_ALERTS[0]?.id || RIVER_STATIONS[0]?.id
  const [selectedId, setSelectedId] = useState(initialStation)
  const [tableFilter, setTableFilter] = useState('all')
  const [river, setRiver] = useState(searchParams.get('river') || 'all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const fromUrl = searchParams.get('station')
    if (fromUrl && RIVER_STATIONS.some((station) => station.id === fromUrl)) {
      setSelectedId(fromUrl)
    }
  }, [searchParams, RIVER_STATIONS])

  const selected =
    RIVER_STATIONS.find((station) => station.id === selectedId) || RIVER_STATIONS[0]

  const selectStation = (station) => {
    setSelectedId(station.id)
    const params = new URLSearchParams(searchParams)
    params.set('station', station.id)
    setSearchParams(params, { replace: true })
  }

  // rivers with how many gauges each, for the dropdown
  const rivers = useMemo(() => {
    const counts = {}
    for (const station of RIVER_STATIONS) counts[station.river] = (counts[station.river] || 0) + 1
    return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
  }, [RIVER_STATIONS])

  // gauges matching the river dropdown and the search box (station or river name)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (station) =>
      (river === 'all' || station.river === river) &&
      (!q || station.name.toLowerCase().includes(q) || station.river.toLowerCase().includes(q))
  }, [river, query])
  const shownStations = useMemo(() => RIVER_STATIONS.filter(matches), [RIVER_STATIONS, matches])

  const chooseRiver = (value) => {
    setRiver(value)
    const params = new URLSearchParams(searchParams)
    if (value === 'all') params.delete('river')
    else params.set('river', value)
    // open the river's most serious gauge
    const first = value === 'all' ? null : RIVER_STATIONS.filter((station) => station.river === value).sort(bySeverity)[0]
    if (first) {
      setSelectedId(first.id)
      params.set('station', first.id)
    }
    setSearchParams(params, { replace: true })
  }

  const tableStations = useMemo(() => {
    const list =
      tableFilter === 'alerts' ? FLOOD_ALERTS : RIVER_STATIONS
    return list.filter(matches).sort(bySeverity)
  }, [tableFilter, RIVER_STATIONS, FLOOD_ALERTS, matches])

  if (!selected) {
    return (
      <div className="page rivers-page">
        <PageHeader eyebrow="Hydrology" title="River monitoring & flood watch" description="No river gauge readings have been loaded yet." />
      </div>
    )
  }

  const stats = [
    {
      label: 'Monitored gauges',
      value: RIVER_SUMMARY.total,
      hint: `On ${RIVER_SUMMARY.rivers} rivers`,
      icon: Radio,
      tone: 'primary',
    },
    {
      label: 'At or above alert level',
      value: FLOOD_ALERTS.length,
      hint: `${RIVER_SUMMARY.warning} minor flood - ${RIVER_SUMMARY.major} major flood`,
      icon: AlertTriangle,
      tone: 'critical',
    },
    {
      label: 'Gauges reporting',
      value: RIVER_SUMMARY.total ? `${Math.round((RIVER_SUMMARY.reporting / RIVER_SUMMARY.total) * 100)}%` : '—',
      hint: `${RIVER_SUMMARY.total - RIVER_SUMMARY.reporting} without a reading in the last 3 hours`,
      icon: Signal,
      tone: 'teal',
    },
    {
      label: 'Most rain - last 24 h',
      value: TOP_RAINFALL?.rainfall != null ? `${TOP_RAINFALL.rainfall.toFixed(1)} mm` : '—',
      hint: TOP_RAINFALL ? `${TOP_RAINFALL.station} - ${TOP_RAINFALL.river} - last report ${formatDateTime(TOP_RAINFALL.at)}` : 'No rain reported in the last 24 hours',
      icon: CloudRain,
      tone: 'info',
    },
  ]

  // Worst gauges first, in the same order as the flood alerts, then by river and station
  const handleExport = () => {
    const rows = [...RIVER_STATIONS]
      .sort((a, b) => severityRank[a.status] - severityRank[b.status] || b.percentOfMajor - a.percentOfMajor)
      .map((station) => ({
        Station: station.name,
        River: station.river,
        Status: station.statusMeta.label,
        'Level (m)': station.level ?? '',
        'Alert level (m)': station.warning ?? '',
        'Minor flood level (m)': station.minor ?? '',
        'Major flood level (m)': station.major ?? '',
        'To major flood (m, negative = above)': station.thresholdHeadroom ?? '',
        'Change in 3 h (m)': station.change ?? '',
        'Trend over 24 h': TREND_LABEL[station.trend] ?? '',
        'Rain in last 24 h (mm)': station.rainfall ?? '',
        'Reading at': csvTime(station.readingAt),
        Latitude: station.latitude ?? '',
        Longitude: station.longitude ?? '',
      }))
    downloadCsv(`YalaMaha-river-gauges-${new Date().toLocaleDateString('en-CA')}.csv`, rows)
    toast(`${rows.length} gauges exported.`, { title: 'Export complete', tone: 'success' })
  }

  const sendAdvisory = (station = selected) => {
    navigate(`/sms?template=flood&station=${station.id}`)
  }

  const selectedHistory = selected.history.map((point) => point.level).filter((level) => level !== null)

  return (
    <div className="page rivers-page">
      <PageHeader
        eyebrow={`Hydrology - Latest reading ${formatDateTime(RIVER_SUMMARY.updatedAt)}`}
        badge={
          <Badge tone={FLOOD_ALERTS.length ? 'warning' : 'success'} dot>
            {FLOOD_ALERTS.length} at or above alert level
          </Badge>
        }
        title="River monitoring & flood watch"
        description={`Water levels against the alert, minor flood and major flood levels at ${RIVER_SUMMARY.total} river gauges.`}
        actions={
          <>
            <Button icon={Download} variant="secondary" onClick={handleExport} disabled={!RIVER_STATIONS.length}>
              Export gauge report
            </Button>
            <Button icon={Send} variant="primary" onClick={() => sendAdvisory()}>
              Broadcast flood alert
            </Button>
          </>
        }
      />

      <AutoFloodAlerts />

      {FLOOD_ALERTS.length > 0 && (
        <div className="flood-banner">
          <span className="flood-banner-icon">
            <ShieldAlert size={22} />
          </span>
          <div className="flood-banner-copy">
            <strong>
              {FLOOD_ALERTS[0].statusMeta.label} - {FLOOD_ALERTS[0].river} at {FLOOD_ALERTS[0].name}
            </strong>
            <span>
              {metres(FLOOD_ALERTS[0].level)} (alert {FLOOD_ALERTS[0].warning.toFixed(1)} m, minor flood{' '}
              {FLOOD_ALERTS[0].minor.toFixed(1)} m, major flood {FLOOD_ALERTS[0].major.toFixed(1)} m).{' '}
              {FLOOD_ALERTS.length} gauge{FLOOD_ALERTS.length > 1 ? 's are' : ' is'} at or above the alert level.
            </span>
          </div>
          <div className="flood-banner-actions">
            <Button
              variant="primary"
              size="sm"
              icon={MessageSquareText}
              onClick={() => sendAdvisory(FLOOD_ALERTS[0])}
            >
              Alert farmers
            </Button>
          </div>
        </div>
      )}

      <div className="mini-stat-grid">
        {stats.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.label} className="mini-stat">
              <span className={`mini-stat-icon tone-${item.tone}`}>
                <Icon size={17} />
              </span>
              <div>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.hint}</small>
              </div>
            </Card>
          )
        })}
      </div>

      <Card className="station-strip-card">
        <div className="station-strip-head">
          <div>
            <strong>Gauge network</strong>
            <span>Select a station to load its hydrograph</span>
          </div>
          <div className="station-filters">
            <label className="search-field">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search a river or gauge…"
                aria-label="Search rivers and gauges"
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={13} />
                </button>
              )}
            </label>
            <label className="select-field">
              <span>River</span>
              <select value={river} onChange={(event) => chooseRiver(event.target.value)} aria-label="Choose a river">
                <option value="all">All rivers ({RIVER_STATIONS.length} gauges)</option>
                {rivers.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name} ({count} gauge{count === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </label>
            <Badge tone="success" dot>
              {RIVER_SUMMARY.reporting} of {RIVER_SUMMARY.total} reporting
            </Badge>
          </div>
        </div>
        {shownStations.length === 0 && (
          <div className="station-empty">
            No river or gauge matches “{query}”{river !== 'all' ? ` on ${river}` : ''}.
          </div>
        )}
        <div className="station-strip">
          {shownStations.map((station) => (
            <button
              type="button"
              key={station.id}
              className={cn(
                'station-chip',
                selected.id === station.id && 'is-active',
                `station-${station.status}`,
              )}
              onClick={() => selectStation(station)}
            >
              <span className="station-chip-top">
                <i />
                <span>{station.river}</span>
                {station.status !== 'normal' && (
                  <span className={cn('station-alert-dot', `tone-${station.statusMeta.tone}`)} />
                )}
              </span>
              <strong>{station.name}</strong>
              <span className="station-river">{station.statusMeta.label}</span>
              <span className="station-reading">
                <strong>{metres(station.level)}</strong>
                <small className={changeClass(station.change)} title="Change in the last 3 hours">
                  {signed(station.change)}
                </small>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <section className="river-grid">
        <Card className="span-8 chart-card river-chart-card">
          <CardHeader
            icon={Waves}
            title={`${selected.name} - ${selected.river}`}
            subtitle={`Water level over the 24 hours to ${formatDateTime(selected.readingAt)}`}
            action={<StatusBadge meta={selected.statusMeta} />}
          />
          <div className="hydro-metrics">
            <div>
              <span>Current level</span>
              <strong>{metres(selected.level)}</strong>
              <small className={changeClass(selected.change)}>
                {selected.change > 0 && <ArrowUpRight size={13} />}
                {selected.change < 0 && <ArrowDownRight size={13} />}
                {signed(selected.change)} in 3 h
              </small>
            </div>
            <div>
              <span>Alert level</span>
              <strong>{metres(selected.warning)}</strong>
              <small>Minor flood {metres(selected.minor)}</small>
            </div>
            <div>
              <span>Major flood</span>
              <strong>{metres(selected.major)}</strong>
              <small>{toMajor(selected.thresholdHeadroom)}</small>
            </div>
            <div>
              <span>Rain - last 24 h</span>
              <strong>{rain(selected.rainfall)}</strong>
              <small>Total of the gauge's reports</small>
            </div>
          </div>
          <div className="chart-box" style={{ height: 286 }}>
            <RiverHydrograph
              data={selected.history}
              warning={selected.warning}
              major={selected.major}
            />
          </div>
          <div className="chart-caption">
            <span>
              <i style={{ background: TONE_HEX[selected.statusMeta.tone] }} />
              {selected.river} - {selectedHistory.length} level readings
            </span>
            <span>
              {selected.level === null
                ? 'This gauge reports rain only, no water level'
                : selected.warning === null
                  ? 'This gauge has no flood levels'
                  : 'Dashed lines: alert and major flood levels'}
            </span>
          </div>
        </Card>

        <Card className="span-4 station-snapshot">
          <CardHeader
            icon={MapPin}
            title="Station snapshot"
            subtitle={
              selected.latitude !== null
                ? `${selected.latitude.toFixed(4)}° N, ${selected.longitude.toFixed(4)}° E`
                : selected.river
            }
          />
          <div className="snapshot-body">
            <div className="snapshot-gauge">
              <Gauge
                value={selected.percentOfMajor}
                label="of the major flood level"
                tone={TONE_HEX[selected.statusMeta.tone]}
                size="md"
              />
            </div>
            <div className="snapshot-status">
              <StatusBadge meta={selected.statusMeta} />
              <p>{selected.statusMeta.description}</p>
            </div>
            <div className="snapshot-stats">
              <div>
                <span>Water level</span>
                <strong>{metres(selected.level)}</strong>
              </div>
              <div>
                <span>Minor flood level</span>
                <strong>{metres(selected.minor)}</strong>
              </div>
              <div>
                <span>Major flood level</span>
                <strong>{toMajor(selected.thresholdHeadroom)}</strong>
              </div>
              <div>
                <span>Rain - last 24 h</span>
                <strong>{rain(selected.rainfall)}</strong>
              </div>
            </div>
            <div className="snapshot-spark">
              <div className="snapshot-spark-head">
                <span>24-hour trend</span>
                <strong className={selected.trend === 'rising' ? 'is-rising' : selected.trend === 'falling' ? 'is-falling' : ''}>
                  {TREND_LABEL[selected.trend] || 'Not enough readings'}
                </strong>
              </div>
              <Sparkline
                data={selectedHistory}
                width={320}
                height={52}
                color={TONE_HEX[selected.statusMeta.tone]}
              />
            </div>
          </div>
          <div className="snapshot-actions">
            <Button
              variant="secondary"
              size="sm"
              icon={MessageSquareText}
              onClick={() => sendAdvisory(selected)}
            >
              Send advisory
            </Button>
          </div>
        </Card>
      </section>

      <Card className="table-card river-table-card">
        <CardHeader
          icon={Radio}
          title="All gauge readings"
          subtitle="Latest level and flood thresholds for each gauge"
          action={
            <div className="segmented">
              <button
                type="button"
                className={tableFilter === 'all' ? 'active' : ''}
                onClick={() => setTableFilter('all')}
              >
                All gauges
              </button>
              <button
                type="button"
                className={tableFilter === 'alerts' ? 'active' : ''}
                onClick={() => setTableFilter('alerts')}
              >
                At or above alert level
              </button>
            </div>
          }
        />
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Station</th>
                <th>River</th>
                <th>Level</th>
                <th>Alert</th>
                <th>Minor flood</th>
                <th>Major flood</th>
                <th>To major flood</th>
                <th>Rain - 24 h</th>
                <th>Change - 3 h</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {tableStations.map((station) => (
                <tr
                  key={station.id}
                  className={cn('clickable-row', selected.id === station.id && 'is-selected')}
                  onClick={() => selectStation(station)}
                >
                  <td>
                    <div className="cell-primary">
                      <span className={cn('cell-avatar', `tone-${station.statusMeta.tone}`)}>
                        <Waves size={15} />
                      </span>
                      <div>
                        <strong>{station.name}</strong>
                        <small>{formatDateTime(station.readingAt)}</small>
                      </div>
                    </div>
                  </td>
                  <td className="muted-cell">{station.river}</td>
                  <td>
                    <span className="level-value">{metres(station.level)}</span>
                  </td>
                  <td className="muted-cell">{metres(station.warning, 1)}</td>
                  <td className="muted-cell">{metres(station.minor, 1)}</td>
                  <td className="muted-cell">{metres(station.major, 1)}</td>
                  <td>
                    <div className="headroom-cell">
                      <Progress
                        value={station.percentOfMajor}
                        tone={station.statusMeta.tone}
                        size="xs"
                      />
                      <small>{toMajor(station.thresholdHeadroom)}</small>
                    </div>
                  </td>
                  <td className="numeric-cell">{rain(station.rainfall)}</td>
                  <td>
                    <span className={cn('trend-cell', changeClass(station.change))}>
                      {station.change > 0 && <ArrowUpRight size={14} />}
                      {station.change < 0 && <ArrowDownRight size={14} />}
                      {signed(station.change)}
                    </span>
                  </td>
                  <td>
                    <StatusBadge meta={station.statusMeta} />
                  </td>
                  <td>
                    <ArrowRight size={15} className="row-chevron" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>
            <span className="status-dot" />
            Readings from the Irrigation Department river gauge network
          </span>
        </div>
      </Card>

    </div>
  )
}
