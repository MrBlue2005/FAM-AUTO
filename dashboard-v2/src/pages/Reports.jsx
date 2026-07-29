import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Download, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '../services/api';

const statusLabels = {
  running: 'In desfasurare',
  completed: 'Finalizata',
  stopped: 'Oprita',
  failed: 'Esuata',
};

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function duration(run) {
  if (!run.startedAt) return '-';
  const end = run.finishedAt ? new Date(run.finishedAt) : new Date();
  const minutes = Math.max(Math.round((end - new Date(run.startedAt)) / 60000), 0);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function statusTone(status) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'stopped') return 'warning';
  return 'info';
}

export default function Reports({ onChangePage }) {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getRuns({ status, search });
      setRuns(data);
      if (selected) {
        const refreshed = data.find((run) => run.id === selected.id);
        if (refreshed) setSelected(await api.getRun(refreshed.id));
      }
    } finally {
      setLoading(false);
    }
  }, [search, selected, status]);

  useEffect(() => {
    let ignore = false;
    const timer = window.setTimeout(() => {
      api.getRuns({ status, search }).then((data) => {
        if (!ignore) setRuns(data);
      }).finally(() => { if (!ignore) setLoading(false); });
    }, 180);
    return () => { ignore = true; window.clearTimeout(timer); };
  }, [status, search]);

  const visibleRuns = useMemo(() => runs.filter((run) => showArchived || !run.archived), [runs, showArchived]);

  async function openRun(runId) {
    setWorking(runId);
    try { setSelected(await api.getRun(runId)); }
    finally { setWorking(''); }
  }

  async function exportRun(runId) {
    setWorking(`export:${runId}`);
    try {
      await api.downloadRunExcel(runId);
      window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message: 'Raportul rularii a fost exportat.', type: 'success' } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message: error.message, type: 'error' } }));
    } finally { setWorking(''); }
  }

  async function retryErrors(runId) {
    if (!window.confirm('Pregatim Queue exclusiv cu erorile acestei rulari? Robotul nu va porni automat.')) return;
    setWorking(`retry:${runId}`);
    try {
      const result = await api.retryRunErrors(runId);
      window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message: result.message, type: 'success' } }));
      onChangePage('queue');
    } catch (error) {
      window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message: error.message, type: 'error' } }));
    } finally { setWorking(''); }
  }

  async function archive(run) {
    setWorking(`archive:${run.id}`);
    try {
      await api.archiveRun(run.id, !run.archived);
      if (selected?.id === run.id) setSelected(null);
      await loadRuns();
    } catch (error) {
      window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message: error.message, type: 'error' } }));
    } finally { setWorking(''); }
  }

  return (
    <div className="management-page reports-page">
      <header className="management-header">
        <div>
          <h1>Rapoarte rulări</h1>
          <p>Istoric separat pentru fiecare pornire a robotului, rezultate și retry controlat.</p>
        </div>
        <button className="secondary-button" type="button" onClick={loadRuns} disabled={loading}>
          <RefreshCw size={16} /> {loading ? 'Se actualizeaza...' : 'Actualizeaza'}
        </button>
      </header>

      <section className="editor-panel reports-filters">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cauta ID, campanie sau profil..." />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">Toate statusurile</option>
          <option value="running">In desfasurare</option>
          <option value="completed">Finalizate</option>
          <option value="stopped">Oprite</option>
          <option value="failed">Esuate</option>
        </select>
        <label className="reports-checkbox">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          Include arhivate
        </label>
      </section>

      <section className="reports-layout">
        <div className="editor-panel reports-list">
          <div className="panel-title-row"><h2>Rulări salvate</h2><span>{visibleRuns.length}</span></div>
          {visibleRuns.map((run) => (
            <button className={`report-run-card ${selected?.id === run.id ? 'selected' : ''}`} type="button" key={run.id} onClick={() => openRun(run.id)}>
              <div>
                <strong>{run.campaignIds?.join(', ') || 'Fara campanie'}</strong>
                <span>{run.id}</span>
              </div>
              <span className={`status-pill ${statusTone(run.status)}`}>{statusLabels[run.status] || run.status}</span>
              <div className="report-run-stats">
                <span>{run.totals?.posted || 0} postate</span>
                <span>{run.totals?.errors || 0} erori</span>
                <span>{formatDate(run.startedAt)}</span>
              </div>
            </button>
          ))}
          {!loading && visibleRuns.length === 0 && <div className="empty-state-v2">Nu exista rulări pentru filtrele selectate. Urmatoarea pornire a robotului va aparea aici.</div>}
        </div>

        <div className="editor-panel report-detail">
          {!selected && <div className="empty-state-v2">Selecteaza o rulare pentru rezultate, export și retry.</div>}
          {selected && (
            <>
              <div className="panel-title-row">
                <div><h2>{selected.id}</h2><p>{formatDate(selected.startedAt)} · {duration(selected)} · {selected.mode === 'live' ? 'LIVE' : 'TEST'}</p></div>
                <span className={`status-pill ${statusTone(selected.status)}`}>{statusLabels[selected.status] || selected.status}</span>
              </div>
              <div className="summary-grid reports-summary">
                <div>Total <strong>{selected.totals?.total || 0}</strong></div>
                <div>Postate <strong>{selected.totals?.posted || 0}</strong></div>
                <div>Pregatite <strong>{selected.totals?.prepared || 0}</strong></div>
                <div>Sarite <strong>{selected.totals?.skipped || 0}</strong></div>
                <div>Erori <strong>{selected.totals?.errors || 0}</strong></div>
              </div>
              <div className="button-row reports-actions">
                <button className="primary-button" type="button" onClick={() => exportRun(selected.id)} disabled={working === `export:${selected.id}`}><Download size={16} /> Export Excel</button>
                <button className="secondary-button" type="button" onClick={() => retryErrors(selected.id)} disabled={!selected.totals?.errors || working === `retry:${selected.id}`}><RotateCcw size={16} /> Retry erori</button>
                <button className="ghost-button" type="button" onClick={() => archive(selected)} disabled={selected.status === 'running' || working === `archive:${selected.id}`}><Archive size={16} /> {selected.archived ? 'Restaureaza' : 'Arhiveaza'}</button>
              </div>
              <div className="report-history">
                <h3>Rezultate individuale</h3>
                {(selected.history || []).map((entry, index) => (
                  <div className="analytics-row" key={`${entry.date}-${index}`}>
                    <div><strong>{entry.propertyName || entry.propertyId}</strong><span>{entry.groupName || entry.groupId}</span></div>
                    <span>Ziua {entry.day || '-'}</span>
                    <span className={`status-pill ${statusTone(entry.status === 'posted' ? 'completed' : entry.status === 'error' ? 'failed' : 'stopped')}`}>{entry.status}</span>
                    <span>{entry.errorMessage || entry.reason || formatDate(entry.date)}</span>
                  </div>
                ))}
                {!selected.history?.length && <div className="empty-state-v2">Rularea nu are inca rezultate salvate.</div>}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
