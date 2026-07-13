import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

const defaultConfig = {
  campaignDay: 1,
  groupLimit: 1,
  startFromGroup: 1,
  publishEnabled: false,
  selectedPropertyIds: [],
  stopAfterCurrentGroup: false,
  campaignCategory: 'real_estate',
  pauseRequested: false,
  facebookProfileId: 'main',
  facebookProfiles: [
    {
      id: 'main',
      label: 'Profil principal',
      profilePath: 'chrome-profile',
      category: 'real_estate',
      useSavedLoginIdentity: true,
    },
    {
      id: 'jobs',
      label: 'Profil joburi',
      profilePath: 'chrome-profile-jobs',
      category: 'jobs',
      useSavedLoginIdentity: true,
    },
    {
      id: 'cherry_park_corbeanca',
      label: 'Cherry Park Corbeanca',
      profilePath: 'chrome-profile-cherry-park-corbeanca',
      category: 'real_estate',
      useSavedLoginIdentity: true,
    },
  ],
  postingIdentityByCategory: {
    real_estate: 'default',
    jobs: 'jobs_page',
  },
  postingIdentityByProfile: {
    cherry_park_corbeanca: 'cherry_park_corbeanca_page',
  },
  facebookPostingIdentities: [
    { id: 'default', label: 'Identitate implicita', actorName: '' },
    { id: 'jobs_page', label: 'Pagina joburi', actorName: '' },
    { id: 'cherry_park_corbeanca_page', label: 'Cherry Park Corbeanca', actorName: 'Cherry Park Corbeanca' },
  ],
};

function getProfileCategory(profile) {
  const text = [profile?.category, profile?.id, profile?.label, profile?.profilePath]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (text.includes('job') || text.includes('munca') || text.includes('cariere')) return 'jobs';
  return 'real_estate';
}

function generateProfileId(label, profiles) {
  const base = String(label || 'profil_nou')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'profil_nou';
  const existingIds = new Set((profiles || []).map((profile) => profile.id));
  let candidate = base;
  let counter = 2;

  while (existingIds.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }

  return candidate;
}

