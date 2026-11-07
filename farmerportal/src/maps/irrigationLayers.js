import L from 'leaflet';

const LAYER_URL = 'https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services/Scheme_Data_2/FeatureServer';
const LAYERS = [
  { id: 9, name: 'Irrigable area', fields: 'OBJECTID,Scheme,Type,Division,Irrig_Area_SchemeRegister_ha', kind: 'area' },
  { id: 8, name: 'Canal system', fields: 'OBJECTID,Scheme,Canal_Type,Division,Code', kind: 'canal' },
  { id: 10, name: 'Reservoir', fields: 'OBJECTID,Res_Name,Division,Type,Tank_Code', kind: 'reservoir', preserveGeometry: true },
  { id: 7, name: 'Bund', fields: 'OBJECTID_1,Res_Name,Division,Res_Type,Tank_Code,Bund_Length_m,Bund_Top_Width_m', kind: 'bund' },
  { id: 3, name: 'Tank coordinate', fields: 'OBJECTID,Res_Name,Division,Res_Type,Tank_Code', kind: 'tank' },
  { id: 2, name: 'Sluice', fields: 'FID,Res_Name,Division,Location,Tank_Code', kind: 'sluice' },
  { id: 1, name: 'Spill', fields: 'OBJECTID_12,Res_Name,Division,Spill_Type,Location,Tank_Code', kind: 'spill' },
];
const LOW_ZOOM_LAYERS = new Set(['reservoir', 'tank']);
const COLORS = {
  area: '#dff0df',
  canal: '#2996ff',
  reservoir: '#73dfff',
  bund: '#b35933',
  tank: '#fcd1f3',
  sluice: '#ffd166',
  spill: '#ed5353',
  mediumReservoir: '#42d6ac',
  highlight: '#ff00ff',
};

const simplifyName = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\b(wewa|tank|reservoir|samudraya|samudra)\b/g, '')
  .replace(/[^a-z0-9]/g, '');

const nameMatches = (name, selectedNames) => {
  const left = simplifyName(name);
  return Boolean(left && selectedNames.some((selected) => left === simplifyName(selected)));
};

// The GIS often spells a tank differently from the app (Kantalai / Kantale, Hurulu wewa /
// Huruluwewa, ~40 of the 117), so the selected tank is also found by position: the reservoir
// outline that contains the tank's point, else the nearest one within MATCH_RADIUS_M. That
// outline's own Res_Name then selects its bunds, canals, sluices and spills too.
const MATCH_RADIUS_M = 1000;

// metres from point p to segment a-b, all [lng, lat], on a local flat projection
function segmentDistance(p, a, b) {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// polygon rings of a GeoJSON Polygon / MultiPolygon
const ringsOf = (geometry) => (geometry?.type === 'Polygon' ? geometry.coordinates
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates.flat() : []);

// 0 when p is inside the outline, else metres to its edge
function distanceToOutline(p, rings) {
  let inside = false;
  let best = Infinity;
  rings.forEach((ring) => {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
      best = Math.min(best, segmentDistance(p, ring[j], ring[i]));
    }
  });
  return inside ? 0 : best;
}

// GIS names of the reservoir outlines at or next to the selected tanks' points
function namesAtPoints(loaded, points) {
  const reservoirs = loaded.find(({ layer }) => layer.kind === 'reservoir')?.data.features || [];
  const names = [];
  points.forEach(({ lat, lng }) => {
    let best = null;
    reservoirs.forEach((feature) => {
      const d = distanceToOutline([lng, lat], ringsOf(feature.geometry));
      if (d <= MATCH_RADIUS_M && (!best || d < best.d)) best = { d, name: feature.properties?.Res_Name };
    });
    if (best?.name) names.push(best.name);
  });
  return names;
}

function popupContent(properties, kind) {
  const fields = {
    area: [['Scheme', 'Scheme'], ['Type', 'Type'], ['Irrigable area (ha)', 'Irrig_Area_SchemeRegister_ha']],
    canal: [['Scheme', 'Scheme'], ['Canal type', 'Canal_Type'], ['Division', 'Division']],
    reservoir: [['Tank', 'Res_Name'], ['Division', 'Division'], ['Type', 'Type']],
    bund: [['Tank bund', 'Res_Name'], ['Bund length (m)', 'Bund_Length_m'], ['Top width (m)', 'Bund_Top_Width_m']],
    tank: [['Tank', 'Res_Name'], ['Division', 'Division'], ['Type', 'Res_Type']],
    sluice: [['Sluice', 'Location'], ['Tank', 'Res_Name'], ['Division', 'Division']],
    spill: [['Spill', 'Spill_Type'], ['Tank', 'Res_Name'], ['Division', 'Division']],
  }[kind];
  const content = document.createElement('div');
  fields.forEach(([label, key]) => {
    const value = properties[key];
    if (value == null || value === '') return;
    const row = document.createElement('div');
    row.textContent = `${label}: ${value}`;
    content.appendChild(row);
  });
  return content;
}

function featureStyle(kind, selected) {
  if (selected) {
    return {
      color: COLORS.highlight,
      weight: kind === 'bund' ? 5 : 4,
      fillColor: COLORS.highlight,
      fillOpacity: 0.58,
    };
  }
  if (kind === 'area') return { color: '#00a884', weight: 1, fillColor: COLORS.area, fillOpacity: 0.18 };
  if (kind === 'canal') return { color: COLORS.canal, weight: 2, opacity: 0.85 };
  if (kind === 'reservoir') return null;
  if (kind === 'bund') return { color: COLORS.bund, weight: 3, opacity: 0.95 };
  return {};
}

