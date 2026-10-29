// Everything live about one farm, from the same cached requests the pages use:
// its tank and latest reading, nearest river gauge, water issue schedule and 3-day rain.
import { LOW_PCT, useFarmReservoirs, useReservoirReadings } from './reservoirs.js';
import { FLOOD_MAX, floodLevel, nearestGauge, trend, useRivers } from './rivers.js';
import { currentIssue, farmSchedule, issueStatus, useCanals } from './canals.js';
import { useRainForecast } from './weather.js';

export const slToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function useFarmConditions(farm, reservoirId) {
  const tanks = useFarmReservoirs(farm);
  const tankList = tanks.data || [];
  const tank = tankList.find((x) => x.id === reservoirId) || tankList[0] || null;
  const readings = useReservoirReadings(tank?.id);
  const rivers = useRivers();
  const canals = useCanals();

  // The farm's own tank, not just the nearest one.
  const own = tankList[0] && (tankList[0].id === farm?.reservoirId
    || (farm?.water?.source === 'tank' && farm.water.name?.startsWith(tankList[0].name))) ? tankList[0] : null;
  const point = farm?.pin?.lat != null ? farm.pin : own?.lat != null ? own : null;
  const rain = useRainForecast(point);

  const today = slToday();
  const gauge = rivers.data ? nearestGauge(rivers.data, point, farm?.water?.source === 'river' ? farm.water.name : null) : null;
  const flood = gauge ? { ...gauge, level: floodLevel(gauge), max: FLOOD_MAX, trend: trend(gauge), gaugeLevel: gauge.level } : null;
  const issues = canals.data ? farmSchedule(canals.data, farm, own?.name) : [];
  const issue = currentIssue(issues, today);

  const latest = readings.data?.latest;
  const rainDays = rain.data;
  // No moisture sensors: a field "needs water" when its tank is low and little rain is coming.
  const needsWater = latest && rainDays
    ? latest.percent < LOW_PCT && rainDays.reduce((s, d) => s + d.mm, 0) < 10
    : null;

  return {
    tanks, tank, own, readings, rivers, canals, rain, today, point,
    flood, issues, issue, issueStatus: issue ? issueStatus(issue, today) : null, needsWater,
  };
}
