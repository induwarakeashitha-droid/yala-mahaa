// SMS campaigns sent from this portal (GET /admin/sms/campaigns)

export const SMS_TEMPLATES = [
  {
    id: 'tpl-flood',
    name: 'Flood warning',
    category: 'Emergency',
    body:
      'Yala Maha ALERT: {{river}} {{level}} at {{station}}. Move livestock to higher ground and keep away from low-lying fields and roads.',
  },
  {
    id: 'tpl-release',
    name: 'Water release notice',
    category: 'Irrigation',
    body:
      'Yala Maha: Water release for {{scheme}} begins on {{date}}. Please prepare your field channels.',
  },
  {
    id: 'tpl-tank',
    name: 'Tank level',
    category: 'Irrigation',
    body:
      'Yala Maha: {{tank}} is at {{percent}}% storage. Plan your water use with your farmer organisation.',
  },
  {
    id: 'tpl-advisory',
    name: 'Crop advisory',
    category: 'Agronomy',
    body: 'Yala Maha ADVISORY: Dear {{name}}, ',
  },
]

// delivered = accepted by Text.lk; handset_* = Text.lk's report of what reached the phone.
// tracked = messages with a Text.lk id (0 for dry runs and campaigns sent before tracking)
const STATUS = (c) => {
  if (c.dry_run) return 'Dry run'
  if (!c.tracked) return c.failed === 0 ? 'Accepted' : c.delivered === 0 ? 'Failed' : 'Partly sent'
  if (c.pending) return 'Sending'
  if (c.reached === c.recipients) return 'Delivered'
  return c.reached === 0 ? 'Failed' : 'Partly delivered'
}

// Local calendar day, YYYY-MM-DD
const dayKey = (date) => date.toLocaleDateString('en-CA')

export function buildSms(rows = [], now = new Date()) {
  const CAMPAIGNS = rows.map((row) => {
    const c = {
      ...row,
      sentAt: new Date(row.created_at),
      reached: row.handset_delivered ?? 0,
      pending: row.handset_pending ?? 0,
      // not accepted by Text.lk, plus accepted but not delivered
      failedAll: row.failed + (row.handset_failed ?? 0),
    }
    return { ...c, status: STATUS(c) }
  })
  // real sends only; dry runs never left the server
  const live = CAMPAIGNS.filter((c) => !c.dry_run)

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const sumOf = (items, field) => items.reduce((total, item) => total + (item[field] || 0), 0)
  const today = live.filter((c) => c.sentAt >= startOfToday)
  const month = live.filter((c) => c.sentAt >= startOfMonth)
  const tracked = live.filter((c) => c.tracked)
  const settled = sumOf(tracked, 'reached') + sumOf(tracked, 'failedAll')

  // The last 7 days, oldest first
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(startOfToday)
    date.setDate(date.getDate() - (6 - index))
    return date
  })
  const SMS_VOLUME_TREND = days.map((date) => {
    const items = live.filter((c) => dayKey(c.sentAt) === dayKey(date))
    return {
      day: date.toLocaleDateString('en-GB', { weekday: 'short' }),
      sent: sumOf(items, 'recipients'),
      // accepted and not reported failed later, so a message is never counted twice
      delivered: sumOf(items, 'delivered') - sumOf(items, 'handset_failed'),
      failed: sumOf(items, 'failedAll'),
    }
  })

  return {
    CAMPAIGNS,
    SMS_VOLUME_TREND,
    SMS_SUMMARY: {
      campaigns: CAMPAIGNS.length,
      sentToday: sumOf(today, 'delivered'),
      sentMonth: sumOf(month, 'delivered'),
      failedMonth: sumOf(month, 'failedAll'),
      reached: sumOf(tracked, 'reached'),
      pending: sumOf(tracked, 'pending'),
      failed: sumOf(live, 'failedAll'),
      cost: sumOf(live, 'cost'),
      // of messages whose fate is known, how many reached the phone
      deliveryRate: settled ? Number(((sumOf(tracked, 'reached') / settled) * 100).toFixed(1)) : null,
      lastSent: live[0]?.sentAt || null,
    },
  }
}
