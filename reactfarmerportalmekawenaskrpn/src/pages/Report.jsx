import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { PrimaryBtn, StatusLabel } from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
import Sheet from '../components/Sheet.jsx';
import { ISSUE_TYPES } from '../data.js';
import { useCanals, withTankDistance } from '../api/canals.js';
import { MAX_PHOTOS, REPORT_STATUS, fetchMyReports, fetchReportPhoto, shrinkPhoto, submitReport } from '../api/reports.js';
import { formatDistance } from '../components/GoogleFarmMap.jsx';

// Only types the camera and gallery give us that the API accepts
const PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

const when = (iso, lang) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : lang, { day: 'numeric', month: 'short' });

// Canals from the water issue schedule, nearest to the farm first, with search and "Not listed"
function CanalSheet({ open, onClose, value, onPick, pin, t }) {
  const canals = useCanals();
  const [q, setQ] = useState('');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const query = q.trim().toLowerCase();
  const list = useMemo(() => {
    const all = withTankDistance(canals.data || [], pin)
      .sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity) || a.name.localeCompare(b.name));
    return query ? all.filter((c) => `${c.name} ${c.scheme}`.toLowerCase().includes(query)).slice(0, 30) : all.slice(0, 8);
  }, [canals.data, pin, query]);

  return (
    <Sheet open={open} onClose={onClose} title={t('where')}>
      <div className="search">
        <Icon name="search" size={20} />
        <input aria-label={t('searchCanal')} placeholder={t('searchCanal')} value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
      </div>
      {canals.loading && !canals.data && <div className="f14 muted">{t('loadingCanals')}</div>}
      {canals.error && !canals.data && (
        <div className="row gap8 f14 muted">
          {t('canalsOffline')}
          <button type="button" className="pill-btn outline sm" onClick={canals.reload}>{t('tryAgain')}</button>
        </div>
      )}
      {query && canals.data && list.length === 0 && <div className="f14 muted">{t('noCanalMatch')}</div>}
      <div className="col gap6">
        {list.map((c) => (
          <button key={c.id} type="button" className={`option-row tank-row ${value?.id === c.id ? 'on' : ''}`}
            onClick={() => { onPick({ id: c.id, name: c.name }); onClose(); }}>
            <span className="grow min0">
              <span className="block fw600 ellipsis">{c.name}</span>
              {c.d != null && <span className="block f13 muted">{formatDistance(Math.round(c.d / 100) * 100)} {t('fromTank')}</span>}
            </span>
            {value?.id === c.id && <Icon name="check" size={18} stroke={2.6} />}
          </button>
        ))}
        <button type="button" className={`option-row ${typing ? 'on' : ''}`} onClick={() => setTyping(true)}>
          <Icon name="pencil" size={18} /><span className="grow">{t('notListed')}</span>
        </button>
        {typing && (
          <div className="row gap8">
            <input className="input grow" autoFocus aria-label={t('typeName')} placeholder={t('typeName')} value={typed}
              maxLength={120} onChange={(e) => setTyped(e.target.value)} />
            <button type="button" className="pill-btn" disabled={!typed.trim()}
              onClick={() => { onPick({ id: null, name: typed.trim() }); onClose(); }}>
              <Icon name="check" size={18} />
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// One sent report, with its photos loaded on demand
function ReportDetail({ report, t, lang }) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const made = [];
    Promise.all(report.photos.map((p) => fetchReportPhoto(report.id, p.id).catch(() => null))).then((list) => {
      made.push(...list.filter(Boolean));
      if (!cancelled) setUrls(list.filter(Boolean));
    });
    return () => { cancelled = true; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [report]);
  return (
    <div className="col gap8">
      <div className="f13 muted">{report.canal_name} - {when(report.created_at, lang)}</div>
      {report.description && <div className="f15 lh">{report.description}</div>}
      {report.admin_note && <div className="note-box accent"><Icon name="inbox" size={18} style={{ flex: 'none' }} />{report.admin_note}</div>}
      {urls.length > 0 && (
        <div className="row gap8 wrap">
          {urls.map((u) => <div key={u} className="photo-prev"><img src={u} alt={t('photo')} /></div>)}
        </div>
      )}
    </div>
  );
}

export default function Report() {
  const { t, lang, farm, showToast } = useApp();
  const [type, setType] = useState(null);
  const [canal, setCanal] = useState(() => (farm?.water?.source === 'canal' && farm.water.name ? { id: null, name: farm.water.name } : null));
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]); // [{ file, url }]
  const [here, setHere] = useState(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [canalOpen, setCanalOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [reports, setReports] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [justSent, setJustSent] = useState(null);
  const fileRef = useRef();
  const canals = useCanals();

  // The farm's canal was saved by name; match it to the list so the report links to it
  useEffect(() => {
    if (canal?.id == null && canal?.name && canals.data) {
      const match = canals.data.find((c) => c.name === canal.name);
      if (match) setCanal({ id: match.id, name: match.name });
    }
  }, [canal, canals.data]);

  const loadReports = useCallback(() => {
    fetchMyReports().then(setReports).catch(() => setReports((r) => r ?? []));
  }, []);
  useEffect(loadReports, [loadReports]);

  // Free the preview URLs when photos are removed or the page closes
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const addPhotos = async (files) => {
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) showToast(t('maxPhotos'));
    const added = [];
    for (const f of files.slice(0, room)) {
      try {
        const file = await shrinkPhoto(f);
        added.push({ file, url: URL.createObjectURL(file) });
      } catch (err) {
        showToast(t(err.message === 'photoNotImage' ? 'photoNotImage' : 'photoNotSupported'));
      }
    }
    setPhotos((list) => [...list, ...added]);
  };

  const removePhoto = (url) => {
    URL.revokeObjectURL(url);
    setPhotos((list) => list.filter((p) => p.url !== url));
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false); },
      () => { setLocating(false); showToast(t('locationDenied')); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const submit = async () => {
    if (!type) { setError(t('pickType')); return; }
    if (!canal) { setError(t('pickCanal')); return; }
    setBusy(true);
    setError('');
    try {
      const sent = await submitReport({
        issueType: type, canal, description: note.trim(), location: here, photos: photos.map((p) => p.file),
      });
      setJustSent(sent);
      setType(null); setNote(''); setHere(null);
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]);
      loadReports();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const label = (k) => t(ISSUE_TYPES.find((x) => x.id === k)?.key || 'other');
  const pin = here || farm?.pin || null;

  return (
    <div className="screen">
      <div className="row gap10">
        <div className="grow" />
        <button type="button" className="chip-dark btn" onClick={() => setListOpen(true)}>{t('myReports')} ({reports?.length ?? '…'})</button>
      </div>

      <h1 className="h1">{t('reportTitle')}</h1>

      {justSent && (
        <div className="card card-dark confirm-card" role="status">
          <span className="ok-circle"><Icon name="check" size={20} stroke={2.8} /></span>
          <div className="grow">
            <div className="f15 fw600">{t('received')} - {justSent.code}</div>
            <div className="f13 dim lh">{t('reportSaved')}</div>
          </div>
          <button type="button" className="icon-btn glass sm" aria-label="Dismiss" onClick={() => setJustSent(null)}><Icon name="close" size={16} /></button>
        </div>
      )}

      <div className="f15 fw600">{t('whatWrong')}</div>
      <div className="issue-grid" role="radiogroup" aria-label={t('whatWrong')}>
        {ISSUE_TYPES.map((it) => (
          <button key={it.id} type="button" role="radio" aria-checked={type === it.id}
            className={`issue-tile ${type === it.id ? 'on' : ''}`} onClick={() => { setType(it.id); setError(''); }}>
            <span className="row between w100">
              <Icon name={it.icon} size={28} stroke={1.9} />
              {type === it.id && <span className="tick"><Icon name="check" size={12} stroke={3.4} color="var(--accent)" /></span>}
            </span>
            {t(it.key)}
          </button>
        ))}
      </div>

      <button type="button" className="card row-card" onClick={() => setCanalOpen(true)}>
        <Icon name="pin" size={22} />
        <div className="grow min0" style={{ textAlign: 'left' }}>
          <div className="f12 muted">{t('where')}</div>
          <div className="f15 fw600 ellipsis">{canal?.name || t('pickCanal')}</div>
        </div>
        <span className="f14 fw600 underline">{t('change')}</span>
      </button>

      <div className="row gap8 f13 muted">
        <Icon name="pin" size={16} />
        <span className="grow">{here ? t('usingMyLocation') : t('usingFarmLocation')}</span>
        {!here && navigator.geolocation && (
          <button type="button" className="pill-btn outline sm" onClick={useMyLocation} disabled={locating}>
            {locating ? '…' : t('useMyLocation')}
          </button>
        )}
      </div>

      <label htmlFor="notes" className="f15 fw600">{t('tellMore')}</label>
      <div className="card tight">
        <textarea id="notes" className="textarea" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Mud and weeds blocking the channel about 50 m after gate 7" />
        {photos.length > 0 && (
          <div className="row gap8 wrap">
            {photos.map((p) => (
              <div key={p.url} className="photo-prev">
                <img src={p.url} alt={t('photo')} />
                <button type="button" className="icon-btn dark sm" aria-label="Remove photo" onClick={() => removePhoto(p.url)}><Icon name="close" size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="row gap8">
          <input ref={fileRef} type="file" accept={PHOTO_TYPES} multiple hidden
            onChange={(e) => { addPhotos([...(e.target.files || [])]); e.target.value = ''; }} />
          <button type="button" className="pill-btn outline" disabled={photos.length >= MAX_PHOTOS} onClick={() => fileRef.current?.click()}>
            <Icon name="camera" size={18} />{t('addPhoto')} ({photos.length}/{MAX_PHOTOS})
          </button>
        </div>
      </div>

      {error && <div className="err-text" role="alert">{error}</div>}
      <PrimaryBtn onClick={submit} disabled={busy} icon="send">{busy ? '…' : t('sendDesk')}</PrimaryBtn>

      <CanalSheet open={canalOpen} onClose={() => setCanalOpen(false)} value={canal} pin={pin} t={t}
        onPick={(c) => { setCanal(c); setError(''); }} />

      <Sheet open={listOpen} onClose={() => { setListOpen(false); setOpenId(null); }} title={t('myReports')}>
        <div className="col gap8">
          {reports?.length === 0 && <div className="f14 muted">{t('noReports')}</div>}
          {reports?.map((r) => (
            <div key={r.id} className="col gap8">
              <button type="button" className="report-row" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>
                <div className="icon-tile soft"><Icon name={ISSUE_TYPES.find((x) => x.id === r.issue_type)?.icon || 'dots'} size={22} /></div>
                <div className="grow min0" style={{ textAlign: 'left' }}>
                  <div className="f15 fw600">{label(r.issue_type)} - {r.code}</div>
                  <div className="f13 muted ellipsis">
                    {r.canal_name} - {when(r.created_at, lang)}{r.photos.length ? ` - ${r.photos.length} 📷` : ''}
                  </div>
                </div>
                <StatusLabel status={REPORT_STATUS[r.status]}>{t(REPORT_STATUS[r.status])}</StatusLabel>
              </button>
              {openId === r.id && <ReportDetail report={r} t={t} lang={lang} />}
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
