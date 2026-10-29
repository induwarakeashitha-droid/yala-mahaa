// 3-day rain forecast for the farm from Open-Meteo (free, no key, allows browser requests).
import { useApiData } from './reservoirs.js';

const URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 15000;
export const HEAVY_MM = 25;

// WMO weather codes: 51+ is drizzle, rain, showers or thunder; 1-48 cloud or fog.
function icon(code, mm) {
  if (mm >= 1 || code >= 51) return 'rain';
  return code >= 1 ? 'cloud' : 'sun';
}

async function fetchRain(lat, lng) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lng.toFixed(3),
    daily: 'precipitation_sum,precipitation_probability_max,weather_code',
    forecast_days: '3',
    timezone: 'Asia/Colombo',
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${URL}?${q}`, { signal: ctrl.signal });
    const data = await res.json();
    if (!res.ok || !data.daily) throw new Error(data.reason || 'No forecast');
    const d = data.daily;
    return d.time.map((date, i) => {
      const mm = Math.round((d.precipitation_sum[i] ?? 0) * 10) / 10;
      return { date, mm, chance: d.precipitation_probability_max?.[i] ?? null, icon: icon(d.weather_code[i] ?? 0, mm), heavy: mm >= HEAVY_MM };
    });
  } catch {
    throw new Error('Could not load the rain forecast.');
  } finally {
    clearTimeout(timer);
  }
}

export function useRainForecast(point) {
  const key = point?.lat != null ? `rain:${point.lat.toFixed(2)},${point.lng.toFixed(2)}` : null;
  return useApiData(key, () => fetchRain(point.lat, point.lng));
}

// Advice key for the next 3 days: heavy rain, some rain or dry.
export function rainAdvice(days) {
  if (days.some((d) => d.heavy)) return 'adviceRainHeavy';
  return days.reduce((sum, d) => sum + d.mm, 0) >= 10 ? 'adviceRainSome' : 'adviceRainDry';
}
