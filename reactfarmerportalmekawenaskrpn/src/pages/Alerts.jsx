import { useApp } from '../state/AppContext.jsx';
import { IconBtn } from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
import { useFarmConditions } from '../api/farm.js';
import { useAlerts } from '../api/alerts.js';

const KIND = {
  flood: { icon: 'warn', cls: 'amber' },
  release: { icon: 'drop', cls: 'blue' },
  tank: { icon: 'tank', cls: 'soft' },
  report: { icon: 'check', cls: 'green' },
  farm: { icon: 'leaf', cls: 'accent' },
};

export default function Alerts() {
  const { t, farm, update } = useApp();
  const alerts = useAlerts(useFarmConditions(farm));
  const unread = alerts.filter((a) => !a.read).length;
  // live alerts remember read ids, the app's own notes carry their read flag
  const markRead = (ids) => update((st) => ({
    readAlerts: [...new Set([...st.readAlerts, ...ids])].slice(-200),
    alerts: st.alerts.map((a) => (ids.includes(a.id) ? { ...a, read: true } : a)),
  }));
  const markAll = () => markRead(alerts.map((a) => a.id));
  const toggle = (id) => markRead([id]);

  return (
    <div className="screen">
      <div className="row gap10">
        <IconBtn icon="back" label={t('back')} to="/home" />
        <div className="grow" />
        {unread > 0 && <button type="button" className="chip-white btn" onClick={markAll}>{t('markAllRead')}</button>}
      </div>
      <h1 className="h1">{t('alerts')}</h1>
      {alerts.length === 0 && (
        <div className="empty">
          <div className="icon-tile soft big"><Icon name="bell" size={30} /></div>
          <div className="f16 fw600">{t('noAlerts')}</div>
        </div>
      )}
      <div className="col gap10">
        {alerts.map((a) => {
          const k = KIND[a.kind] || KIND.tank;
          return (
            <button key={a.id} type="button" className={`alert-row ${a.read ? '' : 'unread'}`} onClick={() => toggle(a.id)}>
              <div className={`icon-tile ${k.cls}`}><Icon name={k.icon} size={22} /></div>
              <div className="grow" style={{ textAlign: 'left' }}>
                <div className="row between gap8"><span className="f15 fw600">{a.title}</span><span className="f12 muted nowrap">{a.when}</span></div>
                <div className="f14 muted lh" style={{ marginTop: 2 }}>{a.body}</div>
              </div>
              {!a.read && <span className="unread-dot" aria-label="Unread" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
