import { useState } from 'react';
import { Link } from 'react-router-dom';
import { greetingKey, maskPhone, useApp } from '../state/AppContext.jsx';
import { Aerial, Card, IconBtn, LangSwitch, Logo, StatusLabel, StatusPill } from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import { CROP_CATALOG, FLOOD_STEPS, PHOTOS } from '../data.js';
import TankPicker from '../components/TankPicker.jsx';
import { fmtDay } from '../components/ForecastChart.jsx';
import { LOW_PCT, forecastRisk, recentReadings, useReservoirForecast } from '../api/reservoirs.js';
import { useFarmConditions } from '../api/farm.js';
import { rainAdvice } from '../api/weather.js';
import { useAlerts } from '../api/alerts.js';
import { COLORS } from '../theme.js';

// Standard weather symbols, tinted like Apple Weather (see .wx-* in styles.css).
const WX_ICON = { sun: 'sun', cloud: 'cloudSun', rain: 'rain' };
const RISK_KEY ={ spill: 'spillRisk', lowWater: 'lowRisk', stable: 'stable' };

// One-line 14-day outlook inside the tank card; the full chart lives on /forecast.
function ForecastRow({ reservoirId, t }) {
  const { data, error } = useReservoirForecast(reservoirId);
  const risk = data ? forecastRisk(data) : null;
  let line = t('loadingForecast');
  if (data) line = `${Math.round(data.next)}% ${t('in14')} - ${data.change >= 0 ? '+' : ''}${data.change}%`;
  else if (error) line = error.reason ? t(error.reason) : error.message;
  return (
    <Link to={`/forecast?reservoir=${reservoirId}`} className="forecast-row">
      <span className="icon-tile blue sm-tile"><Icon name="spark" size={18} /></span>
      <span className="grow min0">
        <span className="block f15 fw600">{t('outlook14')}</span>
        <span className="block f13 muted">{line}</span>
      </span>
      {risk && <StatusLabel status={risk}>{t(RISK_KEY[risk])}</StatusLabel>}
      <Icon name="chevron" size={18} stroke={2.2} />
    </Link>
  );
}

const season = (date) => ([3, 4, 5, 6, 7, 8].includes(date.getMonth()) ? 'Yala' : 'Maha');

// Level, storage and the last week of readings for one reservoir, all from the API.
function TankCard({ tanks, reservoirId, readings, onPick, lang, t }) {
  const { data, loading, error, reload } = readings;
  const latest = data?.latest;
  const week = recentReadings(data?.history || []);
  const prev = week.length > 1 ? week[week.length - 2] : null;
  const perDay = latest && prev && latest.date > prev.date
    ? Math.round(((latest.percent - prev.percent) / ((Date.parse(latest.date) - Date.parse(prev.date)) / 864e5)) * 10) / 10
    : null;
  const status = latest ? (latest.percent < LOW_PCT ? 'low' : 'safe') : null;

  return (
    <Card>
      <div className="row gap8 f15 fw600">
        <Icon name="pin" size={18} />
        <span className="grow ellipsis">{data?.reservoir.name || tanks.find((x) => x.id === reservoirId)?.name}</span>
        {latest?.spilling ? <StatusLabel status="spill">{t('spilling')}</StatusLabel> : status && <StatusPill status={status} t={t} />}
      </div>
      {tanks.length > 1 && <TankPicker tanks={tanks} value={reservoirId} onChange={onPick} />}

      {!data && loading && <div className="f14 muted">{t('loadingReadings')}</div>}
      {!data && error && (
        <div className="row between gap8 f14">
          <span className="muted">{error.message}</span>
          <button type="button" className="link-btn" onClick={reload}>{t('tryAgain')}</button>
        </div>
      )}
      {data && !latest && <div className="f14 muted">{t('noReadings')}</div>}

      {latest && (
        <>
          <div className="row end gap16">
            <div>
              <div className="big-num">{Math.round(latest.percent)}<span>%</span></div>
              <div className="f14 muted" style={{ marginTop: 6 }}>
                {t('full')} - {latest.storage?.toLocaleString()}{data.reservoir.capacity ? ` / ${data.reservoir.capacity.toLocaleString()}` : ''} ac-ft
              </div>
            </div>
            <div className="bars" role="img" aria-label={`Tank level over the last ${week.length} readings, now ${latest.percent}%`}>
              {week.map((h, i) => (
                <span key={h.date} className={i === week.length - 1 ? 'now' : i > 3 ? 'mid' : ''} style={{ height: `${Math.min(100, h.percent)}%` }} />
              ))}
            </div>
          </div>
          {latest.spilling && latest.spillRate != null && <div className="f13 muted">{t('spilling')} - {latest.spillRate} cusec</div>}
          <div className="hr" />
          <div className="grid3 f13">
            <div><div className="muted">{t('changeDay')}</div><div className="f15 fw600">{perDay == null ? '–' : `${perDay >= 0 ? '+' : ''}${perDay}%`}</div></div>
            <div><div className="muted">{t('rainPrevDay')}</div><div className="f15 fw600">{latest.rainMm == null ? '–' : `${latest.rainMm} mm`}</div></div>
            <div><div className="muted">{t('reading')}</div><div className="f15 fw600">{fmtDay(latest.date, lang, { day: 'numeric', month: 'short' })}</div></div>
          </div>
        </>
      )}
      <ForecastRow reservoirId={reservoirId} t={t} />
    </Card>
  );
}

