import { lazy, Suspense, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { Link } from 'react-router-dom';
import { IconBtn } from '../components/UI.jsx';
import TankPicker from '../components/TankPicker.jsx';
import Icon from '../components/Icon.jsx';
import { COLORS } from '../theme.js';
import { fmtDay } from '../components/ForecastChart.jsx';
import { LOW_PCT, recentReadings } from '../api/reservoirs.js';
import { useFarmConditions } from '../api/farm.js';
import { issueStatus } from '../api/canals.js';
import { addReminder, removeReminder, useReminders } from '../api/reminders.js';

// Leaflet (~150 KB) only downloads when this page opens.
const WaterMap = lazy(() => import('../components/WaterMap.jsx'));

const DATE = { day: 'numeric', month: 'short' };

export default function Water() {
  const { t, lang, showToast, farm } = useApp();
  const [picked, setPicked] = useState(null);
  const live = useFarmConditions(farm, picked);
  const { tanks, issue, issues, today: todayIso } = live;
  const tankList = tanks.data || [];
  const reservoirId = live.tank?.id;
  const { data, error, reload } = live.readings;
  const week = recentReadings(data?.history || []);
  const name = data?.reservoir.name || live.tank?.name || '';
  const loadError = tanks.error || error;

  // SMS reminder the day before the next water issue starts (sent by the API)
  const reminders = useReminders(farm?.id);
  const [saving, setSaving] = useState(false);
  const canRemind = issue && live.issueStatus === 'scheduled';
  const remind = Boolean(canRemind && reminders.data?.some((r) => r.schedule_id === issue.id));
  const toggleRemind = async () => {
    setSaving(true);
    try {
      await (remind ? removeReminder(issue.id) : addReminder(issue.id));
      reminders.reload();
      showToast(remind ? t('reminderOff') : t('reminderOnToast'));
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="water-screen">
      <Suspense fallback={<div className="water-map" />}>
        <WaterMap pin={farm?.pin} tankName={farm?.water?.source === 'tank' ? farm.water.name : null} t={t} />
      </Suspense>

      <div className="map-top">
        <IconBtn icon="back" label={t('back')} to="/home" variant="glass" />
        <div className="map-title">{t('tankCanals')}</div>
      </div>

      <div className="water-sheet">
        <div className="row between wrap gap10">
          <div className="f16 fw600 row gap8 nowrap"><Icon name="drop" size={18} />{t('tankLevel7')}</div>
        </div>
        {tankList.length > 1 && <TankPicker tanks={tankList} value={reservoirId} onChange={setPicked} dark />}
        {loadError && (
          <div className="row between gap8 f14">
            <span className="dim">{loadError.message}</span>
            <button type="button" className="link-btn" onClick={() => (tanks.error ? tanks.reload() : reload())}>{t('tryAgain')}</button>
          </div>
        )}
        {!loadError && !data && <div className="f14 dim">{t('loadingReadings')}</div>}
        {data && !week.length && <div className="f14 dim">{t('noReadings')}</div>}
        {week.length > 0 && (
          <>
            <div className="chart" role="img" aria-label={`${name} level over the last ${week.length} readings, now ${week[week.length - 1].percent}%`}>
              <div className="chart-line" style={{ bottom: `${LOW_PCT}%` }}><span>{LOW_PCT}%</span></div>
              {week.map((h, i) => {
                const last = i === week.length - 1;
                return (
                  <div key={h.date} className={`chart-bar ${last ? 'now' : ''}`} style={{ height: `${Math.min(100, h.percent)}%` }}>
                    {last && <span className="chart-tip">{Math.round(h.percent)}%</span>}
                  </div>
                );
              })}
            </div>
            <div className="chart-x" style={{ gridTemplateColumns: `repeat(${week.length}, minmax(0, 1fr))`, columnGap: 6 }}>
              {week.map((h, i) => (
                <span key={h.date} className={i === week.length - 1 ? 'on' : ''}>
                  {h.date === todayIso ? t('today') : fmtDay(h.date, lang, { day: 'numeric', month: 'short' })}
                </span>
              ))}
            </div>
          </>
        )}
        <Link to={`/forecast?reservoir=${reservoirId ?? ''}`} className="pill-btn accent big">
          <span className="row gap8"><Icon name="spark" size={18} />{t('seeForecast')}</span>
          <span className="round-arrow"><Icon name="arrow" size={18} color="#fff" stroke={2.4} /></span>
        </Link>
        <div className="hr dark" />
        <div className="f14 fw600">{t('releaseSchedule')}</div>
        {!issues.length && (
          <div className="f14 dim lh">
            {live.canals.error ? live.canals.error.message : !live.canals.data ? t('loadingSchedule') : `${t('noSchedule')}${farm?.water?.name || live.own?.name ? ` - ${farm?.water?.name || live.own?.name}` : ''}`}
          </div>
        )}
        <div className="col gap8">
          {issues.map((c) => {
            const on = c === issue;
            return (
              <div key={c.id} className="sched-row">
                <span className="sd" style={{ background: on ? 'var(--accent)' : COLORS.muted }} />
                <span className={`grow ${on ? 'fw600' : ''}`}>{c.name}</span>
                <span className="dim nowrap">{fmtDay(c.start, lang, DATE)} – {fmtDay(c.end, lang, DATE)} - {t(issueStatus(c, todayIso))}</span>
              </div>
            );
          })}
        </div>
        {canRemind && (
          <button type="button" className={`pill-btn ${remind ? 'accent' : 'white'} big`} onClick={toggleRemind} disabled={saving || !reminders.data}>
            {remind ? t('reminderOn') : t('remindSms')}
            <span className="round-arrow"><Icon name={remind ? 'check' : 'bell'} size={18} color="#fff" stroke={2.2} /></span>
          </button>
        )}
      </div>
    </div>
  );
}