// interactive = false: the shapes ignore taps (no popups), so a tap on an irrigable area or
// reservoir reaches the map below. Leaflet stops the map click when it opens a feature's popup.
function makeLayer(layer, geojson, selectedTankName, interactive) {
  return L.geoJSON(geojson, {
    interactive,
    style: (feature) => {
      const name = feature.properties?.Res_Name || feature.properties?.Scheme;
      const selected = nameMatches(name, selectedTankName);
      if (layer.kind === 'reservoir' && !selected) {
        const medium = feature.properties?.Type?.toLowerCase() === 'medium';
        return {
          color: medium ? '#008d6d' : '#0070ff',
          weight: 2,
          fillColor: medium ? COLORS.mediumReservoir : COLORS.reservoir,
          fillOpacity: medium ? 0.52 : 0.45,
        };
      }
      return featureStyle(layer.kind, selected);
    },
    pointToLayer: (feature, latlng) => {
      const selected = nameMatches(feature.properties?.Res_Name, selectedTankName);
      return L.circleMarker(latlng, {
        interactive,
        radius: selected ? 7 : 5,
        color: selected ? COLORS.highlight : '#15283f',
        weight: selected ? 3 : 1,
        fillColor: selected ? COLORS.highlight : COLORS[layer.kind],
        fillOpacity: 0.95,
      });
    },
    onEachFeature: (feature, featureLayer) => {
      if (interactive) featureLayer.bindPopup(popupContent(feature.properties || {}, layer.kind));
    },
  });
}

// Full-detail reservoir outlines only when zoomed in enough to see the difference: zoomed out to
// the whole island they are a ~5 MB download (and again on every pan), simplified they are tiny.
const FULL_DETAIL_ZOOM = 13;

async function fetchLayer(layer, bounds, tolerance, zoom, signal) {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: bounds.toBBoxString(),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outSR: '4326',
    outFields: layer.fields,
    returnGeometry: 'true',
    resultRecordCount: '1000',
    f: 'geojson',
  });
  if (!layer.preserveGeometry || zoom < FULL_DETAIL_ZOOM) {
    params.set('maxAllowableOffset', String(tolerance));
    params.set('geometryPrecision', '5');
  }
  const response = await fetch(`${LAYER_URL}/${layer.id}/query?${params}`, { signal });
  if (!response.ok) throw new Error(`${layer.name} layer request failed (${response.status})`);
  const geojson = await response.json();
  if (geojson.error || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new Error(geojson.error?.message || `${layer.name} layer returned invalid map data`);
  }
  return geojson;
}

/**
 * Loads the public Sri Lanka Irrigation Department map features for the visible area.
 * The existing basemap and reservoir labels remain in place if any GIS layer is unavailable.
 * selection: { names, points } (or a function returning it) for the tank(s) to highlight;
 *   names are app spellings, points ({ lat, lng }) find the outline when the GIS spells it differently.
 * options.interactive (default true): false on maps where a tap must place a pin.
 * Fires on 'moveend' (fetch for the new area) and 'irrigationselectionchange' (restyle only).
 */
export function addIrrigationLayers(map, selection, onStatus, { interactive = true } = {}) {
  let controller;
  let timer;
  let requestId = 0;
  let visibleLayers = L.layerGroup().addTo(map);
  let loaded = []; // [{ layer, data }] from the last fetch, so a new selection doesn't download again

  const render = () => {
    const { names: given = [], points = [] } = (typeof selection === 'function' ? selection() : selection) || {};
    const names = [...given, ...namesAtPoints(loaded, points)];
    const nextLayers = L.layerGroup();
    loaded.forEach(({ layer, data }) => nextLayers.addLayer(makeLayer(layer, data, names, interactive)));
    map.removeLayer(visibleLayers);
    visibleLayers = nextLayers.addTo(map);
  };

  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      controller?.abort();
      controller = new AbortController();
      const currentController = controller;
      const currentRequest = ++requestId;
      const zoom = map.getZoom();
      const layers = zoom < 11 ? LAYERS.filter((layer) => LOW_ZOOM_LAYERS.has(layer.kind)) : LAYERS;
      const bounds = map.getBounds();
      const tolerance = Math.min(0.0015, Math.max(0.00001, ((bounds.getNorth() - bounds.getSouth()) / map.getSize().y) * 1.5));
      onStatus?.({ loading: true, error: false, zoomedOut: zoom < 11 });

      const results = await Promise.allSettled(
        layers.map(async (layer) => ({ layer, data: await fetchLayer(layer, bounds, tolerance, zoom, currentController.signal) })),
      );
      if (currentController.signal.aborted || currentRequest !== requestId) return;

      const failures = [];
      loaded = [];
      results.forEach((result) => {
        if (result.status === 'fulfilled') loaded.push(result.value);
        else if (result.reason?.name !== 'AbortError') failures.push(result.reason);
      });
      if (failures.length) console.error('Unable to load some irrigation map layers:', failures);
      // more features in view than one request returns (resultRecordCount): some are missing, so ask to zoom in
      const cutOff = loaded.some(({ data }) => data.properties?.exceededTransferLimit || data.exceededTransferLimit);
      render();
      onStatus?.({ loading: false, error: failures.length > 0, zoomedOut: zoom < 11 || cutOff });
    }, 140);
  };

  map.on('moveend', update);
  map.on('irrigationselectionchange', render);
  update();

  return {
    refresh: update,
    remove: () => {
      clearTimeout(timer);
      controller?.abort();
      map.off('moveend', update);
      map.off('irrigationselectionchange', render);
      map.removeLayer(visibleLayers);
    },
  };
}
