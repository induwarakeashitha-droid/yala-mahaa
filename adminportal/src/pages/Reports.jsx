import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  ExternalLink,
  Inbox,
  MapPin,
  Save,
  Search,
  Send,
  Trash2,
  UserRound,
  X,
  XCircle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { api, apiBlob } from '../api/client'
import { csvPhone, formatPhone } from '../data/farmers'
import { cn, csvTime, downloadCsv, formatDateTime, formatNumber } from '../utils/format'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Drawer, Modal } from '../components/ui/Overlay'

const PAGE_SIZE = 20

export const REPORT_STATUS = {
  new: { label: 'New', tone: 'info', icon: Inbox, hint: 'Waiting to be checked' },
  forwarded: { label: 'Forwarded', tone: 'primary', icon: Send, hint: 'Sent to the Irrigation Department' },
  in_progress: { label: 'In progress', tone: 'warning', icon: Clock3, hint: 'Being repaired' },
  resolved: { label: 'Resolved', tone: 'success', icon: CheckCircle2, hint: 'Fixed' },
  rejected: { label: 'Closed', tone: 'neutral', icon: XCircle, hint: 'Duplicate or not a canal problem' },
}

const ISSUE_LABELS = {
  blockage: 'Blocked / silted',
  leak: 'Water leak',
  gate: 'Broken gate',
  no_water: 'No water',
  other: 'Something else',
}

function getPageNumbers(total, current) {
  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set([1, total, current, current - 1, current + 1])
  return [...pages].filter((page) => page > 0 && page <= total).sort((a, b) => a - b)
}

