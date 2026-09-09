import { useEffect, useState } from 'react';
import { MonitorSmartphone, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { DEVICE_PROFILE_READINESS, useHostedDeviceProfileSelection } from '../services/hostedDeviceSelection';
import { validateDeviceDisplayName } from '../services/deviceAdminUi';
import { canRequestRoutedPreflight, requiresExplicitReselection, routedPreflightErrorMessage } from '../services/hostedCampaignPreflight';
import { readinessMessage, readinessTone, workloadLabel } from '../services/deviceReadiness';

function formatLastSeen(value) {
  if (!value) return 'Fără heartbeat';
  return new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function tone(value) {
  if (value === 'ONLINE' || value === 'READY') return 'active';
  if (value === 'BUSY' || value === 'DEGRADED') return 'warning';
  return 'inactive';
}

const readinessCopy = {
  [DEVICE_PROFILE_READINESS.NO_DEVICE]: 'Selectează un dispozitiv pentru a vedea profilurile sale.',
  [DEVICE_PROFILE_READINESS.DEVICE_OFFLINE]: 'Dispozitivul selectat este offline sau are heartbeat expirat.',
  [DEVICE_PROFILE_READINESS.NO_PROFILE]: 'Selectează un profil deținut de dispozitivul ales.',
  [DEVICE_PROFILE_READINESS.PROFILE_NOT_READY]: 'Profilul selectat nu este pregătit pentru un preflight viitor.',
  [DEVICE_PROFILE_READINESS.READY_FOR_PREFLIGHT]: 'Perechea este structural pregătită pentru un preflight viitor; aceasta nu autorizează publicarea sau execuția.',
};

function HostedDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [enrollment, setEnrollment] = useState(null);
  const selection = useHostedDeviceProfileSelection(devices);
  const [preflightSources, setPreflightSources] = useState({ campaigns: [], targets: [] });
  const [preflightIntent, setPreflightIntent] = useState({ kind: 'property', campaignId: '', day: '', targetId: '' });
  const [preflightTask, setPreflightTask] = useState(null);
  const [preflightTarget, setPreflightTarget] = useState(null);
  const [preflightError, setPreflightError] = useState('');
  const [preflightBusy, setPreflightBusy] = useState(false);
  const remoteTasksEnabled = api.isCloudRemoteTasksEnabled();

  async function load() {
    setLoading(true);
    try {
      const result = await api.getDevices();
      setDevices(result.devices || []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Dispozitivele nu au putut fi încărcate.');
    } finally {
      setLoading(false);
    }
  }

  async function rename(deviceId) {
    const { displayName, error: validationError } = validateDeviceDisplayName(renameValue);
    if (validationError) return setAdminMessage(validationError);
    try { await api.renameDevice(deviceId, displayName); setRenamingId(null); setRenameValue(''); setAdminMessage('Dispozitiv redenumit.'); await load(); } catch (renameError) { setAdminMessage(renameError.message || 'Redenumirea nu a reușit.'); }
  }
  async function addDevice() { try { setAdminMessage(''); setEnrollment(await api.createEnrollmentToken()); } catch (issueError) { setAdminMessage(issueError.message || 'Tokenul nu a putut fi creat.'); } }

  useEffect(() => {
    let ignore = false;
    api.getDevices()
      .then((result) => { if (!ignore) { setDevices(result.devices || []); setError(''); } })
      .catch((loadError) => { if (!ignore) setError(loadError.message || 'Dispozitivele nu au putut fi încărcate.'); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (!remoteTasksEnabled) return undefined;
    let ignore = false;
    Promise.all([api.getProperties(), api.getJobs(), api.getGroups()])
      .then(([properties, jobs, targets]) => {
        if (ignore) return;
        setPreflightSources({
          campaigns: [...properties.map((item) => ({ ...item, kind: 'property' })), ...jobs.map((item) => ({ ...item, kind: 'job' }))].filter((item) => item.active !== false),
          targets: targets.filter((item) => item.active !== false),
        });
      })
      .catch((loadError) => { if (!ignore) setPreflightError(loadError.message || 'Datele necesare pentru preflight nu au putut fi încărcate.'); });
    return () => { ignore = true; };
  }, [remoteTasksEnabled]);

  const selectedCampaign = preflightSources.campaigns.find((item) => item.kind === preflightIntent.kind && item.id === preflightIntent.campaignId);
  const selectedPost = (selectedCampaign?.posts || []).find((post) => Number(post.day) === Number(preflightIntent.day));
  const preflightReady = canRequestRoutedPreflight(selection, preflightIntent);

  async function createCampaignPreflight() {
    if (!preflightReady || preflightBusy) return;
    setPreflightBusy(true); setPreflightError('');
    try {
      const task = (await api.createCampaignPreflightTask({
        ...preflightIntent,
        deviceId: selection.selectedDeviceId,
        profileId: selection.selectedProfileId,
        campaignRevision: selectedCampaign?.revision,
        postRevision: selectedPost?.revision,
      })).task;
      setPreflightTask(task);
      setPreflightTarget({
        deviceName: selection.selectedDevice?.displayName || 'Dispozitiv selectat',
        profileName: selection.selectedProfile?.displayName || 'Profil selectat',
        campaignName: selectedCampaign?.name || selectedCampaign?.title || 'Campanie selectată',
        postDay: Number(preflightIntent.day),
        targetName: preflightSources.targets.find((target) => target.id === preflightIntent.targetId)?.name || 'Target selectat',
      });
    } catch (issueError) {
      setPreflightError(routedPreflightErrorMessage(issueError));
      if (requiresExplicitReselection(issueError)) {
        selection.clearSelection();
        await load();
      }
    } finally { setPreflightBusy(false); }
  }
  async function refreshCampaignPreflight() {
    if (!preflightTask?.taskId) return;
    try { setPreflightTask((await api.getCampaignPreflightTask(preflightTask.taskId)).task); setPreflightError(''); }
    catch (issueError) { setPreflightError(routedPreflightErrorMessage(issueError)); }
  }

  return (
    <div className="management-page">
      <header className="management-header">
        <div><span className="hero-eyebrow">HOSTED CONTROL PLANE</span><h1>Dispozitive</h1><p>Administrare sigură pentru Local Agents și profilurile deținute de fiecare dispozitiv.</p></div>
        <div className="button-row"><button className="primary-button" onClick={addDevice}>Adaugă dispozitiv</button><button className="ghost-button" onClick={load} disabled={loading}><RefreshCw className={loading ? 'spin-icon' : ''} size={16} /> Actualizează</button></div>
      </header>

      <section className="editor-panel">
        <p className="muted-text">Selectarea dispozitivului și profilului este doar intenție UI. Preflight-ul este validat din nou de server, fără fallback automat și fără publicare.</p>
      </section>

      {!loading && !error && devices.length > 0 && <section className="editor-panel">
        <div className="panel-title-row"><div><h2>Selecție explicită pentru viitor</h2><p className="muted-text">Selecția este intenție UI read-only, nu autorizare de execuție.</p></div>{selection.selectedDeviceId && <button className="ghost-button" onClick={selection.clearSelection}>Șterge selecția</button>}</div>
        <div className="button-row">{devices.map((device) => <button className={selection.selectedDeviceId === device.deviceId ? 'primary-button' : 'secondary-button'} key={device.deviceId} onClick={() => selection.selectDevice(device.deviceId)}>{device.displayName} · {device.online ? device.reportedStatus : 'OFFLINE'}</button>)}</div>
        {selection.selectedDevice && <div className="schedule-list"><div className="schedule-empty">Profiluri pentru {selection.selectedDevice.displayName}</div>{selection.selectedDevice.profiles.map((profile) => <button className={selection.selectedProfileId === profile.profileId ? 'primary-button' : 'secondary-button'} key={profile.profileId} onClick={() => selection.selectProfile(profile.profileId)}>{profile.displayName} · {profile.status}</button>)}{!selection.selectedDevice.profiles.length && <div className="schedule-empty">Dispozitivul selectat nu are profiluri înregistrate.</div>}</div>}
        <p className="mission-message"><strong>{selection.readiness}</strong> · {readinessCopy[selection.readiness]}</p>
      </section>}

      {remoteTasksEnabled && <section className="editor-panel" aria-label="Preflight campanie rutat">
        <div className="panel-title-row"><div><h2>Preflight campanie</h2><p className="muted-text">Verificare fără publicare pentru dispozitivul și profilul selectate explicit.</p></div></div>
        <div className="form-grid">
          <label>Tip campanie<select value={preflightIntent.kind} onChange={(event) => setPreflightIntent({ kind: event.target.value, campaignId: '', day: '', targetId: preflightIntent.targetId })}><option value="property">Proprietate</option><option value="job">Job</option></select></label>
          <label>Campanie<select value={preflightIntent.campaignId} onChange={(event) => { const campaign = preflightSources.campaigns.find((item) => item.kind === preflightIntent.kind && item.id === event.target.value); setPreflightIntent((current) => ({ ...current, campaignId: event.target.value, day: String(campaign?.posts?.find((post) => post.active !== false)?.day || '') })); }}><option value="">Selectează</option>{preflightSources.campaigns.filter((item) => item.kind === preflightIntent.kind).map((item) => <option key={item.id} value={item.id}>{item.name || item.title || item.id}</option>)}</select></label>
          <label>Zi postare<select value={preflightIntent.day} onChange={(event) => setPreflightIntent((current) => ({ ...current, day: event.target.value }))}><option value="">Selectează</option>{(selectedCampaign?.posts || []).filter((post) => post.active !== false).map((post) => <option key={post.day} value={post.day}>Ziua {post.day}</option>)}</select></label>
          <label>Target<select value={preflightIntent.targetId} onChange={(event) => setPreflightIntent((current) => ({ ...current, targetId: event.target.value }))}><option value="">Selectează</option>{preflightSources.targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <p className="mission-message">Dispozitiv: <strong>{selection.selectedDevice?.displayName || 'nesetat'}</strong> · Profil: <strong>{selection.selectedProfile?.displayName || 'nesetat'}</strong> · Fără publicare</p>
        {preflightTask && <p className="mission-message"><strong>{preflightTask.status}</strong> · {preflightTarget?.deviceName} / {preflightTarget?.profileName} · {preflightTarget?.campaignName}, ziua {preflightTarget?.postDay} · {preflightTarget?.targetName}</p>}
        {preflightTask?.result && <p className="mission-message">Media: {preflightTask.result.mediaCount} · verificată: {preflightTask.result.mediaVerified ? 'da' : 'nu'} · blocaje: {preflightTask.result.blockers.length}</p>}
        {preflightError && <p className="save-message" role="alert">{preflightError}</p>}
        <div className="button-row"><button className="secondary-button" disabled={!preflightReady || preflightBusy || Boolean(preflightTask)} onClick={createCampaignPreflight}>Rulează preflight</button>{preflightTask && <button className="ghost-button" onClick={refreshCampaignPreflight}>Actualizează status</button>}</div>
      </section>}

      {error && <section className="editor-panel"><p className="save-message">{error}</p></section>}
      {adminMessage && <section className="editor-panel"><p className="save-message">{adminMessage}</p></section>}
      {enrollment && <section className="editor-panel"><div className="panel-title-row"><div><h2>Token de înrolare — afișat o singură dată</h2><p className="muted-text">Tokenul este temporar (aprox. 15 minute), destinat numai noului Local Agent. Copiază-l acum: nu poate fi recuperat după închiderea acestui panou sau reîncărcare.</p></div><button className="ghost-button" onClick={() => setEnrollment(null)}>Închide și șterge</button></div><code>{enrollment.enrollmentToken}</code><div className="button-row"><button className="secondary-button" onClick={() => navigator.clipboard?.writeText(enrollment.enrollmentToken)}>Copiază tokenul</button></div><ol><li>Pe noul PC rulează <code>npm.cmd run setup:new-pc</code>.</li><li>Configurează transportul HTTP găzduit conform <code>docs/SETUP_NEW_PC.md</code>.</li><li>Furnizează temporar <code>RX_AGENT_ENROLLMENT_TOKEN</code>, apoi rulează <code>npm.cmd run agent:http</code>.</li><li>Confirmă <code>HEARTBEAT_OK</code> și actualizează această pagină.</li></ol></section>}
      {loading && <section className="editor-panel"><p>Se încarcă dispozitivele…</p></section>}
      {!loading && !error && devices.length === 0 && <section className="empty-state-v2"><MonitorSmartphone size={28} /><strong>Niciun Local Agent configurat</strong><span>Dispozitivele înscrise vor apărea aici după heartbeat.</span></section>}
      {!loading && !error && devices.map((device) => (
        <section className="editor-panel" key={device.deviceId}>
          <div className="panel-title-row"><div><h2>{device.displayName}</h2><p className="muted-text">ID: {device.deviceId} · Ultimul heartbeat: {formatLastSeen(device.lastSeenAt)}</p></div><span className={`status-pill ${tone(device.reportedStatus)}`}>{device.online ? device.reportedStatus : 'OFFLINE'}</span></div>
          {renamingId === device.deviceId ? <div className="button-row"><input value={renameValue} maxLength="80" onChange={(event) => setRenameValue(event.target.value)} /><button className="primary-button" onClick={() => rename(device.deviceId)}>Salvează</button><button className="ghost-button" onClick={() => setRenamingId(null)}>Renunță</button></div> : <button className="secondary-button" onClick={() => { setRenamingId(device.deviceId); setRenameValue(device.displayName); }}>Redenumește</button>}
          <p className="muted-text">Execuție locală: {device.capabilities.localExecution ? 'disponibilă' : 'indisponibilă'} · Automatizare Facebook: {device.capabilities.facebookAutomation ? 'disponibilă' : 'nedisponibilă'}</p>
          <p className="muted-text">{workloadLabel(device.workload)} · Profiluri ocupate: {device.workload?.busyProfileCount || 0}</p>
          <p className={`mission-message ${readinessTone(device.readiness?.state)}`}><strong>{device.readiness?.state || 'OFFLINE'}</strong> · {device.readiness?.canAcceptPreflight ? 'Poate accepta preflight după selectare explicită.' : readinessMessage(device.readiness?.reasonCodes)}</p>
          <p className="muted-text">Credentialele dispozitivului sunt administrate local și nu sunt afișate. Revocare și rotație credential: deferred.</p>
          <div className="schedule-list">
            {device.profiles.map((profile) => <article className="schedule-card" key={profile.profileId}><div className="schedule-card-main"><div className="schedule-card-title"><span className={`schedule-state ${readinessTone(profile.readinessState)}`}><MonitorSmartphone size={15} />{profile.busy ? 'BUSY' : profile.status}</span><h3>{profile.displayName}</h3></div><p>Readiness: {profile.readinessState} · {profile.busy ? 'ocupat' : profile.ready ? 'disponibil' : 'indisponibil'} · {readinessMessage(profile.reasonCodes)} · Ultimul heartbeat: {formatLastSeen(profile.lastSeenAt)}</p></div></article>)}
            {!device.profiles.length && <div className="schedule-empty">Nu există profiluri înregistrate pentru acest dispozitiv.</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function Devices({ isAdmin = false }) {
  if (!api.isCloudReadOnly()) return null;
  if (!isAdmin) return <div className="management-page"><section className="editor-panel"><h1>Acces restricționat</h1><p>Dispozitivele sunt disponibile numai administratorilor.</p></section></div>;
  return <HostedDevices />;
}
