import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  RefreshCw,
  Search,
  Stethoscope,
  TriangleAlert,
} from 'lucide-react';
import { api } from '../services/api';
import './Diagnostics.css';

const filterLabels = {
  all: 'Toate',
  error: 'Blocante',
  warning: 'Avertismente',
};

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusCopy(data) {
  if (data?.status === 'blocked') {
    return {
      title: 'Pornirea robotului este blocata',
      description: 'Exista cel putin o problema care trebuie corectata inainte de rulare.',
      tone: 'error',
      Icon: CircleAlert,
    };
  }
  if (data?.status === 'warning') {
    return {
      title: 'Configuratia poate rula, dar necesita atentie',
      description: 'Nu exista erori blocante, insa verifica avertismentele de mai jos.',
      tone: 'warning',
      Icon: TriangleAlert,
    };
  }
  return {
    title: 'Preflight pregatit',
    description: 'Nu au fost detectate probleme blocante sau avertismente.',
    tone: 'success',
    Icon: CircleCheck,
  };
}

export default function Diagnostics({ onChangePage }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.getDiagnostics());
    } catch (loadError) {
      setError(loadError.message || 'Diagnosticul nu a putut fi incarcat.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    api.getDiagnostics()
      .then((result) => {
        if (!ignore) setData(result);
      })
      .catch((loadError) => {
        if (!ignore) setError(loadError.message || 'Diagnosticul nu a putut fi incarcat.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const visibleIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ro-RO');
    return (data?.issues || []).filter((issue) => {
      if (filter !== 'all' && issue.level !== filter) return false;
      if (!normalizedQuery) return true;
      return `${issue.title} ${issue.explanation} ${issue.resolution} ${issue.originalMessage} ${issue.campaignTitle || ''} ${issue.scheduleName || ''}`
        .toLocaleLowerCase('ro-RO')
        .includes(normalizedQuery);
    });
  }, [data?.issues, filter, query]);

  const status = statusCopy(data);
  const StatusIcon = status.Icon;

  return (
    <div className='management-page diagnostics-page'>
      <header className='management-header'>
        <div>
          <h1>Diagnostic preflight</h1>
          <p>Interpretare clara pentru erorile care blocheaza robotul si pasii de remediere.</p>
        </div>
        <button className='secondary-button diagnostics-refresh' type='button' onClick={loadDiagnostics} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} size={16} />
          {loading ? 'Verific...' : 'Reverifica'}
        </button>
      </header>

      {error && (
        <section className='diagnostics-load-error'>
          <CircleAlert size={20} />
          <div><strong>API-ul de diagnostic nu raspunde</strong><span>{error}</span></div>
        </section>
      )}

      {data && (
        <>
          <section className={`diagnostics-status ${status.tone}`}>
            <StatusIcon size={25} />
            <div>
              <strong>{status.title}</strong>
              <span>{status.description}</span>
            </div>
            <small>Actualizat {formatDate(data.generatedAt)}</small>
          </section>

          <section className='summary-grid diagnostics-summary'>
            <div>Erori blocante <strong>{data.summary?.errors || 0}</strong></div>
            <div>Avertismente <strong>{data.summary?.warnings || 0}</strong></div>
            <div>Taskuri active <strong>{data.summary?.activeTasks || 0}</strong></div>
            <div>Total Queue <strong>{data.summary?.totalTasks || 0}</strong></div>
          </section>

          <section className='editor-panel diagnostics-context'>
            <div><span>Mod</span><strong>{data.context?.mode === 'live' ? 'LIVE' : 'TEST'}</strong></div>
            <div><span>Ziua campaniei</span><strong>{data.context?.campaignDay || '-'}</strong></div>
            <div><span>Categorie</span><strong>{data.context?.category || '-'}</strong></div>
            <div><span>Profil browser</span><strong>{data.context?.facebookProfileLabel || data.context?.facebookProfileId}</strong></div>
            <div><span>Campanii selectate</span><strong>{data.context?.selectedCampaignIds?.join(', ') || 'Toate cele active'}</strong></div>
          </section>

          <section className='editor-panel diagnostics-tools'>
            <div className='diagnostics-filters'>
              {Object.entries(filterLabels).map(([id, label]) => (
                <button
                  className={filter === id ? 'active' : ''}
                  key={id}
                  type='button'
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className='diagnostics-search'>
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Cauta eroare, campanie sau solutie...' />
            </label>
          </section>

          <section className='diagnostics-list'>
            {visibleIssues.map((issue) => {
              const IssueIcon = issue.level === 'error' ? CircleAlert : TriangleAlert;
              return (
                <article className={`diagnostic-card ${issue.level}`} key={issue.id}>
                  <div className='diagnostic-card-icon'><IssueIcon size={20} /></div>
                  <div className='diagnostic-card-body'>
                    <div className='diagnostic-card-heading'>
                      <div>
                        <span>{issue.level === 'error' ? 'BLOCANT' : 'ATENTIE'} · {issue.code}</span>
                        <h2>{issue.title}</h2>
                      </div>
                      {(issue.scheduleName || issue.campaignTitle) && <strong className='diagnostic-campaign'>{issue.scheduleName || issue.campaignTitle}</strong>}
                    </div>

                    <div className='diagnostic-interpretation'>
                      <div><span>Ce inseamna</span><p>{issue.explanation}</p></div>
                      <div><span>Cum rezolvi</span><p>{issue.resolution}</p></div>
                    </div>

                    <div className='diagnostic-actions'>
                      {issue.actionPage && (
                        <button className='secondary-button' type='button' onClick={() => onChangePage(issue.actionPage)}>
                          {issue.actionLabel || 'Deschide'} <ArrowRight size={15} />
                        </button>
                      )}
                      <details>
                        <summary>Mesajul tehnic original</summary>
                        <code>{issue.originalMessage || '-'}</code>
                      </details>
                    </div>
                  </div>
                </article>
              );
            })}

            {!loading && visibleIssues.length === 0 && (
              <div className='empty-state-v2 diagnostics-empty'>
                <Stethoscope size={28} />
                <strong>{data.issues?.length ? 'Nicio problema nu corespunde filtrului.' : 'Configuratia este curata.'}</strong>
                <span>{data.issues?.length ? 'Schimba filtrul sau cautarea.' : 'Robotul nu are erori preflight de interpretat.'}</span>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
