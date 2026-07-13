import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusType(status) {
  if (status === 'posted') return 'success';
  if (status === 'error') return 'error';
  if (status === 'skipped') return 'warning';
  return 'info';
}

export default function LiveFeed() {
  const [robot, setRobot] = useState(null);
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let ignore = false;

    function load() {
      api.getLiveFeed({ limit: 120 }).then(({ robot: robotData, history: historyData }) => {
        if (ignore) return;
        setRobot(robotData);
        setHistory(historyData);
      });
    }

    load();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load();
      }
    }, robot?.robotStatus === 'running' || robot?.robotStatus === 'paused' ? 3000 : 10000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [robot?.robotStatus]);

  const events = useMemo(() => {
    const live = (robot?.liveFeed || []).map((event, index) => ({
      id: `live-${index}`,
      source: 'live',
      type: event.type || 'info',
      status: event.type || 'info',
      title: event.message,
      subtitle: 'Robot live',
      time: event.time || '-',
      rawTime: null,
    }));

    const persisted = history
      .map((entry, index) => ({
        id: `history-${index}-${entry.date}`,
        source: 'history',
        type: statusType(entry.status),
        status: entry.status,
        title: `${entry.status} / ${entry.propertyName || entry.propertyId || '-'}`,
        subtitle: `${entry.groupName || '-'} / Ziua ${entry.day || '-'}`,
        time: formatDate(entry.date),
        rawTime: entry.date,
      }));

    return [...live, ...persisted];
  }, [robot, history]);

  const filteredEvents = events.filter((event) => {
    const text = `${event.title} ${event.subtitle} ${event.status}`.toLowerCase();
    if (!text.includes(search.toLowerCase())) return false;
    if (filter !== 'all' && event.status !== filter && event.type !== filter) return false;
    return true;
  });

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Live Feed</h1>
          <p>Actiuni live ale robotului si istoricul persistent al publicarilor.</p>
        </div>

        <span className={`robot-pill ${robot?.robotStatus || 'idle'}`}>
          {robot?.robotStatus || 'idle'}
        </span>
      </header>

      <section className="filter-grid">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cauta eveniment, grup sau campanie..."
        />

        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">Toate evenimentele</option>
          <option value="success">Live success</option>
          <option value="warning">Live warning</option>
          <option value="error">Erori</option>
          <option value="posted">Postate</option>
          <option value="skipped">Sarite</option>
          <option value="prepared">Pregatite</option>
        </select>
      </section>

      <section className="feed-timeline-v2">
        {filteredEvents.map((event) => (
          <article className={`feed-event-v2 ${event.type}`} key={event.id}>
            <div className="feed-dot" />
            <div>
              <strong>{event.title}</strong>
              <span>{event.subtitle}</span>
            </div>
            <time>{event.time}</time>
          </article>
        ))}

        {filteredEvents.length === 0 && (
          <div className="empty-state-v2">Nu exista evenimente pentru filtrele curente.</div>
        )}
      </section>
    </div>
  );
}
