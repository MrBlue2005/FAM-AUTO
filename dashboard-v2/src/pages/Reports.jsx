import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Download, ExternalLink, RefreshCw, RotateCcw, TriangleAlert, X } from 'lucide-react';
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

const GROUP_AVAILABILITY_REASONS = new Set([
  'group_paused',
  'group_unavailable',
  'composer_unavailable',
]);

function normalizeIssueText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function standardizeGroupIssue(entry) {
  const source = normalizeIssueText(`${entry.reason || ''} ${entry.errorMessage || ''}`);
  const paused = entry.reason === 'group_paused' || /\b(pauz|paus|suspend)/.test(source);

  return paused
    ? { code: 'group_paused', label: 'Grup pus pe pauză' }
    : { code: 'group_unavailable', label: 'Grup indisponibil' };
}

function isGroupAvailabilityIssue(entry) {
  return entry.status === 'error' || GROUP_AVAILABILITY_REASONS.has(entry.reason);
}

function summarizeErrorGroups(history, groups) {
  const configuredGroups = new Map(groups.map((group) => [String(group.id || ''), group]));
  const grouped = new Map();

  history
    .filter(isGroupAvailabilityIssue)
    .forEach((entry) => {
      const groupId = String(entry.groupId || '').trim();
      const groupName = entry.groupName || groupId || 'Grup necunoscut';
      const key = groupId || groupName.toLocaleLowerCase('ro-RO');
      const configured = configuredGroups.get(groupId);
      const technicalMessage = entry.errorMessage || entry.reason || 'Fara detalii tehnice';
      const standardReason = standardizeGroupIssue(entry);
      const item = grouped.get(key) || {
        groupId,
        groupName,
        groupUrl: configured?.url || '',
        configured: Boolean(configured),
        active: configured?.active !== false,
        count: 0,
        lastDate: null,
        latestReason: '',
        latestReasonCode: '',
        latestTechnicalMessage: '',
        campaigns: new Set(),
        occurrences: [],
      };

      item.count += 1;
      item.campaigns.add(entry.propertyName || entry.propertyId || 'Campanie necunoscuta');
      item.occurrences.push({
        date: entry.date,
        reason: standardReason.label,
        reasonCode: standardReason.code,
        technicalMessage,
        campaign: entry.propertyName || entry.propertyId || 'Campanie necunoscuta',
      });

      if (!item.lastDate || new Date(entry.date || 0) >= new Date(item.lastDate || 0)) {
        item.lastDate = entry.date || item.lastDate;
        item.latestReason = standardReason.label;
        item.latestReasonCode = standardReason.code;
        item.latestTechnicalMessage = technicalMessage;
      }

      grouped.set(key, item);
    });

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      campaigns: Array.from(item.campaigns),
      occurrences: item.occurrences
        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
        .slice(0, 5),
    }))
    .sort((a, b) => new Date(b.lastDate || 0) - new Date(a.lastDate || 0));
}