export default function Settings() {
  const fileInputRef = useRef(null);
  const backupInputRef = useRef(null);
  const [config, setConfig] = useState(defaultConfig);
  const [message, setMessage] = useState('');
  const [setupProfileId, setSetupProfileId] = useState(null);
  const [audit, setAudit] = useState([]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(window.localStorage.getItem('rx-desktop-notifications') === 'true');

  useEffect(() => {
    let ignore = false;

    api.getRuntimeConfig().then((configData) => {
      if (ignore) return;
      setConfig({ ...defaultConfig, ...configData });
    });
    api.getAudit({ limit: 40 }).then((entries) => { if (!ignore) setAudit(entries); });

    return () => {
      ignore = true;
    };
  }, []);

  function updateProfile(index, field, value) {
    setConfig((prev) => {
      const facebookProfiles = [...(prev.facebookProfiles || [])];
      facebookProfiles[index] = { ...facebookProfiles[index], [field]: value };
      return { ...prev, facebookProfiles };
    });
  }

  function updatePostingIdentity(index, field, value) {
    setConfig((prev) => {
      const facebookPostingIdentities = [...(prev.facebookPostingIdentities || [])];
      facebookPostingIdentities[index] = {
        ...facebookPostingIdentities[index],
        [field]: value,
      };
      return { ...prev, facebookPostingIdentities };
    });
  }

  function addFacebookProfile() {
    setConfig((prev) => {
      const label = `Profil nou ${(prev.facebookProfiles || []).length + 1}`;
      const id = generateProfileId(label, prev.facebookProfiles || []);

      return {
        ...prev,
        facebookProfiles: [
          ...(prev.facebookProfiles || []),
          {
            id,
            label,
            profilePath: `chrome-profile-${id}`,
            category: 'real_estate',
            useSavedLoginIdentity: true,
          },
        ],
      };
    });
  }

  async function startProfileSetup(profile) {
    setSetupProfileId(profile.id);
    const result = await api.setupFacebookProfile(profile.id);
    setMessage(result.message || `Setup pornit pentru ${profile.label || profile.id}.`);
  }

  async function finishProfileSetup(profile) {
    const result = await api.finishFacebookProfileSetup(profile.id);
    const savedConfig = await api.getRuntimeConfig();

    setConfig({ ...defaultConfig, ...savedConfig });
    setSetupProfileId(null);
    setMessage(result.message || `Profil salvat: ${profile.label || profile.id}.`);
  }

  async function saveConfig() {
    const saved = await api.saveRuntimeConfig(config);
    setConfig({ ...defaultConfig, ...saved });
    setMessage('Setarile au fost salvate.');
  }

  function exportConfig() {
    window.open(api.exportRuntimeConfigUrl, '_blank');
  }

  function importConfig() {
    fileInputRef.current.click();
  }

  async function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const imported = JSON.parse(await file.text());
      const saved = await api.importRuntimeConfig(imported);
      setConfig({ ...defaultConfig, ...saved });
      setMessage('Config importat cu succes.');
    } catch (error) {
      setMessage('Config invalid sau eroare la import.');
      console.error(error);
    } finally {
      event.target.value = '';
    }
  }

  async function clearPostingHistory() {
    const ok = window.confirm(
      'Stergi TOT history-ul de postari?\n\nSe vor reseta postari, erori, pregatite si rapoartele bazate pe history. Actiunea nu poate fi anulata.'
    );

    if (!ok) return;

    await api.clearAllHistory();
    setMessage('Tot history-ul de postari a fost sters.');
  }

  async function toggleDesktopNotifications() {
    if (!notificationsEnabled) {
      if (!window.Notification) { setMessage('Notificarile desktop nu sunt disponibile in acest browser.'); return; }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setMessage('Permisiunea pentru notificari nu a fost acordata.'); return; }
    }
    const next = !notificationsEnabled;
    window.localStorage.setItem('rx-desktop-notifications', String(next));
    setNotificationsEnabled(next);
    setMessage(next ? 'Notificarile desktop au fost activate.' : 'Notificarile desktop au fost dezactivate.');
  }

  async function handleBackupImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const ok = window.confirm('Restaurarea va inlocui configuratia, proprietatile, joburile, grupurile si istoricul curent. Continui?');
      if (!ok) return;
      await api.importBackup(backup);
      setConfig({ ...defaultConfig, ...(await api.getRuntimeConfig()) });
      setMessage('Backup complet restaurat cu succes.');
    } catch (error) {
      setMessage(error.message || 'Backup invalid sau incompatibil.');
    } finally {
      event.target.value = '';
    }
  }

  const facebookProfiles = config.facebookProfiles || [];
  const postingIdentities = config.facebookPostingIdentities || [];

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Settings</h1>
          <p>Configurari pentru runtime, selectie campanii, import si export.</p>
        </div>

        <div className="button-row">
          <button className="secondary-button" onClick={() => window.open(api.exportBackupUrl, '_blank')}>
            Backup complet
          </button>
          <button className="secondary-button" onClick={() => backupInputRef.current.click()}>
            Restaureaza backup
          </button>
          <button className="secondary-button" onClick={exportConfig}>
            Export
          </button>
          <button className="secondary-button" onClick={importConfig}>
            Import
          </button>
          <button className="primary-button" onClick={saveConfig}>
            Salveaza
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden-input"
        onChange={handleImportFile}
      />
      <input ref={backupInputRef} type="file" accept=".json,application/json" className="hidden-input" onChange={handleBackupImport} />

      <section className="editor-panel">
        <div className="panel-title-row">
          <h2>Facebook profiles</h2>
          <span className="muted-text">Administreaza profilurile si identitatile disponibile in Queue.</span>
        </div>

        <div className="settings-subgrid">
          <div>
            <div className="settings-section-title">
              <h3>Profiluri browser</h3>
              <button className="secondary-button small-button" onClick={addFacebookProfile}>
                + Profil
              </button>
            </div>
            <div className="settings-campaign-list">
              {facebookProfiles.map((profile, index) => (
                <div className="settings-edit-row" key={profile.id}>
                  <input
                    value={profile.label}
                    onChange={(event) => updateProfile(index, 'label', event.target.value)}
                    placeholder="Nume profil"
                  />
                  <input
                    value={profile.profilePath}
                    onChange={(event) => updateProfile(index, 'profilePath', event.target.value)}
                    placeholder="chrome-profile"
                  />
                  <select
                    value={profile.category || getProfileCategory(profile)}
                    onChange={(event) => updateProfile(index, 'category', event.target.value)}
                  >
                    <option value="real_estate">Imobiliare</option>
                    <option value="jobs">Joburi</option>
                  </select>
                  <button
                    className="secondary-button small-button"
                    onClick={() => startProfileSetup(profile)}
                  >
                    Set profile
                  </button>
                  <button
                    className="primary-button small-button"
                    disabled={setupProfileId !== profile.id}
                    onClick={() => finishProfileSetup(profile)}
                  >
                    Am terminat
                  </button>
                  <span className="muted-text">
                    {profile.lastSetupAt
                      ? `Setat: ${new Date(profile.lastSetupAt).toLocaleString()}`
                      : 'Nesetat'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3>Identitati / pagini de postare</h3>
            <div className="settings-campaign-list">
              {postingIdentities.map((identity, index) => (
                <div className="settings-edit-row" key={identity.id}>
                  <input
                    value={identity.label}
                    onChange={(event) => updatePostingIdentity(index, 'label', event.target.value)}
                    placeholder="Nume intern"
                  />
                  <input
                    value={identity.actorName}
                    onChange={(event) =>
                      updatePostingIdentity(index, 'actorName', event.target.value)
                    }
                    placeholder="Numele exact al paginii Facebook"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {message && <p className="save-message">{message}</p>}
      </section>

      <section className="editor-panel danger-zone-panel">
        <div className="panel-title-row">
          <div>
            <h2>Mentenanta history</h2>
            <p className="muted-text">
              Reseteaza toate statusurile de postari, erori si rapoarte calculate din history.
            </p>
          </div>

          <button className="danger-button" onClick={clearPostingHistory}>
            Sterge tot history-ul
          </button>
        </div>
      </section>

      <section className="editor-panel"><div className="panel-title-row"><div><h2>Notificari desktop</h2><p className="muted-text">Alerte pentru finalizarea robotului, erori si blocaje preflight.</p></div><button className={notificationsEnabled ? 'danger-button' : 'primary-button'} onClick={toggleDesktopNotifications}>{notificationsEnabled ? 'Dezactiveaza' : 'Activeaza notificari'}</button></div></section>

      <section className="editor-panel">
        <div className="panel-title-row"><div><h2>Jurnal de audit</h2><p className="muted-text">Ultimele operatii care au modificat datele sau starea aplicatiei.</p></div><button className="secondary-button small-button" onClick={async () => setAudit(await api.getAudit({ limit: 40 }))}>Refresh</button></div>
        <div className="audit-list">{audit.map((entry, index) => <div key={`${entry.date}-${index}`}><span className={entry.ok ? 'success' : 'error'} /><strong>{entry.action}</strong><small>{entry.statusCode} · {entry.durationMs} ms</small><time>{new Date(entry.date).toLocaleString('ro-RO')}</time></div>)}</div>
      </section>

      <section className="editor-panel">
        <div className="panel-title-row"><div><h2>Exporturi operationale</h2><p className="muted-text">Fisiere CSV compatibile cu Excel, generate din datele curente.</p></div></div>
        <div className="button-row"><button className="secondary-button" onClick={() => api.downloadExport('history')}>Istoric CSV</button><button className="secondary-button" onClick={() => api.downloadExport('properties')}>Proprietati CSV</button><button className="secondary-button" onClick={() => api.downloadExport('jobs')}>Joburi CSV</button><button className="secondary-button" onClick={() => api.downloadExport('audit')}>Audit CSV</button></div>
      </section>

    </div>
  );
}
