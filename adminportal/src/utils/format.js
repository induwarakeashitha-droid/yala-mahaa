export const cn = (...classes) => classes.filter(Boolean).join(' ')

const numberFormatter = new Intl.NumberFormat('en-US')
const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export const formatNumber = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? '—'
    : numberFormatter.format(Number(value))

export const formatCompact = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? '—'
    : compactFormatter.format(Number(value))

export const formatDecimal = (value, digits = 1) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? '—'
    : Number(value).toFixed(digits)

export const formatPercent = (value, digits = 1) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? '—'
    : `${Number(value).toFixed(digits)}%`

export const formatDate = (value, options = {}) => {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...options,
  })
}

export const formatDateTime = (value) => {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export const titleCase = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\bOf\b/g, 'of')

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

export const slugify = (value = '') =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

// local time in a form spreadsheets read as a date, blank if missing
export const csvTime = (date) => {
  if (!date) return ''
  const d = new Date(date)
  return `${d.toLocaleDateString('en-CA')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

// returns false when there's nothing to download
export const downloadCsv = (filename, rows) => {
  if (!rows?.length) return false
  const headers = Object.keys(rows[0])
  const escape = (cell) => {
    let text = cell === null || cell === undefined ? '' : String(cell)
    // Text farmers typed could start with = + - @ and run as a formula in Excel (CSV injection).
    // A leading apostrophe makes the spreadsheet show it as plain text. Real numbers are left alone.
    if (typeof cell === 'string' && /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ].join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // revoking straight after click() can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return true
}

export const seededRandom = (seed) => {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