// needsWater: from useFarmConditions (tank + rain), null while unknown.
export function FieldCards({ farm, needsWater = null, t }) {
  if (!farm) {
    return (
      <Card className="register-cta">
        <Aerial variant="b" height={120} photo={PHOTOS.farmers} tag="+ New" />
        <div className="f15 lh">{t('registerCta')}</div>
        <Link to="/register/identity" className="pill-btn dark">{t('registerFarm')} <Icon name="arrow" size={16} stroke={2.4} /></Link>
      </Card>
    );
  }
  return (
    <div className="field-grid">
      {farm.crops.map((c) => {
        return (
          <Link to="/fields" key={c.id} className="field-card">
            <Aerial variant={needsWater ? 'a' : 'b'} height={110} photo={needsWater ? PHOTOS.harvest : PHOTOS.paddy} />
            <div className="fc-foot">
              <div className="min0">
                <div className="f15 fw600 ellipsis">{c.type.replace(/ \(.*\)/, '')} - {c.variety.split(' (')[0]}</div>
                <div className="f12 muted">{c.acres} ac - {CROP_CATALOG[c.category]?.short || CROP_CATALOG[c.category]?.label}</div>
                {needsWater != null && <StatusLabel status={needsWater ? 'watch' : 'safe'}>{t(needsWater ? 'needsWater' : 'fieldGood')}</StatusLabel>}
              </div>
              <span className="round-arrow"><Icon name="chevron" size={14} stroke={2.6} color="#fff" /></span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });

// Nearest river gauge: a full warning card at alert level or above, a short line otherwise.
function FloodCard({ flood, rivers, onAdvice, t }) {
  if (!flood) {
    if (!rivers.data) return null;
    return <Card><div className="f14 muted">{t('noGaugeNear')}</div></Card>;
  }
  const gaugeLine = (
    <>
      {flood.river} - {flood.name}: <b className="ink">{flood.gaugeLevel} m</b>
      {flood.trend && <> <b className={flood.trend === 'rising' ? 'warning-text' : ''}>{flood.trend === 'rising' ? '↑' : flood.trend === 'falling' ? '↓' : '→'} {t(flood.trend)}</b></>}
    </>
  );
  if (!flood.level) {
    return (
      <Card>
        <div className="row between gap8">
          <span className="f15 fw600">{t('riverNormal')}</span>
          <span className="f12 muted">{hhmm(flood.at)}</span>
        </div>
        <div className="f14 muted lh">{gaugeLine} - {t('alertAt')} {flood.alert} m</div>
      </Card>
    );
  }
  return (
    <Card className="flood-card">
      <div className="row gap10">
        <span className="warn-badge"><Icon name="warn" size={14} stroke={2.6} />{t('floodWatch').toUpperCase()} - {t('level')} {flood.level} {t('of')} {flood.max}</span>
        <div className="grow" />
        <span className="f12 muted">{hhmm(flood.at)}</span>
      </div>
      <div className="f22 fw600 lh-tight">{flood.river} - {t(`floodLevel${flood.level}`)}</div>
      <div className="f14 muted lh">{t('riverGauge')} {gaugeLine}</div>
      <ol className="steps">
        {FLOOD_STEPS.slice(0, 2).map((st, i) => <li key={st}><span className="num-badge">{i + 1}</span>{st}</li>)}
      </ol>
      <button type="button" className="pill-btn white big" onClick={onAdvice}>
        {t('seeAdvice')}<span className="round-arrow"><Icon name="arrow" size={18} color="#fff" stroke={2.2} /></span>
      </button>
    </Card>
  );
}

const DAY = { weekday: 'short' };
const DATE = { day: 'numeric', month: 'short' };

// The farm's water issue from the Mahaweli schedule (dates only; the schedule has no times).
export function ReleaseCard({ farm, issue, status, canals, own, lang, t }) {
  if (!issue) {
    const source = farm?.water?.name || own?.name;
    return (
      <Link to="/water" className="card link-card">
        <div className="f15 fw600">{t('nextRelease')}</div>
        <div className="f14 muted lh">{canals.error ? canals.error.message : !canals.data ? t('loadingSchedule') : `${t('noSchedule')}${source ? ` - ${source}` : ''}`}</div>
      </Link>
    );
  }
  const shown = status === 'scheduled' ? issue.start : issue.end;
  const line = { scheduled: 'issueStarts', flowing: 'issueUntil', closed: 'issueEnded' }[status];
  return (
    <Link to="/water" className="card link-card">
      <div className="f15 fw600">{t('nextRelease')}</div>
      <div className="row gap14">
        <div className="date-tile"><small>{fmtDay(shown, lang, DAY).toUpperCase()}</small><b>{Number(shown.slice(8))}</b></div>
        <div className="min0">
          <div className="f22 fw600 tight">{t(line)} {fmtDay(shown, lang, DATE)}</div>
          <div className="f14 muted ellipsis">{issue.name} - {fmtDay(issue.start, lang, DATE)} – {fmtDay(issue.end, lang, DATE)}</div>
        </div>
      </div>
      <div className="seg seg-soft" aria-label="Water flow status">
        <span className={status === 'flowing' ? 'on' : ''}>{t('flowing')}</span>
        <span className={status === 'scheduled' ? 'on' : ''}>● {t('scheduled')}</span>
        <span className={status === 'closed' ? 'on' : ''}>{t('closed')}</span>
      </div>
    </Link>
  );
}

function RainCard({ rain, place, lang, t }) {
  const [dayIdx, setDayIdx] = useState(0);
  if (!rain.data) {
    if (!rain.error && !rain.loading) return null; // no farm pin or tank location
    return <Card><div className="f15 fw600">{t('rain3')}</div><div className="f14 muted">{rain.error ? rain.error.message : t('loadingRain')}</div></Card>;
  }
  const days = rain.data;
  const day = days[Math.min(dayIdx, days.length - 1)];
  const label = (d, i) => (i === 0 ? t('today') : fmtDay(d.date, lang, DAY));
  return (
    <Card className="weather-card">
      <div className="row between">
        <div className="f15 fw600">{t('rain3')}</div>
        {place && <span className="f13 muted row gap6 min0"><Icon name="pin" size={14} /><span className="ellipsis">{place}</span></span>}
      </div>
      <div className="row gap12 weather-hero">
        <span className={`wx wx-${day.icon}`}><Icon name={WX_ICON[day.icon]} size={88} stroke={1.5} /></span>
        <div className="grow right">
          <div className="weather-num">{day.mm}<span>mm</span></div>
          <div className="f15 fw600 brand-text">{label(day, days.indexOf(day))}{day.chance != null ? ` - ${day.chance}%` : ''}{day.heavy ? ' - ↑' : ''}</div>
        </div>
      </div>
      <div className="day-strip" role="radiogroup" aria-label={t('rain3')}>
        {days.map((f, i) => (
          <button key={f.date} type="button" role="radio" aria-checked={f === day}
            className={`day-chip ${f === day ? 'on' : ''}`} onClick={() => setDayIdx(i)}>
            <span className="f13 fw600">{label(f, i)}</span>
            <span className={`wx wx-${f.icon}`}><Icon name={WX_ICON[f.icon]} size={30} stroke={2} /></span>
            <span className="f15 fw600">{f.mm} mm</span>
          </button>
        ))}
      </div>
      <div className="note-box accent">
        <Icon name="spark" size={20} stroke={1.8} style={{ flex: 'none' }} />
        <span><b>{t('advice')}:</b> {t(rainAdvice(days))}</span>
      </div>
      <div className="f12 muted">{t('rainSource')}</div>
    </Card>
  );
}

export default function Home() {
  const { t, lang, user, farm, smsEnabled } = useApp();
  const [picked, setPicked] = useState(null);
  const live = useFarmConditions(farm, picked);
  const { tanks, readings, flood } = live;
  const tankList = tanks.data || [];
  const reservoirId = live.tank?.id;
  const [adviceOpen, setAdviceOpen] = useState(false);
  const unread = useAlerts(live).filter((a) => !a.read).length;
  const firstName = farm?.name?.split(' ')[0];
  const today = new Date();

  const refresh = () => {
    if (!tanks.data) tanks.reload();
    readings.reload();
    live.rivers.reload();
    live.rain.reload();
  };

  return (
    <div className="screen">
      <header className="row gap10">
        <Logo size={48} />
        <LangSwitch compact />
        <div className="grow" />
        <IconBtn icon="bell" label={`${t('alerts')} (${unread})`} to="/alerts" variant="plain" badge={unread > 0} />
        <Link to="/profile" className="avatar" aria-label={t('profile')}>{(farm?.name || 'F').split(' ').map((w) => w[0]).slice(0, 2).join('')}</Link>
      </header>

      <div className="row between end gap12">
        <div className="min0">
          <div className="f15 muted fw500">{t(greetingKey())}{firstName ? `, ${firstName}` : ''}</div>
          <h1 className="h1 xl">{t('farmOverview')}</h1>
        </div>
        <button type="button" className={`chip-white btn ${readings.loading || tanks.loading ? 'spinning' : ''}`} onClick={refresh} aria-label="Refresh readings">
          <Icon name="refresh" size={14} stroke={2.4} /> {fmtDay(readings.data?.latest?.date || live.today, lang, { day: 'numeric', month: 'short' })} - {season(today)}
        </button>
      </div>

      {/* Flood alert first — the most urgent question */}
      <FloodCard flood={flood} rivers={live.rivers} onAdvice={() => setAdviceOpen(true)} t={t} />

      {reservoirId != null ? (
        <TankCard tanks={tankList} reservoirId={reservoirId} readings={readings} onPick={setPicked} lang={lang} t={t} />
      ) : (
        <Card>
          <div className="row between gap8 f14">
            <span className="muted">{tanks.error ? tanks.error.message : t('loadingReadings')}</span>
            {tanks.error && <button type="button" className="link-btn" onClick={tanks.reload}>{t('tryAgain')}</button>}
          </div>
        </Card>
      )}

      <ReleaseCard farm={farm} issue={live.issue} status={live.issueStatus} canals={live.canals} own={live.own} lang={lang} t={t} />

      <RainCard rain={live.rain} place={farm?.nearest || live.own?.name} lang={lang} t={t} />

      <div className="row between" style={{ marginTop: 4 }}>
        <h2 className="h2">{t('myFields')}{farm ? ` (${farm.crops.length})` : ''}</h2>
        {farm && <Link to="/fields" className="f14 fw600 ink">{t('editCrops')}</Link>}
      </div>
      <FieldCards farm={farm} needsWater={live.needsWater} t={t} />

      <Card className="sms-card">
        <div className="icon-tile green"><Icon name="sms" size={24} color={COLORS.success} /></div>
        <div className="grow min0">
          <div className="f15 fw600">{smsEnabled ? t('smsConnected') : `${t('smsAlerts')} - off`}</div>
          <div className="f13 muted">{maskPhone(user.phone)} - {t('worksNoData')}</div>
        </div>
      </Card>

      {flood?.level > 0 && (
        <Sheet open={adviceOpen} onClose={() => setAdviceOpen(false)} title={`${flood.river} - ${t('floodWatch')}`}>
          <div className="f14 muted">{t('level')} {flood.level} {t('of')} {flood.max} - {flood.name} {flood.gaugeLevel} m</div>
          <div className="level-meter" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }} aria-hidden="true">{[1, 2, 3].map((n) => <span key={n} className={n <= flood.level ? `on l${n + 1}` : ''} />)}</div>
          <ol className="steps light">
            {FLOOD_STEPS.map((st, i) => <li key={st}><span className="num-badge">{i + 1}</span>{st}</li>)}
          </ol>
          <Link to="/water" className="pill-btn dark big" onClick={() => setAdviceOpen(false)}>{t('tankCanals')} <Icon name="arrow" size={18} stroke={2.2} /></Link>
        </Sheet>
      )}
    </div>
  );
}
