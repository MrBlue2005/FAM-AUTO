import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { EXECUTION_STATUS, deviceOptionLabel, executionStatusView, failureMessage, historyCards, profilesForDevice } from '../services/executionHistory';

function date(value) { return value ? new Intl.DateTimeFormat('ro-RO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'; }

function devicesFromTasks(tasks) {
  const devices = new Map();
  for (const task of tasks) {
    if (!task?.deviceId || devices.has(task.deviceId)) continue;
    devices.set(task.deviceId, { deviceId: task.deviceId, displayName: task.deviceDisplayName || 'Dispozitiv necunoscut', profiles: [] });
  }
  for (const task of tasks) {
    const device = devices.get(task?.deviceId);
    if (!device || !task?.profileId || device.profiles.some((profile) => profile.profileId === task.profileId)) continue;
    device.profiles.push({ profileId: task.profileId, displayName: task.profileDisplayName || 'Profil necunoscut' });
  }
  return [...devices.values()];
}

export default function Executions({ isAdmin = false, isManagedUser = false }) {
  const [devices, setDevices] = useState([]); const [tasks, setTasks] = useState([]); const [detail, setDetail] = useState(null);
  const [filters, setFilters] = useState({ deviceId: '', profileId: '', status: 'ALL' }); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const { deviceId, profileId, status } = filters;
  const profiles = useMemo(() => profilesForDevice(devices, filters.deviceId), [devices, filters.deviceId]);
  const cards = historyCards(tasks, devices);
  const load = async () => { setLoading(true); try { const taskResult = await api.getCloudTasks({ ...filters, limit: 25 }); const nextTasks = taskResult.tasks || []; const deviceResult = isAdmin ? await api.getDevices() : { devices: devicesFromTasks(nextTasks) }; setDevices(deviceResult.devices || []); setTasks(nextTasks); setError(''); } catch (loadError) { setError(loadError.message || 'Istoricul nu a putut fi încărcat.'); } finally { setLoading(false); } };
  useEffect(() => {
    let ignore = false;
    api.getCloudTasks({ deviceId, profileId, status, limit: 25 })
      .then(async (taskResult) => { const nextTasks = taskResult.tasks || []; const deviceResult = isAdmin ? await api.getDevices() : { devices: devicesFromTasks(nextTasks) }; if (!ignore) { setDevices(deviceResult.devices || []); setTasks(nextTasks); setError(''); } })
      .catch((loadError) => { if (!ignore) setError(loadError.message || 'Istoricul nu a putut fi încărcat.'); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [deviceId, profileId, status, isAdmin]);
  async function openDetail(taskId) { try { setDetail(await api.getCloudTask(taskId)); } catch (detailError) { setError(detailError.message || 'Detaliul nu a putut fi încărcat.'); } }
  if (!api.isCloudReadOnly()) return null;
  if (!isAdmin && !isManagedUser) return <div className="management-page"><section className="editor-panel"><h1>Acces restricționat</h1><p>Istoricul execuțiilor nu este disponibil pentru această sesiune.</p></section></div>;
  const title = isAdmin ? 'Execuții' : 'Execuțiile mele';
  const description = isAdmin ? 'Istoric cloud sigur, multi-dispozitiv. Jurnalele locale detaliate rămân în Local Studio.' : 'Istoric cloud sigur al taskurilor inițiate de tine. Execuția rămâne dezactivată pentru utilizatorii gestionați.';
  const cardValues = [['În rulare', cards.running], ['În așteptare', cards.queued], ['Finalizate', cards.completed], ['Eșuate / verificare', cards.failed], ...(isAdmin ? [['Dispozitive online', cards.onlineDevices]] : [])];
  return <div className="management-page"><header className="management-header"><div><span className="hero-eyebrow">HOSTED CONTROL PLANE</span><h1>{title}</h1><p>{description}</p></div><button className="ghost-button" onClick={load} disabled={loading}><RefreshCw size={16} /> Actualizează</button></header>
    <section className="form-grid">{cardValues.map(([label, value]) => <article className="editor-panel" key={label}><strong>{value}</strong><p className="muted-text">{label}</p></article>)}</section>
    <section className="editor-panel"><div className="form-grid"><label>Dispozitiv<select value={filters.deviceId} onChange={(event) => setFilters({ deviceId: event.target.value, profileId: '', status: filters.status })}><option value="">Toate dispozitivele</option>{devices.map((device) => <option value={device.deviceId} key={device.deviceId}>{deviceOptionLabel(device)}</option>)}</select></label><label>Profil<select value={filters.profileId} disabled={!filters.deviceId} onChange={(event) => setFilters({ ...filters, profileId: event.target.value })}><option value="">Toate profilurile</option>{profiles.map((profile) => <option value={profile.profileId} key={profile.profileId}>{profile.displayName}</option>)}</select></label><label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>{Object.values(EXECUTION_STATUS).map((status) => <option value={status} key={status}>{status === 'ALL' ? 'Toate stările' : status}</option>)}</select></label></div></section>
    {error && <section className="editor-panel"><p className="save-message">{error}</p></section>}
    <section className="editor-panel"><h2>Taskuri recente</h2>{loading ? <p>Se încarcă…</p> : !tasks.length ? <p className="muted-text">Nu există taskuri pentru filtrele selectate.</p> : <div className="schedule-list">{tasks.map((task) => { const view = executionStatusView(task.status); return <button className="schedule-card" key={task.taskId} onClick={() => openDetail(task.taskId)}><div className="schedule-card-main"><div className="schedule-card-title"><span className={`schedule-state ${view.tone}`}>{view.label}</span><h3>{task.taskType}</h3></div><p>{task.deviceDisplayName} · {task.profileDisplayName} · Creat: {date(task.createdAt)} · Finalizat: {date(task.completedAt)}</p><p>Media: {task.mediaCount} · verificată: {task.mediaVerified ? 'da' : 'nu'}{task.outcomeUnknown ? ' · verificare manuală necesară' : ''}</p></div></button>; })}</div>}</section>
    {detail && <section className="editor-panel" aria-label="Detaliu task"><div className="panel-title-row"><div><h2>Detaliu execuție</h2><p className="muted-text">ID: {detail.task.taskId}</p></div><button className="ghost-button" onClick={() => setDetail(null)}>Închide</button></div><p><strong>{detail.task.deviceDisplayName}</strong> · {detail.task.profileDisplayName} · încercări: {detail.task.attempt}</p><p>Media: {detail.task.mediaCount} · verificată: {detail.task.mediaVerified ? 'da' : 'nu'} · preflight: {detail.task.preflightPassed ? 'reușit' : 'neconfirmat'}</p>{failureMessage(detail.task) && <p className="save-message">{failureMessage(detail.task)}</p>}<ol>{(detail.events || []).map((event, index) => <li key={`${event.type}-${index}`}>{event.type} · {date(event.occurredAt)}</li>)}</ol></section>}
  </div>;
}
