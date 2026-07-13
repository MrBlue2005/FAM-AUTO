import { useEffect, useState } from 'react';
import { api } from '../services/api';
import ProfileStartModal from '../components/ProfileStartModal';

function formatEta(seconds) {
  if (!seconds && seconds !== 0) return '-';
  const total = Math.max(Number(seconds), 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getPercent(current, total) {
  if (!total) return 0;
  return Math.min(Math.round((current / total) * 100), 100);
}

function isRunning(status) {
  return status === 'running' || status === 'paused';
}

export default function Robot() {
  const [robot, setRobot] = useState(null);
  const [message, setMessage] = useState('');
  const [startModalOpen, setStartModalOpen] = useState(false);
  const status = robot?.robotStatus || 'idle';
  const running = isRunning(status);
  const paused = status === 'paused';

  useEffect(() => {
    let ignore = false;

    function load() {
      api.getRobotStatus().then((data) => {
        if (!ignore) setRobot(data);
      });
    }

    load();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load();
      }
    }, running ? 1500 : 6000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [running]);

  async function runAction(label, action) {
    const result = await action();
    setRobot(result);
    setMessage(label);
  }

  const propertyPercent = getPercent(robot?.progress || 0, robot?.totalGroups || 0);
  const campaignPercent = getPercent(
    robot?.totalCampaignProgress || 0,
    robot?.totalCampaignGroups || 0
  );

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Robot Center</h1>
          <p>Control complet pentru robot, progres, ETA si feed live.</p>
        </div>

        <span className={`robot-pill ${status}`}>{status}</span>
      </header>

      <section className="robot-control-grid">
        <button
          className={`primary-button ${running ? 'control-locked' : ''}`}
          disabled={running}
          onClick={() => setStartModalOpen(true)}
        >
          Start
        </button>
        <button
          className={`secondary-button ${paused ? 'control-locked' : ''}`}
          disabled={!running || paused}
          onClick={() => runAction('Pauza ceruta.', api.pauseRobot)}
        >
          Pause
        </button>
        <button
          className={`primary-button ${!paused ? 'control-locked' : ''}`}
          disabled={!paused}
          onClick={() => runAction('Robot reluat.', api.resumeRobot)}
        >
          Resume
        </button>
        <button
          className="secondary-button"
          disabled={!running || robot?.stopAfterCurrentGroup}
          onClick={() => runAction('Stop dupa grupul curent.', api.stopRobotAfterCurrent)}
        >
          Stop dupa grup curent
        </button>
        <button
          className={`danger-button ${running ? 'control-active-danger' : ''}`}
          disabled={!running}
          onClick={() => runAction('Robot oprit.', api.stopRobot)}
        >
          Stop
        </button>
      </section>

      {message && <p className="save-message">{message}</p>}

      <ProfileStartModal
        open={startModalOpen}
        onClose={() => setStartModalOpen(false)}
        onConfirm={async (options) => {
          setStartModalOpen(false);
          await runAction('Robot pornit.', () => api.startRobot(options));
        }}
      />

      <section className="robot-panels-v2">
        <article className="editor-panel">
          <h2>Progres proprietate</h2>
          <div className="progress-head">
            <span>{robot?.currentProperty || 'Nicio proprietate in lucru'}</span>
            <strong>{robot?.progress || 0}/{robot?.totalGroups || 0} / {propertyPercent}%</strong>
          </div>
          <div className="property-progress-bar">
            <div className="property-progress-fill" style={{ width: `${propertyPercent}%` }} />
          </div>

          <div className="mission-info-grid">
            <div>
              <span>Grup curent</span>
              <strong>{robot?.currentGroup || '-'}</strong>
            </div>
            <div>
              <span>ETA proprietate</span>
              <strong>{formatEta(robot?.etaCurrentProperty)}</strong>
            </div>
          </div>
        </article>

        <article className="editor-panel">
          <h2>Progres total</h2>
          <div className="progress-head">
            <span>Campania curenta</span>
            <strong>
              {robot?.totalCampaignProgress || 0}/{robot?.totalCampaignGroups || 0} / {campaignPercent}%
            </strong>
          </div>
          <div className="campaign-progress-bar">
            <div className="campaign-progress-fill" style={{ width: `${campaignPercent}%` }} />
          </div>

          <div className="mission-info-grid">
            <div>
              <span>ETA total</span>
              <strong>{formatEta(robot?.etaTotal)}</strong>
            </div>
            <div>
              <span>Media / grup</span>
              <strong>{robot?.averageSecondsPerGroup ? `${robot.averageSecondsPerGroup}s` : '-'}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="editor-panel">
        <h2>Ultimele mesaje</h2>
        <div className="feed-timeline-v2 compact">
          {(robot?.liveFeed || []).map((event, index) => (
            <article className={`feed-event-v2 ${event.type || 'info'}`} key={`${event.time}-${index}`}>
              <div className="feed-dot" />
              <div>
                <strong>{event.message}</strong>
                <span>{robot?.lastMessage || '-'}</span>
              </div>
              <time>{event.time || '-'}</time>
            </article>
          ))}

          {(!robot?.liveFeed || robot.liveFeed.length === 0) && (
            <div className="empty-state-v2">Robotul nu are evenimente live inca.</div>
          )}
        </div>
      </section>
    </div>
  );
}
