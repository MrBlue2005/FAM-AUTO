import { Bell, ExternalLink, LoaderCircle, Search, Settings } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';

const titles = {
  dashboard: 'Dashboard',
  campaigns: 'Campanii',
  properties: 'Proprietati',
  jobs: 'Joburi',
  groups: 'Grupuri',
  media: 'Media Library',
  queue: 'Queue Manager',
  scheduler: 'Programari campanii',
  livefeed: 'Live Feed',
  analytics: 'Analytics',
  reports: 'Rapoarte',
  robot: 'RX Propulse Control',
  settings: 'Settings',
};

function buildSearchItems({ properties, jobs, groups }) {
  return [
    ...properties.map((item) => ({
      id: `property-${item.id}`,
      title: item.name,
      subtitle: item.id,
      page: 'properties',
      type: 'Proprietate',
    })),
    ...jobs.map((item) => ({
      id: `job-${item.id}`,
      title: item.title,
      subtitle: item.id,
      page: 'jobs',
      type: 'Job',
    })),
    ...groups.map((item) => ({
      id: `group-${item.id}`,
      title: item.name,
      subtitle: item.url,
      page: 'groups',
      type: 'Grup',
    })),
  ];
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function Topbar({ activePage, onChangePage }) {
  const [openPanel, setOpenPanel] = useState(null);
  const [overlayOpening, setOverlayOpening] = useState(false);
  const [query, setQuery] = useState('');
  const actionsRef = useRef(null);
  const [data, setData] = useState({
    properties: [],
    jobs: [],
    groups: [],
    history: [],
    robot: null,
  });

  useEffect(() => {
    let ignore = false;

    Promise.all([
      api.getProperties(),
      api.getJobs(),
      api.getGroups(),
      api.getHistory(),
      api.getRobotStatus(),
    ])
      .then(([properties, jobs, groups, history, robot]) => {
        if (!ignore) setData({ properties, jobs, groups, history, robot });
      })
      .catch(() => {
        // StatusBar and page-level error states report API connectivity.
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!actionsRef.current?.contains(event.target)) {
        setOpenPanel(null);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpenPanel(null);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];

    return buildSearchItems(data)
      .filter((item) => `${item.title} ${item.subtitle} ${item.type}`.toLowerCase().includes(term))
      .slice(0, 8);
  }, [data, query]);

  const notifications = [
    {
      id: 'robot-status',
      title: `Robot: ${data.robot?.robotStatus || 'idle'}`,
      subtitle: data.robot?.lastMessage || 'Robot pregatit.',
      tone: data.robot?.robotStatus === 'error' ? 'error' : 'info',
    },
    ...data.history
      .slice()
      .reverse()
      .slice(0, 7)
      .map((entry, index) => ({
        id: `${entry.date}-${index}`,
        title: `${entry.status} / ${entry.propertyName || entry.propertyId || '-'}`,
        subtitle: `${entry.groupName || '-'} / ${formatDate(entry.date)}`,
        tone: entry.status === 'error' ? 'error' : entry.status === 'posted' ? 'success' : 'info',
      })),
  ];

  function togglePanel(panel) {
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  function goToPage(page) {
    onChangePage(page);
    setOpenPanel(null);
    setQuery('');
  }

  async function openOverlay() {
    if (overlayOpening) return;
    setOverlayOpening(true);

    const width = 780;
    const height = 640;
    const left = Math.max(window.screenX + window.outerWidth - width - 24, 0);
    const top = Math.max(window.screenY + 64, 0);
    const overlayUrl = new URL('/overlay', window.location.origin).href;

    try {
      const result = await api.openDesktopOverlay();
      if (result?.ok) {
        window.dispatchEvent(new CustomEvent('rx:toast', {
          detail: { message: 'RX Propulse Overlay a fost deschis.', type: 'success' },
        }));
        return;
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent('rx:toast', {
        detail: {
          message: error.message || 'Overlayul desktop nu a putut fi pornit. Deschid varianta web.',
          type: 'error',
        },
      }));

      const popup = window.open(
        overlayUrl,
        'rx-ai-web-overlay',
        `popup=yes,width=${width},height=${height},left=${left},top=${top}`
      );
      if (!popup) window.open(overlayUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setOverlayOpening(false);
    }
  }

  return (
    <header className="topbar">
      <div>
        <h2>{titles[activePage] || 'RX PROPULSE TOOL'}</h2>
      </div>

      <div className="topbar-actions" ref={actionsRef}>
        <div className="topbar-action-wrap">
          <button onClick={() => togglePanel('search')}>
            <Search size={16} strokeWidth={2.35} />
            Search
          </button>

          {openPanel === 'search' && (
            <div className="topbar-panel search-panel">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cauta proprietati, joburi sau grupuri..."
              />

              <div className="topbar-panel-list">
                {searchResults.map((item) => (
                  <button key={item.id} onClick={() => goToPage(item.page)}>
                    <strong>{item.title}</strong>
                    <span>{item.type} / {item.subtitle}</span>
                  </button>
                ))}

                {query && searchResults.length === 0 && (
                  <div className="topbar-empty">Nu am gasit rezultate.</div>
                )}

                {!query && (
                  <div className="topbar-empty">Tasteaza ca sa cauti in datele dashboard-ului.</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="topbar-action-wrap">
          <button onClick={() => togglePanel('notifications')}>
            <Bell size={16} strokeWidth={2.35} />
            Notificari
          </button>

          {openPanel === 'notifications' && (
            <div className="topbar-panel notifications-panel">
              <div className="topbar-panel-title">
                <strong>Notificari</strong>
                <span>{notifications.length}</span>
              </div>

              <div className="topbar-panel-list">
                {notifications.map((item) => (
                  <div className={`notification-item ${item.tone}`} key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.subtitle}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <button onClick={() => goToPage('settings')}>
          <Settings size={16} strokeWidth={2.35} />
          Setari
        </button>

        <button onClick={openOverlay} disabled={overlayOpening}>
          {overlayOpening
            ? <LoaderCircle className="spin" size={16} strokeWidth={2.35} />
            : <ExternalLink size={16} strokeWidth={2.35} />}
          {overlayOpening ? 'Pornesc…' : 'Overlay'}
        </button>
      </div>
    </header>
  );
}
