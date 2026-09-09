const COPY = {
  READY: 'Disponibil pentru preflight după selectare explicită.',
  OFFLINE: 'Dispozitivul este offline.', STALE: 'Heartbeat-ul dispozitivului a expirat.', DEGRADED: 'Dispozitivul este degradat.',
  DEVICE_OFFLINE: 'Dispozitivul este offline.', DEVICE_STALE: 'Heartbeat-ul dispozitivului a expirat.', DEVICE_DEGRADED: 'Dispozitivul este degradat.',
  BUSY: 'Există lucru activ pe toate profilurile eligibile.', NO_READY_PROFILE: 'Nu există un profil READY disponibil.',
  CAPABILITY_UNAVAILABLE: 'Capabilitatea necesară nu este disponibilă.', PROFILE_BUSY: 'Profilul are lucru activ.', PROFILE_NOT_READY: 'Profilul nu este pregătit.',
};

export function readinessMessage(reasonCodes = []) { return reasonCodes.map((code) => COPY[code] || '').filter(Boolean).join(' '); }
export function readinessTone(state) { return state === 'READY' ? 'active' : state === 'BUSY' || state === 'DEGRADED' || state === 'PROFILE_BUSY' ? 'warning' : 'inactive'; }
export function workloadLabel(workload = {}) { return `Taskuri active: ${workload.activeTaskCount || 0} · queued: ${workload.queuedTaskCount || 0} · running: ${workload.runningTaskCount || 0}`; }
