import { useState } from 'react';

// Legend and load status for the irrigation layers (irrigationLayers.js).
// collapsible: starts as a small button so it doesn't cover the map the farmer taps on;
// the status line (loading, unavailable, zoom in) still shows while it is closed.
// selectedLabel: what the magenta highlight means on this map (default "Your tank").
export default function IrrigationLegend({ t, status, collapsible = false, selectedLabel }) {
  const [open, setOpen] = useState(!collapsible);
  const message = status.error
    ? t('mapLayersFallback')
    : status.loading
      ? t('mapLayersLoading')
      : status.zoomedOut ? t('mapLayersZoomIn') : '';

  return (
    <div className={`irrigation-map-legend${collapsible ? ' collapsible' : ''}${open ? '' : ' closed'}`} aria-label={t('mapLegend')}>
      {collapsible && (
        <button type="button" className="legend-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {t('mapLegend')} {open ? '▾' : '▸'}
        </button>
      )}
      {open && (
        <>
          <div><i className="legend-reservoir" />{t('mapReservoir')}</div>
          <div><i className="legend-medium-reservoir" />{t('mapMediumReservoir')}</div>
          <div><i className="legend-highlight" />{selectedLabel || t('mapSelectedTank')}</div>
          <div><i className="legend-bund" />{t('mapBund')}</div>
          <div><i className="legend-canal" />{t('mapCanal')}</div>
          <div><i className="legend-area" />{t('mapIrrigableArea')}</div>
        </>
      )}
      <div className="irrigation-map-status" aria-live="polite">{message}</div>
    </div>
  );
}
