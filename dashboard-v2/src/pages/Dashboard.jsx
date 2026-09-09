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
import { loadDashboardSummary } from '../services/hostedRuntimeStatus';

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
  const [preflightSources, setPreflightSources] = useState({ campaigns: [], targets: [] });
  const [preflightSelection, setPreflightSelection] = useState({ kind: 'property', campaignId: '', day: '', targetId: '' });
  const [campaignPreflightTask, setCampaignPreflightTask] = useState(null);
  const [campaignPreflightError, setCampaignPreflightError] = useState('');
  const [campaignPreflightBusy, setCampaignPreflightBusy] = useState(false);
  const cloudReadOnly = api.isCloudReadOnly();
  const remoteTaskEnabled = api.isCloudRemoteTasksEnabled();
  const refreshDelay = data.robot?.robotStatus === 'running' ? 5000 : 20000;

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setRefreshing(true);
    try {
      const result = await loadDashboardSummary({ cloudReadOnly, getDashboardSummary: api.getDashboardSummary });
      if (result.summary) setData({ ...initialData, ...result.summary });
      setError(result.error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cloudReadOnly]);

  useEffect(() => {
    let ignore = false;

    loadDashboardSummary({ cloudReadOnly, getDashboardSummary: api.getDashboardSummary })
      .then((result) => {
        if (!ignore) {
          if (result.summary) setData({ ...initialData, ...result.summary });
          setError(result.error);
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    // Queue/preflight construction is intentionally thorough. Poll it frequently
    // only while a run is active so idle workspaces stay responsive.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadData({ silent: true });
    }, refreshDelay);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [cloudReadOnly, loadData, refreshDelay]);

  useEffect(() => {
    if (!remoteTaskEnabled) return undefined;
    let active = true;
    Promise.all([api.getProperties(), api.getJobs(), api.getGroups()]).then(([properties, jobs, targets]) => {
      if (!active) return;
      const campaigns = [...properties.map((item) => ({ ...item, kind: 'property' })), ...jobs.map((item) => ({ ...item, kind: 'job' }))].filter((item) => item.active !== false);
      setPreflightSources({ campaigns, targets: targets.filter((item) => item.active !== false) });
      const first = campaigns[0]; const firstTarget = targets.find((item) => item.active !== false);
      if (first) setPreflightSelection({ kind: first.kind, campaignId: first.id, day: String(first.posts?.[0]?.day || ''), targetId: firstTarget?.id || '' });
    }).catch((loadError) => { if (active) setCampaignPreflightError(loadError.message); });
    return () => { active = false; };
  }, [remoteTaskEnabled]);

  const robotStatus = data.robot?.robotStatus || 'idle';
  const robotProgress = Number(data.robot?.totalCampaignProgress || 0);
  const robotTotal = Number(data.robot?.totalCampaignGroups || 0);
  const robotPercent = robotTotal ? Math.min(Math.round((robotProgress / robotTotal) * 100), 100) : 0;
  const preflightErrors = data.preflight?.summary?.errors || 0;

  const selectedCampaign = preflightSources.campaigns.find((item) => item.kind === preflightSelection.kind && item.id === preflightSelection.campaignId);
  async function createCampaignPreflight() {
    setCampaignPreflightBusy(true); setCampaignPreflightError('');
    try { setCampaignPreflightTask((await api.createCampaignPreflightTask({ ...preflightSelection, day: Number(preflightSelection.day) })).task); }
    catch (error) { setCampaignPreflightError(error.message); }
    finally { setCampaignPreflightBusy(false); }
  }
  async function refreshCampaignPreflight() {
    if (!campaignPreflightTask?.taskId) return;
    try { setCampaignPreflightTask((await api.getCampaignPreflightTask(campaignPreflightTask.taskId)).task); setCampaignPreflightError(''); }
    catch (error) { setCampaignPreflightError(error.message); }
  }

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

      {remoteTaskEnabled && (
        <>
        <section className="dashboard-operation-card attention-card ready" aria-label="Cloud campaign preflight">
          <header><span className="operation-icon"><ShieldAlert size={20} /></span><div><p>PREVIEW / DRY_RUN / PREFLIGHT</p><h2>Preflight campanie cloud</h2></div></header>
          <p className="mission-message">Nu se publică nicio postare Facebook. Agentul validează numai snapshot-ul cloud și media verificată.</p>
          <div className="form-grid">
            <label>Tip campanie<select value={preflightSelection.kind} onChange={(event) => { const kind = event.target.value; const campaign = preflightSources.campaigns.find((item) => item.kind === kind); setPreflightSelection((current) => ({ ...current, kind, campaignId: campaign?.id || '', day: String(campaign?.posts?.[0]?.day || '') })); }}><option value="property">Proprietate</option><option value="job">Job</option></select></label>
            <label>Campanie<select value={preflightSelection.campaignId} onChange={(event) => { const campaign = preflightSources.campaigns.find((item) => item.kind === preflightSelection.kind && item.id === event.target.value); setPreflightSelection((current) => ({ ...current, campaignId: event.target.value, day: String(campaign?.posts?.[0]?.day || '') })); }}><option value="">Selectează</option>{preflightSources.campaigns.filter((item) => item.kind === preflightSelection.kind).map((item) => <option key={item.id} value={item.id}>{item.name || item.title || item.id}</option>)}</select></label>
            <label>Zi postare<select value={preflightSelection.day} onChange={(event) => setPreflightSelection((current) => ({ ...current, day: event.target.value }))}><option value="">Selectează</option>{(selectedCampaign?.posts || []).filter((post) => post.active !== false).map((post) => <option key={post.day} value={post.day}>Ziua {post.day}</option>)}</select></label>
            <label>Target<select value={preflightSelection.targetId} onChange={(event) => setPreflightSelection((current) => ({ ...current, targetId: event.target.value }))}><option value="">Selectează</option>{preflightSources.targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
          {campaignPreflightTask && <p className="mission-message"><strong>{campaignPreflightTask.status}</strong> · {campaignPreflightTask.result?.preflightPassed ? 'Preflight finalizat' : campaignPreflightTask.taskId}</p>}
          {campaignPreflightTask?.result && <p className="mission-message">Media: {campaignPreflightTask.result.mediaCount} · verificată: {campaignPreflightTask.result.mediaVerified ? 'da' : 'nu'} · blocaje: {campaignPreflightTask.result.blockers.length}</p>}
          {campaignPreflightError && <p className="mission-message">{campaignPreflightError}</p>}
          <div className="button-row"><button className="secondary-button" disabled={campaignPreflightBusy || Boolean(campaignPreflightTask) || !preflightSelection.campaignId || !preflightSelection.day || !preflightSelection.targetId} onClick={createCampaignPreflight}>Rulează preflight</button>{campaignPreflightTask && <button className="ghost-button" onClick={refreshCampaignPreflight}>Actualizează status</button>}</div>
        </section>
        </>
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
