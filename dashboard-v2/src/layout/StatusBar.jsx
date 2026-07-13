import { useEffect, useState } from 'react';
import { api } from '../services/api';

function statusTone(value) {
  if (['online', 'running', 'active', 'ready'].includes(value)) return 'online';
  if (['error', 'offline', 'blocked'].includes(value)) return 'error';
  if (['paused', 'warning'].includes(value)) return 'warning';
  return 'idle';
}

function StatusItem({ label, value }) {
  return (
    <span className="status-bar-item">
      <i className={statusTone(value)} />
      {label}: <strong>{value}</strong>
    </span>
  );
}

export default function StatusBar() {
  const [health, setHealth] = useState(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const data = await api.getHealth();
        if (!ignore) {
          setHealth(data);
          setOffline(false);
        }
      } catch {
        if (!ignore) setOffline(true);
      }
    }

    load();
    const interval = setInterval(load, 5000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <footer className={`status-bar ${offline ? 'offline' : ''}`} aria-live="polite">
      <StatusItem label="API" value={offline ? 'offline' : health?.api || 'connecting'} />
      <StatusItem label="Robot" value={health?.robotStatus || 'idle'} />
      <StatusItem label="Queue" value={String(health?.queueActive ?? 0)} />
      <StatusItem label="Preflight" value={health?.preflightOk ? 'ready' : health ? 'blocked' : 'checking'} />
      <StatusItem label="Facebook" value={health?.facebookStatus || 'standby'} />
      <span className="status-bar-updated">
        {health?.updatedAt
          ? `Actualizat ${new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(health.updatedAt))}`
          : 'Se verifica starea sistemului'}
      </span>
    </footer>
  );
}