// Photos need the sign-in token, so they are loaded as object URLs
function ReportPhotos({ report, onOpen }) {
  const [urls, setUrls] = useState([])
  useEffect(() => {
    let cancelled = false
    const made = []
    Promise.all(report.photos.map((photo) => apiBlob(`/admin/reports/${report.id}/photos/${photo.id}`).catch(() => null))).then(
      (list) => {
        made.push(...list.filter(Boolean))
        if (!cancelled) setUrls(list.filter(Boolean))
      },
    )
    return () => {
      cancelled = true
      made.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [report.id, report.photos])

  if (!report.photos.length) return <p className="muted-cell">No photos were attached.</p>
  if (!urls.length) return <p className="muted-cell">Loading {report.photos.length} photo(s)…</p>
  return (
    <div className="report-photos">
      {urls.map((url, index) => (
        <button type="button" key={url} className="report-photo" onClick={() => onOpen(url)} aria-label={`Open photo ${index + 1}`}>
          <img src={url} alt={`Photo ${index + 1} of ${report.code}`} />
        </button>
      ))}
    </div>
  )
}

export function Reports() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { canEdit } = useAuth()
  const { REPORT_COUNTS, reload } = useData()
  const [searchParams, setSearchParams] = useSearchParams()
  const status = searchParams.get('status') || 'all'
  const [issue, setIssue] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [list, setList] = useState({ rows: [], total: 0, loading: true })
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bigPhoto, setBigPhoto] = useState(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (status !== 'all') params.set('status', status)
    if (issue !== 'all') params.set('issue_type', issue)
    if (query.trim()) params.set('q', query.trim())
    setList((current) => ({ ...current, loading: true }))
    try {
      const result = await api(`/admin/reports?${params}`)
      setList({ rows: result.data, total: result.total, loading: false })
    } catch (error) {
      setList({ rows: [], total: 0, loading: false, error: error.message })
    }
  }, [page, status, issue, query])

  useEffect(() => {
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    setPage(1)
  }, [status, issue, query])

  const chooseStatus = (value) => {
    const params = new URLSearchParams(searchParams)
    if (value === 'all') params.delete('status')
    else params.set('status', value)
    setSearchParams(params, { replace: true })
  }

  const open = (report) => {
    setSelected(report)
    setConfirmDelete(false)
    setForm({ status: report.status, forwarded_to: report.forwarded_to || '', admin_note: report.admin_note || '' })
  }

  const close = () => {
    setSelected(null)
    setForm(null)
    setConfirmDelete(false)
  }

  const afterChange = () => {
    load()
    reload(['reports'])
  }

  const save = async (event) => {
    event.preventDefault()
    const changes = {}
    if (form.status !== selected.status) changes.status = form.status
    if (form.forwarded_to.trim() !== (selected.forwarded_to || '')) changes.forwarded_to = form.forwarded_to
    if (form.admin_note.trim() !== (selected.admin_note || '')) changes.admin_note = form.admin_note
    if (!Object.keys(changes).length) {
      toast('Nothing has changed.', { tone: 'info' })
      return
    }
    if (changes.status === 'forwarded' && !form.forwarded_to.trim()) {
      toast('Say which office or officer the report was sent to.', { tone: 'error' })
      return
    }
    setSaving(true)
    try {
      const result = await api(`/admin/reports/${selected.id}`, { method: 'PATCH', body: changes })
      open(result.data)
      afterChange()
      toast(`${result.data.code} is now ${REPORT_STATUS[result.data.status].label.toLowerCase()}.`, {
        title: 'Report updated',
        tone: 'success',
      })
    } catch (error) {
      toast(error.message, { title: 'Not saved', tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      await api(`/admin/reports/${selected.id}`, { method: 'DELETE' })
      toast(`${selected.code} and its photos were deleted.`, { title: 'Report deleted', tone: 'success' })
      close()
      afterChange()
    } catch (error) {
      toast(error.message, { title: 'Not deleted', tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (status !== 'all') params.set('status', status)
      if (issue !== 'all') params.set('issue_type', issue)
      if (query.trim()) params.set('q', query.trim())
      const rows = []
      for (let next = 1; ; next += 1) {
        params.set('page', String(next))
        const result = await api(`/admin/reports?${params}`)
        rows.push(...result.data)
        if (rows.length >= result.total || !result.data.length) break
      }
      downloadCsv(
        `YalaMaha-canal-reports-${new Date().toLocaleDateString('en-CA')}.csv`,
        rows.map((report) => ({
          Report: report.code,
          Problem: ISSUE_LABELS[report.issue_type],
          Canal: report.canal_name,
          Scheme: report.scheme ?? '',
          Description: report.description ?? '',
          Farmer: report.farmer_name ?? '',
          Phone: csvPhone(report.farmer_phone),
          District: report.district ?? '',
          Latitude: report.latitude ?? '',
          Longitude: report.longitude ?? '',
          Photos: report.photos.length,
          Status: REPORT_STATUS[report.status].label,
          'Forwarded to': report.forwarded_to ?? '',
          'Admin note': report.admin_note ?? '',
          Reported: csvTime(report.created_at),
          Forwarded: csvTime(report.forwarded_at),
          Resolved: csvTime(report.resolved_at),
        })),
      )
      toast(`${rows.length} reports exported.`, { title: 'CSV ready', tone: 'success' })
    } catch (error) {
      toast(error.message, { title: 'Export failed', tone: 'error' })
    }
  }

  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE))
  const allCount = Object.values(REPORT_COUNTS).reduce((sum, value) => sum + value, 0)

  return (
    <div className="page reports-page">
      <PageHeader
        eyebrow="Farmer services"
        badge={
          <Badge tone={REPORT_COUNTS.new ? 'warning' : 'success'} dot>
            {REPORT_COUNTS.new} new
          </Badge>
        }
        title="Canal reports"
        description="Canal problems farmers reported in the farmer portal. Check them, pass them to the Irrigation Department and record what happened. Farmers see the status and your note."
        actions={
          <Button icon={Download} variant="secondary" onClick={handleExport} disabled={!allCount}>
            Export CSV
          </Button>
        }
      />

      <div className="report-status-grid">
        {[['all', { label: 'All reports', tone: 'primary', icon: ClipboardList, hint: 'Every report' }], ...Object.entries(REPORT_STATUS)].map(
          ([key, meta]) => {
            const Icon = meta.icon
            const count = key === 'all' ? allCount : REPORT_COUNTS[key]
            return (
              <Card
                key={key}
                className={cn('mini-stat mini-stat-action', status === key && 'is-selected')}
                onClick={() => chooseStatus(key)}
              >
                <span className={`mini-stat-icon tone-${meta.tone === 'neutral' ? 'primary' : meta.tone}`}>
                  <Icon size={17} />
                </span>
                <div>
                  <span>{meta.label}</span>
                  <strong>{formatNumber(count)}</strong>
                  <small>{meta.hint}</small>
                </div>
              </Card>
            )
          },
        )}
      </div>

      <Card className="table-card">
        <CardHeader
          icon={ClipboardList}
          title={status === 'all' ? 'All reports' : `${REPORT_STATUS[status]?.label} reports`}
          subtitle="Newest first. Click a report to see its photos and update it."
          action={<Badge tone="info">{formatNumber(list.total)} reports</Badge>}
        />
        <div className="schedule-toolbar">
          <label className="search-field">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search canal, farmer, district, REP- or FAR- number…"
              aria-label="Search reports"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </label>
          <label className="select-field">
            <span>Problem</span>
            <select value={issue} onChange={(event) => setIssue(event.target.value)}>
              <option value="all">All problems</option>
              {Object.entries(ISSUE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Report</th>
                <th>Canal</th>
                <th>Farmer</th>
                <th>Photos</th>
                <th>Status</th>
                <th>Reported</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((report) => (
                <tr key={report.id} className="clickable-row" onClick={() => open(report)}>
                  <td>
                    <div className="cell-primary">
                      <span className={cn('cell-avatar', `tone-${REPORT_STATUS[report.status].tone}`)}>
                        <ClipboardList size={15} />
                      </span>
                      <div>
                        <strong>{ISSUE_LABELS[report.issue_type]}</strong>
                        <small>{report.code}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack">
                      <strong>{report.canal_name}</strong>
                      <small>{report.schedule_id ? 'From the canal list' : 'Typed by the farmer'}</small>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack">
                      <strong>{report.farmer_name || 'Farmer deleted'}</strong>
                      <small>{report.district || '—'}</small>
                    </div>
                  </td>
                  <td className="muted-cell">
                    {report.photos.length ? (
                      <span className="inline-icon">
                        <Camera size={13} /> {report.photos.length}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <Badge tone={REPORT_STATUS[report.status].tone} dot>
                      {REPORT_STATUS[report.status].label}
                    </Badge>
                  </td>
                  <td className="muted-cell">{formatDateTime(report.created_at)}</td>
                  <td>
                    <ChevronRight size={15} className="row-chevron" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.loading && list.rows.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">
              <ClipboardList size={22} />
            </span>
            <strong>{list.error ? 'Reports could not be loaded' : allCount ? 'No reports match' : 'No reports yet'}</strong>
            <span>{list.error || (allCount ? 'Try another status, problem or search.' : 'Reports farmers send from the farmer portal appear here.')}</span>
          </div>
        )}
        <div className="table-footer pagination-footer">
          <span>
            {list.loading
              ? 'Loading…'
              : `Showing ${list.total ? (page - 1) * PAGE_SIZE + 1 : 0}–${Math.min(page * PAGE_SIZE, list.total)} of ${formatNumber(list.total)}`}
          </span>
          <div className="pagination">
            <button type="button" className="page-btn" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
              <ArrowLeft size={15} />
            </button>
            {getPageNumbers(totalPages, page).map((item, index, array) => (
              <span key={item} className="page-number-wrap">
                {index > 0 && item - array[index - 1] > 1 && <span className="page-ellipsis">…</span>}
                <button type="button" className={cn('page-btn', item === page && 'active')} onClick={() => setPage(item)}>
                  {item}
                </button>
              </span>
            ))}
            <button
              type="button"
              className="page-btn"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              aria-label="Next page"
            >
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </Card>

      <Drawer
        open={Boolean(selected)}
        onClose={close}
        title={selected ? `${ISSUE_LABELS[selected.issue_type]} - ${selected.code}` : 'Report'}
        description={selected ? `${selected.canal_name} - reported ${formatDateTime(selected.created_at)}` : ''}
        icon={ClipboardList}
        width="md"
        footer={
          selected &&
          canEdit &&
          (confirmDelete ? (
            <div className="drawer-actions">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={saving}>
                Keep report
              </Button>
              <Button variant="danger" icon={Trash2} loading={saving} onClick={remove}>
                Delete permanently
              </Button>
            </div>
          ) : (
            <div className="drawer-actions">
              <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
              <Button variant="primary" icon={Save} type="submit" form="report-update" loading={saving}>
                Save changes
              </Button>
            </div>
          ))
        }
      >
        {selected && (
          <div className="report-detail">
            {confirmDelete && (
              <div className="detail-banner warning">
                <Trash2 size={17} />
                <div>
                  <strong>Delete {selected.code}?</strong>
                  <span>The report and its photos are removed for good, and the farmer no longer sees it. To keep a record, set it to Closed instead.</span>
                </div>
              </div>
            )}

            <div className="detail-pill-row">
              <Badge tone={REPORT_STATUS[selected.status].tone} dot>
                {REPORT_STATUS[selected.status].label}
              </Badge>
              {selected.forwarded_at && (
                <Badge tone="neutral">
                  Forwarded {formatDateTime(selected.forwarded_at)}
                  {selected.forwarded_by_name ? ` by ${selected.forwarded_by_name}` : ''}
                </Badge>
              )}
              {selected.resolved_at && <Badge tone="success">Resolved {formatDateTime(selected.resolved_at)}</Badge>}
            </div>

            <div className="detail-section">
              <div className="detail-section-head">
                <strong>What the farmer said</strong>
              </div>
              <p className="report-description">{selected.description || 'No description was given.'}</p>
            </div>

            <div className="detail-section">
              <div className="detail-section-head">
                <strong>Photos</strong>
              </div>
              <ReportPhotos report={selected} onOpen={setBigPhoto} />
            </div>

            <div className="detail-section">
              <div className="detail-section-head">
                <strong>Where</strong>
              </div>
              <div className="detail-meta-list">
                <div>
                  <span>Canal</span>
                  <strong>{selected.canal_name}</strong>
                </div>
                <div>
                  <span>Scheme</span>
                  <strong>{selected.scheme || '—'}</strong>
                </div>
                <div>
                  <span>Location</span>
                  <strong>
                    {selected.latitude !== null ? (
                      <a
                        className="text-btn"
                        href={`https://www.google.com/maps?q=${Number(selected.latitude)},${Number(selected.longitude)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MapPin size={13} />
                        {Number(selected.latitude).toFixed(5)}, {Number(selected.longitude).toFixed(5)}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      'Not given'
                    )}
                  </strong>
                </div>
              </div>
            </div>

            <div className="detail-section">
              <div className="detail-section-head">
                <strong>Farmer</strong>
                {selected.farm_id && (
                  <button type="button" className="text-btn" onClick={() => navigate(`/farmers?q=${encodeURIComponent(selected.farm_id)}`)}>
                    <UserRound size={13} />
                    Open farmer
                  </button>
                )}
              </div>
              <div className="detail-meta-list">
                <div>
                  <span>Name</span>
                  <strong>{selected.farmer_name || 'Farmer deleted'}</strong>
                </div>
                <div>
                  <span>Phone</span>
                  <strong>{selected.farmer_phone ? formatPhone(selected.farmer_phone) : '—'}</strong>
                </div>
                <div>
                  <span>Farm ID - district</span>
                  <strong>
                    {selected.farm_id || '—'} - {selected.district || '—'}
                  </strong>
                </div>
              </div>
            </div>

            {canEdit ? (
              <form id="report-update" className="form-grid" onSubmit={save}>
                <label className="field">
                  <span>Status</span>
                  <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                    {Object.entries(REPORT_STATUS).map(([value, meta]) => (
                      <option key={value} value={value}>
                        {meta.label} - {meta.hint}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Forwarded to</span>
                  <input
                    value={form.forwarded_to}
                    maxLength={200}
                    placeholder="e.g. Polonnaruwa irrigation engineer's office"
                    onChange={(event) => setForm((current) => ({ ...current, forwarded_to: event.target.value }))}
                  />
                </label>
                <label className="field span-2">
                  <span>Note to the farmer</span>
                  <textarea
                    value={form.admin_note}
                    maxLength={1000}
                    placeholder="Shown to the farmer in the farmer portal, e.g. An officer will visit on Monday."
                    onChange={(event) => setForm((current) => ({ ...current, admin_note: event.target.value }))}
                  />
                </label>
              </form>
            ) : (
              <div className="detail-meta-list">
                <div>
                  <span>Forwarded to</span>
                  <strong>{selected.forwarded_to || '—'}</strong>
                </div>
                <div>
                  <span>Note to the farmer</span>
                  <strong>{selected.admin_note || '—'}</strong>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={Boolean(bigPhoto)} onClose={() => setBigPhoto(null)} title={selected?.code || 'Photo'} icon={Camera} size="lg">
        {bigPhoto && <img className="report-photo-large" src={bigPhoto} alt="Report photo" />}
      </Modal>
    </div>
  )
}
