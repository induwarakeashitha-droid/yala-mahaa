// Alerts built from live data (useFarmConditions) plus the app's own notes (e.g. farm registered).
// Ids include the reading/date, so a new reading makes a new unread alert. Read ids are kept in app state.
import { useMemo } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { fmtDay } from '../components/ForecastChart.jsx';
import { LOW_PCT } from './reservoirs.js';

const DATE = { day: 'numeric', month: 'short' };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });

export function useAlerts(live) {
  const { t, lang, alerts: notes, readAlerts } = useApp();
  const { flood, own, tank, readings, issue, issueStatus, today } = live;
  const latest = readings.data?.latest;

  return useMemo(() => {
    const list = [];
    if (flood?.level > 0) {
      list.push({
        id: `flood:${flood.name}:${flood.level}:${flood.at?.slice(0, 10)}`,
        kind: 'flood',
        title: `${t('floodWatch')} - ${flood.river}`,
        body: `${t(`floodLevel${flood.level}`)}. ${flood.name}: ${flood.gaugeLevel} m${flood.trend ? `, ${t(flood.trend)}` : ''}.`,
        when: hhmm(flood.at),
      });
    }
    // only the farm's own tank, not a nearby one
    if (own && tank?.id === own.id && latest) {
      const when = fmtDay(latest.date, lang, DATE);
      if (latest.spilling) {
        list.push({ id: `spill:${own.id}:${latest.date}`, kind: 'tank', title: `${own.name} - ${t('spilling')}`, body: `${Math.round(latest.percent)}% ${t('full')}${latest.spillRate != null ? ` - ${latest.spillRate} cusec` : ''}.`, when });
      } else if (latest.percent < LOW_PCT) {
        list.push({ id: `low:${own.id}:${latest.date}`, kind: 'tank', title: `${own.name} - ${t('tankLow')}`, body: `${Math.round(latest.percent)}% ${t('full')}. ${t('adviceLow')}`, when });
      }
    }
    if (issue) {
      const range = `${fmtDay(issue.start, lang, DATE)} – ${fmtDay(issue.end, lang, DATE)}`;
      if (issueStatus === 'scheduled' && daysBetween(today, issue.start) <= 7) {
        list.push({ id: `issue:${issue.id}:soon`, kind: 'release', title: `${t('issueStarts')} ${fmtDay(issue.start, lang, DATE)}`, body: `${issue.name} - ${range}`, when: fmtDay(today, lang, DATE) });
      } else if (issueStatus === 'flowing' && daysBetween(issue.start, today) <= 3) {
        list.push({ id: `issue:${issue.id}:on`, kind: 'release', title: `${t('flowing')} - ${issue.name}`, body: `${t('issueUntil')} ${fmtDay(issue.end, lang, DATE)}`, when: fmtDay(issue.start, lang, DATE) });
      }
    }
    const read = new Set(readAlerts);
    return [...list.map((a) => ({ ...a, read: read.has(a.id) })), ...notes];
  }, [flood, own, tank, latest, issue, issueStatus, today, notes, readAlerts, t, lang]);
}
