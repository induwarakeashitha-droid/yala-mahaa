import { useCallback, useEffect, useState } from 'react'
import { BellOff, BellRing } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { formatDateTime } from '../utils/format'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'

// The on/off switch for the API's automatic flood alert SMS (API/services/floodAlertJob.js)
export function AutoFloodAlerts({ compact = false }) {
  const { canEdit } = useAuth()
  const { toast } = useToast()
  const [state, setState] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    api('/admin/sms/auto-alerts')
      .then((result) => setState(result.data))
      .catch(() => setState(null))
  }, [])
  useEffect(load, [load])

  const toggle = async () => {
    setSaving(true)
    try {
      const enabled = !state.enabled
      await api('/admin/sms/auto-alerts', { method: 'PUT', body: { enabled } })
      toast(
        enabled
          ? 'Farmers near a gauge at alert or flood level will get an SMS within about 10 minutes.'
          : 'No flood SMS will be sent automatically. You can still send them by hand.',
        { title: enabled ? 'Automatic flood alerts on' : 'Automatic flood alerts off', tone: enabled ? 'success' : 'warning' },
      )
      load()
    } catch (error) {
      toast(error.message, { title: 'Not changed', tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (!state) return null
  const on = state.enabled
  const sent = state.active.length

  return (
    <div className={`auto-alerts ${on ? 'is-on' : 'is-off'} ${compact ? 'is-compact' : ''}`}>
      <span className="auto-alerts-icon">{on ? <BellRing size={18} /> : <BellOff size={18} />}</span>
      <div className="auto-alerts-copy">
        <strong>
          Automatic flood SMS <Badge tone={on ? 'success' : 'neutral'} dot>{on ? 'On' : 'Off'}</Badge>
        </strong>
        <span>
          {on
            ? 'Farmers within 20 km of a gauge, or on its river, get one SMS when it reaches the alert level and one more if it reaches major flood.'
            : 'Turned off: gauges at alert or flood level do not send any SMS.'}
          {state.updated_by ? ` Changed by ${state.updated_by}, ${formatDateTime(new Date(state.updated_at))}.` : ''}
        </span>
        {!compact && sent > 0 && (
          <span>
            Handled in the current floods:{' '}
            {state.active
              .map((g) => {
                const done = g.major_sent_at ? 'major flood SMS sent' : 'alert SMS sent'
                const none = !(g.major_campaign_id || g.alert_campaign_id)
                return `${g.basin} at ${g.station} (${none ? 'no farmers nearby' : done})`
              })
              .join(', ')}
            .
          </span>
        )}
      </div>
      {canEdit && (
        <Button variant={on ? 'secondary' : 'primary'} size="sm" loading={saving} onClick={toggle}>
          {on ? 'Turn off' : 'Turn on'}
        </Button>
      )}
    </div>
  )
}
