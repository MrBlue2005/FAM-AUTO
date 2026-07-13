import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';

function percent(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const groupKey = item[key] || '-';
    acc[groupKey] = acc[groupKey] || [];
    acc[groupKey].push(item);
    return acc;
  }, {});
}

export default function Analytics() {
  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [properties, setProperties] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [range, setRange] = useState('all');
  const [rangeNow, setRangeNow] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let ignore = false;

    Promise.all([
      api.getHistory(),
      api.getPropertyLogs(),
      api.getProperties(),
      api.getJobs(),
    ]).then(([historyData, logsData, propertiesData, jobsData]) => {
      if (ignore) return;
      setHistory(historyData);
      setLogs(logsData);
      setProperties(propertiesData);
      setJobs(jobsData);
    });

    return () => {
      ignore = true;
    };
  }, []);

  const portfolioItems = useMemo(
    () => [
      ...properties.map((item) => ({
        id: item.id,
        name: item.name,
        type: 'property',
      })),
      ...jobs.map((item) => ({
        id: item.id,
        name: item.title,
        type: 'job',
      })),
    ],
    [properties, jobs]
  );

  const portfolioIds = useMemo(
    () => new Set(portfolioItems.map((item) => item.id)),
    [portfolioItems]
  );

  const activeHistory = useMemo(
    () => history.filter((entry) => portfolioIds.has(entry.propertyId)),
    [history, portfolioIds]
  );

  const filteredHistory = useMemo(() => {
    if (range === 'all') return activeHistory;
    const days = Number(range);
    const threshold = rangeNow - days * 24 * 60 * 60 * 1000;
    return activeHistory.filter((entry) => new Date(entry.date).getTime() >= threshold);
  }, [activeHistory, range, rangeNow]);

  const posted = filteredHistory.filter((entry) => entry.status === 'posted').length;
  const prepared = filteredHistory.filter((entry) => entry.status === 'prepared').length;
  const skipped = filteredHistory.filter((entry) => entry.status === 'skipped').length;
  const errors = filteredHistory.filter((entry) => entry.status === 'error').length;
  const total = filteredHistory.length;

  function getViews(entry) {
    return Number(
      entry.views ??
      entry.viewCount ??
      entry.impressions ??
      entry.reach ??
      entry.metrics?.views ??
      entry.metrics?.impressions ??
      0
    ) || 0;
  }

  const campaignRows = Object.entries(groupBy(filteredHistory, 'propertyId'))
    .map(([propertyId, entries]) => ({
      id: propertyId,
      name: entries[0]?.propertyName || propertyId,
      total: entries.length,
      posted: entries.filter((entry) => entry.status === 'posted').length,
      errors: entries.filter((entry) => entry.status === 'error').length,
      views: entries.reduce((sum, entry) => sum + getViews(entry), 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const groupRows = Object.entries(groupBy(filteredHistory, 'groupId'))
    .map(([groupId, entries]) => ({
      id: groupId,
      name: entries[0]?.groupName || groupId,
      total: entries.length,
      posted: entries.filter((entry) => entry.status === 'posted').length,
      errors: entries.filter((entry) => entry.status === 'error').length,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const activeLogs = logs.filter((log) => portfolioIds.has(log.propertyId));
  const bestLog = activeLogs.slice().sort((a, b) => b.posted - a.posted)[0];
  const riskLog = activeLogs.slice().sort((a, b) => b.errors - a.errors)[0];
  const kpiRows = portfolioItems
    .map((item) => {
      const entries = filteredHistory.filter((entry) => entry.propertyId === item.id);
      return {
        ...item,
        posted: entries.filter((entry) => entry.status === 'posted').length,
        prepared: entries.filter((entry) => entry.status === 'prepared').length,
        errors: entries.filter((entry) => entry.status === 'error').length,
        views: entries.reduce((sum, entry) => sum + getViews(entry), 0),
      };
    })
    .sort((a, b) => b.views - a.views || b.posted - a.posted);

  async function exportExcel() {
    setExporting(true);
    try {
      await api.downloadExcelReport(range);
      window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message: 'Raportul Excel a fost generat.', type: 'success' } }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('rx:toast', { detail: { message: error.message, type: 'error' } }));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Analytics</h1>
          <p>KPI-uri pentru postari, erori, campanii si grupuri.</p>
        </div>

        <div className="button-row">
          <select
            value={range}
            onChange={(event) => {
              setRange(event.target.value);
              setRangeNow(event.target.value === 'all' ? 0 : Date.now());
            }}
          >
            <option value="all">Tot istoricul</option>
            <option value="1">Ultimele 24h</option>
            <option value="7">Ultimele 7 zile</option>
            <option value="30">Ultimele 30 zile</option>
          </select>
          <button className="primary-button" type="button" onClick={exportExcel} disabled={exporting}>
            {exporting ? 'Se genereaza...' : 'Export Excel'}
          </button>
        </div>
      </header>

      <section className="summary-grid analytics-summary">
        <div>Total actiuni: <strong>{total}</strong></div>
        <div>Postate: <strong>{posted}</strong></div>
        <div>Pregatite: <strong>{prepared}</strong></div>
        <div>Sarite: <strong>{skipped}</strong></div>
        <div>Erori: <strong>{errors}</strong></div>
        <div>Rata succes: <strong>{percent(posted, total)}%</strong></div>
      </section>

      <section className="analytics-grid-v2">
        <article className="editor-panel">
          <h2>Top campanii</h2>
          <div className="analytics-list">
            {campaignRows.map((row) => (
              <div className="analytics-row" key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.id}</span>
                </div>
                <span>{row.posted}/{row.total} postate</span>
                <span>{row.views} views</span>
                <span className={row.errors > 0 ? 'error-count' : ''}>{row.errors} erori</span>
              </div>
            ))}
          </div>
        </article>

        <article className="editor-panel">
          <h2>Top grupuri</h2>
          <div className="analytics-list">
            {groupRows.map((row) => (
              <div className="analytics-row" key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <span>{row.id}</span>
                </div>
                <span>{row.posted}/{row.total} postate</span>
                <span className={row.errors > 0 ? 'error-count' : ''}>{row.errors} erori</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="analytics-grid-v2">
        <article className="insight-card-v2">
          <span>Cea mai activa campanie</span>
          <strong>{bestLog?.propertyName || '-'}</strong>
          <p>{bestLog ? `${bestLog.posted} postari din ${bestLog.total} actiuni` : 'Nu exista date.'}</p>
        </article>

        <article className="insight-card-v2">
          <span>Atentie la erori</span>
          <strong>{riskLog?.propertyName || '-'}</strong>
          <p>{riskLog ? `${riskLog.errors} erori raportate` : 'Nu exista date.'}</p>
        </article>
      </section>

      <section className="editor-panel">
        <h2>KPI portofoliu curent</h2>
        <div className="analytics-list">
          {kpiRows.map((row) => (
            <div className="analytics-row" key={row.id}>
              <div>
                <strong>{row.name}</strong>
                <span>{row.type === 'job' ? 'Job' : 'Proprietate'} / {row.id}</span>
              </div>
              <span>{row.views} views</span>
              <span>{row.posted} postate</span>
              <span className={row.errors > 0 ? 'error-count' : ''}>{row.errors} erori</span>
            </div>
          ))}

          {kpiRows.length === 0 && (
            <div className="empty-state-v2">Nu exista proprietati sau joburi in portofoliul curent.</div>
          )}
        </div>
      </section>
    </div>
  );
}
