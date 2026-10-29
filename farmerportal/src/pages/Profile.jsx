import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatPhone, useApp } from '../state/AppContext.jsx';
import { Card, LangSwitch, Logo } from '../components/UI.jsx';
import Icon from '../components/Icon.jsx';
import { updateProfile } from '../api/auth.js';

export default function Profile() {
  const { t, user, farm, update, logout, showToast } = useApp();
  const navigate = useNavigate();
  const [savingSms, setSavingSms] = useState(false);
  const smsEnabled = farm?.smsEnabled !== false;

  // Saved on the server: group SMS from the irrigation office skip farmers who turned this off
  const setSms = async (on) => {
    setSavingSms(true);
    try {
      await updateProfile({ sms_enabled: on });
      update((s) => ({ farm: { ...s.farm, smsEnabled: on } }));
      showToast(t(on ? 'smsOn' : 'smsOff'));
    } catch (err) {
      showToast(err.status === 0 ? t('smsSaveFailed') : err.message, 'error');
    } finally {
      setSavingSms(false);
    }
  };
  const initials = (farm?.name || 'F').split(' ').map((w) => w[0]).slice(0, 2).join('');

  return (
    <div className="screen">
      <h1 className="h1 xl">{t('profile')}</h1>

      <Card className="row-card static">
        <div className="avatar lg">{initials}</div>
        <div className="grow min0">
          <div className="f18 fw600 ellipsis">{farm?.name || 'Farmer'}</div>
          <div className="f14 muted">{formatPhone(user.phone)}</div>
        </div>
        <span className={`status-pill ${farm ? 's-safe' : 's-low'}`}><span className="sp-dot" />{farm ? farm.id : t('notRegistered')}</span>
      </Card>

      {!farm && (
        <Link to="/register/identity" className="pill-btn accent big">{t('registerFarm')} <Icon name="arrow" size={18} stroke={2.4} /></Link>
      )}

      <div className="f13 muted fw600 caps">{t('language')}</div>
      <LangSwitch />

      <div className="f13 muted fw600 caps">{t('notifications')}</div>
      <Card className="list-card">
        <label className="list-row">
          <Icon name="sms" size={20} />
          <span className="grow"><span className="block f15 fw600">{t('smsAlerts')}</span><span className="block f13 muted">{t('worksNoData')}</span></span>
          <input type="checkbox" className="switch" checked={smsEnabled} disabled={!farm || savingSms}
            onChange={(e) => setSms(e.target.checked)} />
        </label>
        <Link to="/alerts" className="list-row"><Icon name="bell" size={20} /><span className="grow f15 fw600">{t('alerts')}</span><Icon name="chevron" size={18} /></Link>
        <Link to="/fields" className="list-row"><Icon name="map" size={20} /><span className="grow f15 fw600">{t('myFields')}</span><Icon name="chevron" size={18} /></Link>
        {/* Help & officer contacts: add a row here once the real contacts for the area are known */}
      </Card>

      <button type="button" className="pill-btn outline big danger" onClick={() => { logout(); navigate('/login', { replace: true }); }}>
        {t('logout')} <Icon name="logout" size={18} />
      </button>

      <div className="center f12 muted lh">
        <Logo size={40} /><br />
        {t('appName')} - {t('version')} 1.0.0
      </div>
    </div>
  );
}
