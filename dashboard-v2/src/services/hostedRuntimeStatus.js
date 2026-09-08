export function localAgentStatusView(agent) {
  if (!agent?.configured) return { value: 'requires agent', message: 'Requires Local Agent' };
  if (!agent.online) return { value: 'offline', message: 'Local Agent offline' };
  return { value: 'online', message: 'Local Agent online' };
}

export async function loadRuntimeStatus({ cloudReadOnly, getHealth, getAgentStatus }) {
  if (cloudReadOnly) return { cloudAvailable: true, agent: await getAgentStatus() };
  return { cloudAvailable: false, health: await getHealth() };
}

export async function loadDashboardSummary({ cloudReadOnly, getDashboardSummary }) {
  if (cloudReadOnly) return { summary: null, error: '' };
  try {
    return { summary: await getDashboardSummary(), error: '' };
  } catch {
    return { summary: null, error: 'Dashboard-ul nu poate comunica momentan cu API-ul.' };
  }
}
