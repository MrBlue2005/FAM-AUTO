import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Clock,
  ExternalLink,
  Layers,
  Pause,
  Play,
  Radio,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import AnimatedBrand from '../components/AnimatedBrand';
import { api } from '../services/api';

function formatEta(seconds) {
  if (!seconds && seconds !== 0) return '-';

  const total = Math.max(Number(seconds), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatDate(value) {
  if (!value) return '-';

  return new Intl.DateTimeFormat('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function getPercent(current, total) {
  if (!total) return 0;
  return Math.min(Math.round((Number(current || 0) / Number(total)) * 100), 100);
}

function statusLabel(status, pauseRequested) {
  if (pauseRequested && status === 'running') return 'pauza ceruta';
  if (status === 'running') return 'ruleaza';
  if (status === 'paused') return 'in pauza';
  if (status === 'error') return 'eroare';
  if (status === 'stopped') return 'oprit';
  return status || 'idle';
}

function historyType(status) {
  if (status === 'posted') return 'success';
  if (status === 'error') return 'error';
  if (status === 'skipped') return 'warning';
  return 'info';
}

function OverlayMetric({ Icon, label, value, detail }) {
  return (
    <article className="overlay-metric">
      <span>
        <Icon size={16} strokeWidth={2.4} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        {detail && <em>{detail}</em>}
      </div>
    </article>
  );
}

function ProgressPanel({ title, current, total, percent, eta, children }) {
  return (
    <section className="overlay-card overlay-progress-card">
      <div className="overlay-section-title">
        <span>{title}</span>
        <strong>{percent}%</strong>
      </div>

      <div className="overlay-progress-line">
        <div style={{ width: `${percent}%` }} />
      </div>

      <div className="overlay-progress-meta">
        <span>{current}/{total} grupuri</span>
        <span>ETA {eta}</span>
      </div>

      {children}
    </section>
  );
}

export default function DesktopOverlay() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const pollingFast = ['running', 'paused'].includes(data?.robot?.robotStatus);

  const loadStatus = useCallback(async () => {
    try {
      const nextData = await api.getOverlayStatus();
      setData(nextData);
      setError('');
    } catch {
      setError('Nu pot citi statusul API-ului.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'R.X. AI Overlay';
    let ignore = false;

    api.getOverlayStatus()
      .then((nextData) => {
        if (ignore) return;
        setData(nextData);
        setError('');
      })
      .catch(() => {
        if (!ignore) setError('Nu pot citi statusul API-ului.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;

      api.getOverlayStatus()
        .then((nextData) => {
          if (ignore) return;
          setData(nextData);
          setError('');
        })
        .catch(() => {
          if (!ignore) setError('Nu pot citi statusul API-ului.');
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, pollingFast ? 2000 : 8000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [pollingFast]);

  async function runAction(label, action) {
    try {
      setActionMessage(label);
      const result = await action();
      setData((current) => ({
        ...(current || {}),
        robot: result,
      }));
      await loadStatus();
    } catch {
      setActionMessage('Actiunea nu a putut fi trimisa catre API.');
    }
  }

  function openDashboard() {
    window.open(window.location.origin, '_blank');
  }

  const robot = data?.robot || {};
  const queue = data?.queue || {};
  const runtime = data?.runtime || {};
  const status = robot.robotStatus || 'idle';
  const currentProgress = Number(robot.progress || 0);
  const currentTotal = Number(robot.totalGroups || 0);
  const totalProgress = Number(robot.totalCampaignProgress || 0);
  const totalGroups = Number(robot.totalCampaignGroups || queue.activeTasks || 0);
  const currentPercent = getPercent(currentProgress, currentTotal);
  const totalPercent = getPercent(totalProgress, totalGroups);
  const pauseRequested = robot.pauseRequested === true;
  const canPause = ['running', 'error'].includes(status) && !pauseRequested;
  const canResume = status === 'paused' || pauseRequested;

  const feedItems = useMemo(() => {
    const liveItems = (robot.liveFeed || []).map((event, index) => ({
      id: `live-${event.time || index}-${index}`,
      type: event.type || 'info',
      title: event.message || '-',
      subtitle: 'Robot live',
      time: event.time || '-',
    }));

    const historyItems = (data?.history || []).map((entry, index) => ({
      id: `history-${entry.date || index}-${index}`,
      type: historyType(entry.status),
      title: `${entry.status || '-'} / ${entry.propertyName || entry.propertyId || '-'}`,
      subtitle: `${entry.groupName || '-'} / Ziua ${entry.day || '-'}`,
      time: formatDate(entry.date),
    }));

    return [...liveItems, ...historyItems].slice(0, 28);
  }, [data?.history, robot.liveFeed]);

  return (
    <main className="overlay-shell">
      <header className="overlay-header">
        <div className="overlay-brand-title">
          <span className="brand-kicker">Desktop overlay</span>
          <h1>
            <AnimatedBrand className="overlay-brand-wordmark" />
          </h1>
        </div>

        <button className="overlay-icon-button" onClick={openDashboard} title="Deschide dashboard">
          <ExternalLink size={16} strokeWidth={2.4} />
        </button>
      </header>

      <section className={`overlay-status-strip ${status}`}>
        <div>
          <small>Status robot</small>
          <strong>{statusLabel(status, pauseRequested)}</strong>
        </div>
        <span>{robot.lastMessage || (loading ? 'Se incarca...' : 'Robot pregatit.')}</span>
      </section>

      {error && <div className="overlay-error">{error}</div>}
      {actionMessage && <div className="overlay-action-message">{actionMessage}</div>}

      <section className="overlay-metric-grid">
        <OverlayMetric
          Icon={UsersRound}
          label="Grupuri campanie"
          value={`${currentProgress}/${currentTotal}`}
          detail={robot.currentGroup || 'niciun grup activ'}
        />
        <OverlayMetric
          Icon={Layers}
          label="Total campanii"
          value={`${totalProgress}/${totalGroups}`}
        />
        <OverlayMetric
          Icon={Clock}
          label="ETA campanie"
          value={formatEta(robot.etaCurrentProperty)}
          detail={robot.currentProperty || 'nicio campanie'}
        />
        <OverlayMetric
          Icon={Activity}
          label="ETA total"
          value={formatEta(robot.etaTotal)}
          detail={robot.averageSecondsPerGroup ? `${robot.averageSecondsPerGroup}s / grup` : 'calculez live'}
        />
      </section>

      <section className="overlay-progress-grid">
        <ProgressPanel
          title="Campania curenta"
          current={currentProgress}
          total={currentTotal}
          percent={currentPercent}
          eta={formatEta(robot.etaCurrentProperty)}
        >
          <div className="overlay-current-task">
            <span>Campanie</span>
            <strong>{robot.currentProperty || 'In asteptare'}</strong>
            <span>Profil: {runtime.facebookProfileLabel || '-'}</span>
          </div>
        </ProgressPanel>

        <ProgressPanel
          title="Total campanii"
          current={totalProgress}
          total={totalGroups}
          percent={totalPercent}
          eta={formatEta(robot.etaTotal)}
        />
      </section>

      <section className="overlay-controls">
        <button
          className="overlay-control pause"
          disabled={!canPause}
          onClick={() => runAction('Pauza ceruta. Robotul se va opri la primul punct sigur.', api.pauseRobot)}
        >
          <Pause size={16} strokeWidth={2.5} />
          Pauza
        </button>
        <button
          className="overlay-control resume"
          disabled={!canResume}
          onClick={() => runAction('Robot reluat.', api.resumeRobot)}
        >
          <Play size={16} strokeWidth={2.5} />
          Resume
        </button>
        <button className="overlay-control refresh" onClick={loadStatus}>
          <RefreshCw size={16} strokeWidth={2.5} />
          Refresh
        </button>
      </section>

      <section className="overlay-card overlay-feed">
        <div className="overlay-section-title">
          <span>
            <Radio size={15} strokeWidth={2.4} />
            Live feed
          </span>
          <strong>{feedItems.length}</strong>
        </div>

        <div className="overlay-feed-list">
          {feedItems.map((item) => (
            <article className={`overlay-feed-item ${item.type}`} key={item.id}>
              <i />
              <div>
                <strong>{item.title}</strong>
                <span>{item.subtitle}</span>
              </div>
              <time>{item.time}</time>
            </article>
          ))}

          {feedItems.length === 0 && (
            <div className="overlay-empty">Nu exista evenimente live inca.</div>
          )}
        </div>
      </section>
    </main>
  );
}
