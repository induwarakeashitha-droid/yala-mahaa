// Rivers and their gauge stations from the API (GET /api/data/rivers), used when a farmer
// says their field gets water from a river or stream.
import { request } from './auth.js';
import { haversine } from './googleMaps.js';
import { useApiData } from './reservoirs.js';

const num = (v) => (v == null || v === '' ? null : Number(v));

let listPromise = null;
export function fetchRivers() {
  listPromise ??= request('/api/data/rivers')
    .then((res) => res.data.map((river) => ({
      name: river.name,
      stations: river.stations
        .map((s) => ({
          name: s.name,
          lat: num(s.latitude),
          lng: num(s.longitude),
          level: num(s.water_level),
          prev: num(s.prev_level),
          alert: num(s.alert_level),
          minor: num(s.minor_flood_level),
          major: num(s.major_flood_level),
          at: s.reading_at,
        }))
        .filter((s) => s.lat != null && s.lng != null),
    })))
    .catch((err) => { listPromise = null; throw err; });
  return listPromise;
}

export function useRivers() {
  return useApiData('rivers', fetchRivers);
}

// Each river's gauge station nearest to the pin, and how far it is (metres).
export function withNearestGauge(rivers, pin) {
  return rivers.map((river) => {
    if (!pin) return { ...river, gauge: null, d: null };
    let best = null;
    for (const s of river.stations) {
      const d = haversine(pin, s);
      if (!best || d < best.d) best = { station: s, d };
    }
    return { ...river, gauge: best?.station.name ?? null, d: best?.d ?? null };
  });
}

// Gauges further than this from the farm don't say much about its flood risk.
const NEAR_M = 30000;

// 0 normal, 1 alert, 2 minor flood, 3 major flood: the Irrigation Department's gauge thresholds.
export const FLOOD_MAX = 3;
export function floodLevel(s) {
  if (s.level == null) return null;
  if (s.major != null && s.level >= s.major) return 3;
  if (s.minor != null && s.level >= s.minor) return 2;
  if (s.alert != null && s.level >= s.alert) return 1;
  return 0;
}

// Change since a reading 2-24 h earlier; under 5 cm counts as steady.
export function trend(s) {
  if (s.level == null || s.prev == null) return null;
  const d = s.level - s.prev;
  return d >= 0.05 ? 'rising' : d <= -0.05 ? 'falling' : 'steady';
}

// The gauge nearest the farm (within NEAR_M), preferring the farm's own river if it has one.
export function nearestGauge(rivers, pin, riverName) {
  if (!pin) return null;
  const pick = (list) => {
    let best = null;
    for (const r of list) {
      for (const s of r.stations) {
        const d = haversine(pin, s);
        if (d <= NEAR_M && (!best || d < best.d)) best = { river: r.name, ...s, d };
      }
    }
    return best;
  };
  const own = riverName ? rivers.filter((r) => r.name === riverName) : [];
  return pick(own) || pick(rivers);
}