export default function Reports({ onChangePage }) {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [showErrorGroups, setShowErrorGroups] = useState(false);
  const [errorHistory, setErrorHistory] = useState([]);
  const [configuredGroups, setConfiguredGroups] = useState([]);
  const [errorGroupsLoading, setErrorGroupsLoading] = useState(false);
  const [errorGroupSearch, setErrorGroupSearch] = useState('');

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
  const errorGroups = useMemo(
    () => summarizeErrorGroups(errorHistory, configuredGroups),
    [configuredGroups, errorHistory]
  );
  const visibleErrorGroups = useMemo(() => {
    const query = errorGroupSearch.trim().toLocaleLowerCase('ro-RO');
    if (!query) return errorGroups;
    return errorGroups.filter((item) =>
      `${item.groupName} ${item.groupId} ${item.latestReason} ${item.latestTechnicalMessage} ${item.campaigns.join(' ')}`
        .toLocaleLowerCase('ro-RO')
        .includes(query)
    );
  }, [errorGroupSearch, errorGroups]);
  const totalGroupErrors = useMemo(
    () => errorGroups.reduce((total, item) => total + item.count, 0),
    [errorGroups]
  );

  async function loadErrorGroups() {
    setErrorGroupsLoading(true);
    try {
      const [history, groups] = await Promise.all([api.getHistory(), api.getGroups()]);
      setErrorHistory(history);
      setConfiguredGroups(groups);
    } catch (error) {
      window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message: error.message, type: 'error' } }));
    } finally {
      setErrorGroupsLoading(false);
    }
  }

  async function toggleErrorGroups() {
    if (showErrorGroups) {
      setShowErrorGroups(false);
      return;
    }
    setShowErrorGroups(true);
    await loadErrorGroups();
  }

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
        <button className='danger-button reports-error-button' type='button' onClick={toggleErrorGroups} disabled={errorGroupsLoading}>
          <TriangleAlert size={16} />
          {errorGroupsLoading ? 'Se incarca...' : `Grupuri cu erori${errorGroups.length ? ` (${errorGroups.length})` : ''}`}
        </button>
        <button className="secondary-button" type="button" onClick={loadRuns} disabled={loading}>
          <RefreshCw size={16} /> {loading ? 'Se actualizeaza...' : 'Actualizeaza'}
        </button>
      </header>
      {showErrorGroups && (
        <section className='editor-panel error-groups-panel'>
          <div className='error-groups-heading'>
            <div>
              <h2>Grupuri care au avut erori</h2>
              <p>{errorGroups.length} grupuri unice · {totalGroupErrors} incidente in istoricul salvat</p>
            </div>
            <div className='button-row'>
              <button className='secondary-button' type='button' onClick={loadErrorGroups} disabled={errorGroupsLoading}>
                <RefreshCw size={16} /> Reincarca
              </button>
              <button className='ghost-button error-groups-close' type='button' onClick={() => setShowErrorGroups(false)} aria-label='Inchide lista'>
                <X size={18} />
              </button>
            </div>
          </div>

          <input
            className='error-groups-search'
            value={errorGroupSearch}
            onChange={(event) => setErrorGroupSearch(event.target.value)}
            placeholder='Cauta grup, ID, campanie sau mesaj de eroare...'
          />

          <div className='error-groups-list'>
            {visibleErrorGroups.map((item) => (
              <article className='error-group-card' key={item.groupId || item.groupName}>
                <div className='error-group-title'>
                  <div>
                    <strong>{item.groupName}</strong>
                    <span>{item.groupId || 'Fara ID'} · ultima eroare: {formatDate(item.lastDate)}</span>
                  </div>
                  <span className='error-count-badge'>{item.count} {item.count === 1 ? 'incident' : 'incidente'}</span>
                </div>

                <div className='error-group-meta'>
                  <span className={`status-pill ${item.configured ? (item.active ? 'success' : 'warning') : 'error'}`}>
                    {item.configured ? (item.active ? 'Activ' : 'Inactiv') : 'Nu mai este in lista'}
                  </span>
                  <span>Campanii: {item.campaigns.join(', ')}</span>
                </div>

                <div className='error-message-box'>
                  <span>Motiv standardizat</span>
                  <strong className={item.latestReasonCode === 'group_paused' ? 'paused' : 'unavailable'}>
                    {item.latestReason}
                  </strong>
                </div>

                <details className='error-history-details'>
                  <summary>Vezi ultimele {item.occurrences.length} aparitii si detaliile tehnice</summary>
                  {item.occurrences.map((occurrence, index) => (
                    <div key={`${occurrence.date}-${index}`}>
                      <span>{formatDate(occurrence.date)} · {occurrence.campaign}</span>
                      <strong>{occurrence.reason}</strong>
                      <p>{occurrence.technicalMessage}</p>
                    </div>
                  ))}
                </details>

                {item.groupUrl && (
                  <button
                    className='secondary-button error-group-open'
                    type='button'
                    onClick={() => window.open(item.groupUrl, '_blank', 'noopener,noreferrer')}
                  >
                    <ExternalLink size={15} /> Deschide grupul pe Facebook
                  </button>
                )}
              </article>
            ))}

            {!errorGroupsLoading && visibleErrorGroups.length === 0 && (
              <div className='empty-state-v2'>
                {errorGroups.length ? 'Niciun grup nu corespunde cautarii.' : 'Nu exista erori de grup in istoricul salvat.'}
              </div>
            )}
          </div>
        </section>
      )}

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
