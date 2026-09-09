export const EXECUTION_STATUS = Object.freeze({ ALL: 'ALL', QUEUED: 'QUEUED', ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED', FAILED: 'FAILED', OUTCOME_UNKNOWN: 'OUTCOME_UNKNOWN' });

export function executionStatusView(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'COMPLETED') return { label: 'Finalizat', tone: 'active' };
  if (value === 'FAILED') return { label: 'Eșuat', tone: 'inactive' };
  if (value === 'OUTCOME_UNKNOWN') return { label: 'Rezultat necunoscut', tone: 'warning' };
  if (value === 'CLAIMED' || value === 'RUNNING') return { label: value === 'RUNNING' ? 'În rulare' : 'Preluat', tone: 'warning' };
  return { label: 'În așteptare', tone: 'warning' };
}

export function failureMessage(task) {
  if (task?.outcomeUnknown) return 'Rezultatul execuției nu este cunoscut. Este necesară verificare manuală; nu există reîncercare automată.';
  const copy = {
    DEVICE_OFFLINE: 'Dispozitivul a fost offline.', DEVICE_STALE: 'Heartbeat-ul dispozitivului a expirat.', PROFILE_NOT_READY: 'Profilul nu era pregătit.',
    CONFLICTING_WORK: 'Profilul avea deja lucru activ.', MEDIA_NOT_READY: 'Media nu era pregătită.', MEDIA_SNAPSHOT_INVALID: 'Verificarea media a eșuat.',
    CAMPAIGN_REVISION_STALE: 'Campania s-a modificat înainte de execuție.', POST_REVISION_STALE: 'Postarea s-a modificat înainte de execuție.', EXECUTION_FAILED: 'Preflight-ul nu s-a finalizat.',
  };
  return copy[task?.errorCode] || (Array.isArray(task?.blockers) && task.blockers.length ? task.blockers.join(' · ') : '');
}

export function profilesForDevice(devices, deviceId) {
  return (devices.find((device) => device.deviceId === deviceId)?.profiles || []);
}

export function deviceOptionLabel(device) {
  const id = String(device?.deviceId || '');
  return `${device?.displayName || 'Dispozitiv necunoscut'} · ${id.slice(-8) || 'necunoscut'}`;
}

export function historyCards(tasks, devices) {
  return {
    running: tasks.filter((task) => ['CLAIMED', 'RUNNING'].includes(task.status)).length,
    queued: tasks.filter((task) => task.status === 'QUEUED').length,
    completed: tasks.filter((task) => task.status === 'COMPLETED').length,
    failed: tasks.filter((task) => ['FAILED', 'OUTCOME_UNKNOWN'].includes(task.status)).length,
    onlineDevices: devices.filter((device) => device.online).length,
  };
}
