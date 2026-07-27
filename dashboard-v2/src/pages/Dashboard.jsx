import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Building2,
  ListChecks,
  RefreshCw,
  Send,
  ShieldAlert,
  TriangleAlert,
  UsersRound,
} from 'lucide-react';
import { api } from '../services/api';
import { PROPULSE_MOTTO, PROPULSE_NAME } from '../config/brand';

const initialData = {
  activeProperties: 0,
  activeJobs: 0,
  activeGroups: 0,
  postedToday: 0,
  errorsToday: 0,
  successRate7d: 0,
  actions7d: 0,
  robot: null,
  queue: { active: 0, done: 0, retry: 0, excluded: 0 },
  nextTasks: [],
  preflight: null,
  recentActivity: [],
  updatedAt: null,
};

function StatBox({ label, value, Icon, tone = '' }) {
  return (
    <div className={`stat-box-v2 ${tone}`}>
      <span><Icon size={21} strokeWidth={2.35} /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function formatTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ro-RO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function statusLabel(status) {
  const labels = {
    posted: 'Postat',
    prepared: 'Pregatit',
    error: 'Eroare',
    skipped: 'Sarit',
  };
  return labels[status] || status || 'Eveniment';
}

export default function Dashboard({ onChangePage }) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      const summary = await api.getDashboardSummary();
      setData({ ...initialData, ...summary });
      setError('');
    } catch {
      setError('Dashboard-ul nu poate comunica momentan cu API-ul.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    api.getDashboardSummary()
      .then((summary) => {
        if (!ignore) {
          setData({ ...initialData, ...summary });
          setError('');
        }
      })
      .catch(() => {
        if (!ignore) setError('Dashboard-ul nu poate comunica momentan cu API-ul.');
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadData({ silent: true });
    }, 5000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [loadData]);

  const robotStatus = data.robot?.robotStatus || 'idle';
  const robotProgress = Number(data.robot?.totalCampaignProgress || 0);
  const robotTotal = Number(data.robot?.totalCampaignGroups || 0);
  const robotPercent = robotTotal ? Math.min(Math.round((robotProgress / robotTotal) * 100), 100) : 0;
  const preflightErrors = data.preflight?.summary?.errors || 0;

  if (loading) {
    return (
      <div className="dashboard-loading" aria-live="polite">
        <RefreshCw className="spin-icon" size={24} />
        <strong>Incarc centrul operational...</strong>
      </div>
    );
  }

  return (
    <div className="dashboard-v2-grid dashboard-command-center">
      <section className="dashboard-hero">
        <div>
          <span className="hero-eyebrow"><Activity size={14} /> {PROPULSE_MOTTO}</span>
          <h1>{PROPULSE_NAME}</h1>
          <p>Motorul operațional care menține campaniile active și proprietățile vizibile.</p>
          <small className="dashboard-updated">Actualizat la {formatTime(data.updatedAt)}</small>
        </div>

        <div className="dashboard-hero-actions">
          <div className={`robot-pill ${robotStatus}`}>{robotStatus}</div>
          <button className="ghost-button" onClick={() => loadData()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'spin-icon' : ''} size={16} />
            Actualizeaza
          </button>
        </div>
      </section>

      {error && (
        <section className="dashboard-error" role="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
          <button onClick={() => loadData()}>Reincearca</button>
        </section>
      )}

      <section className="stats-v2-grid dashboard-stats-grid">
        <StatBox Icon={Building2} label="Proprietati active" value={data.activeProperties} />
        <StatBox Icon={BriefcaseBusiness} label="Joburi active" value={data.activeJobs} />
        <StatBox Icon={UsersRound} label="Grupuri active" value={data.activeGroups} />
        <StatBox Icon={Send} label="Postari azi" value={data.postedToday} />
        <StatBox Icon={TriangleAlert} label="Erori azi" value={data.errorsToday} tone={data.errorsToday ? 'danger' : ''} />
        <StatBox Icon={Activity} label="Succes 7 zile" value={`${data.successRate7d}%`} tone="success" />
      </section>

      <section className="dashboard-operations-grid">
        <article className={`dashboard-operation-card attention-card ${preflightErrors ? 'has-errors' : 'ready'}`}>
          <header>
            <span className="operation-icon"><ShieldAlert size={20} /></span>
            <div>
              <p>Necesita atentie</p>
              <h2>{preflightErrors ? `${preflightErrors} probleme blocheaza Start` : 'Sistem pregatit pentru rulare'}</h2>
            </div>
          </header>

          <div className="operation-list">
            {(data.preflight?.issues || []).slice(0, 4).map((issue, index) => (
              <div className={issue.level} key={`${issue.code}-${index}`}>
                <span />
                <p>{issue.message}</p>
              </div>
            ))}
            {!data.preflight?.issues?.length && (
              <div className="success"><span /><p>Media, profilurile si queue-ul au trecut verificarile.</p></div>
            )}
          </div>

          <button className="card-link-button" onClick={() => onChangePage('queue')}>
            Review &amp; Launch <ArrowRight size={16} />
          </button>
        </article>

        <article className="dashboard-operation-card mission-card">
          <header>
            <span className="operation-icon"><Bot size={20} /></span>
            <div>
              <p>Misiunea curenta</p>
              <h2>{data.robot?.currentProperty || (robotStatus === 'idle' ? 'Robot in asteptare' : data.robot?.lastMessage || 'Robot activ')}</h2>
            </div>
            <span className={`status-pill ${robotStatus}`}>{robotStatus}</span>
          </header>

          <div className="mission-progress-meta">
            <span>{data.robot?.currentGroup || 'Niciun grup in lucru'}</span>
            <strong>{robotProgress}/{robotTotal} · {robotPercent}%</strong>
          </div>
          <div className="campaign-progress-bar" aria-label={`Progres total ${robotPercent}%`}>
            <div className="campaign-progress-fill" style={{ width: `${robotPercent}%` }} />
          </div>
          <p className="mission-message">{data.robot?.lastMessage || 'Robotul este pregatit pentru urmatoarea rulare.'}</p>

          <button className="card-link-button" onClick={() => onChangePage('robot')}>
            Deschide Propulse Control <ArrowRight size={16} />
          </button>
        </article>

        <article className="dashboard-operation-card queue-card">
          <header>
            <span className="operation-icon"><ListChecks size={20} /></span>
            <div>
              <p>Urmatoarele taskuri</p>
              <h2>{data.queue?.active || 0} active · {data.queue?.done || 0} finalizate</h2>
            </div>
          </header>

          <div className="dashboard-task-list">
            {data.nextTasks.map((task, index) => (
              <div key={task.id}>
                <span>#{index + 1}</span>
                <p><strong>{task.campaignTitle}</strong><small>{task.groupName}</small></p>
                <em>Ziua {task.day}</em>
              </div>
            ))}
            {data.nextTasks.length === 0 && <p className="dashboard-empty">Nu exista taskuri pending.</p>}
          </div>

          <button className="card-link-button" onClick={() => onChangePage('queue')}>
            Vezi Queue Manager <ArrowRight size={16} />
          </button>
        </article>

        <article className="dashboard-operation-card activity-card">
          <header>
            <span className="operation-icon"><Activity size={20} /></span>
            <div>
              <p>Activitate recenta</p>
              <h2>{data.actions7d} actiuni in ultimele 7 zile</h2>
            </div>
          </header>

          <div className="dashboard-activity-list">
            {data.recentActivity.map((entry, index) => (
              <div key={`${entry.date}-${index}`}>
                <span className={entry.status || 'info'} />
                <p><strong>{statusLabel(entry.status)} · {entry.propertyName || entry.propertyId || '-'}</strong><small>{entry.groupName || entry.groupId || '-'}</small></p>
                <time>{formatTime(entry.date)}</time>
              </div>
            ))}
            {data.recentActivity.length === 0 && <p className="dashboard-empty">Nu exista activitate inregistrata.</p>}
          </div>

          <button className="card-link-button" onClick={() => onChangePage('livefeed')}>
            Deschide Live Feed <ArrowRight size={16} />
          </button>
        </article>
      </section>
    </div>
  );
}
