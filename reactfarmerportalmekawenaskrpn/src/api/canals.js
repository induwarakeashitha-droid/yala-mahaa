// Canals from the Mahaweli water issue schedule (GET /api/data/canals), used when a farmer
// says their field gets water from a canal or channel. A canal's location is its scheme tank's.
import { request } from './auth.js';
import { haversine } from './googleMaps.js';
import { useApiData } from './reservoirs.js';

const num = (v) => (v == null || v === '' ? null : Number(v));

let listPromise = null;
export function fetchCanals() {
  listPromise ??= request('/api/data/canals')
    .then((res) => res.data.map((c) => ({
      id: c.id,
      name: c.name,
      scheme: c.scheme,
      start: c.water_start,
      end: c.water_end,
      lat: num(c.latitude),
      lng: num(c.longitude),
    })))
    .catch((err) => { listPromise = null; throw err; });
  return listPromise;
}

export function useCanals() {
  return useApiData('canals', fetchCanals);
}

// Distance (metres) from the pin to each canal's scheme tank, or null when either is unknown.
export function withTankDistance(canals, pin) {
  return canals.map((c) => ({ ...c, d: pin && c.lat != null ? haversine(pin, c) : null }));
}

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// Tissawewa is skipped like in the API's canal list: one is in Anuradhapura and one in Hambantota.
const sameScheme = (scheme, tank) => {
  const a = norm(scheme); const b = norm(tank);
  if (!a || !b || a === 'tissawewa') return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
};

// The water issue rows for this farm: its own canal, or every section of its tank's scheme.
// Most tanks aren't in the Mahaweli schedule, so this is often empty.
export function farmSchedule(canals, farm, tankName) {
  const w = farm?.water;
  let rows = [];
  if (w?.source === 'canal' && w.name) rows = canals.filter((c) => c.name === w.name);
  const tank = w?.source === 'tank' ? w.name : tankName;
  if (!rows.length && tank) rows = canals.filter((c) => sameScheme(c.scheme, tank));
  return rows.filter((c) => c.start && c.end).sort((a, b) => a.start.localeCompare(b.start));
}

// 'flowing' between water_start and water_end, 'scheduled' before, 'closed' after.
export function issueStatus(c, todayIso) {
  if (todayIso < c.start) return 'scheduled';
  return todayIso <= c.end ? 'flowing' : 'closed';
}

// The issue that is flowing now, else the next one, else the last one.
export function currentIssue(rows, todayIso) {
  return rows.find((c) => issueStatus(c, todayIso) === 'flowing')
    || rows.find((c) => issueStatus(c, todayIso) === 'scheduled')
    || rows[rows.length - 1] || null;
}
