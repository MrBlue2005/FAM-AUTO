import {
  ArrowDownUp,
  BriefcaseBusiness,
  Building2,
  Check,
  Filter,
  RefreshCw,
  UsersRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const pageLabels = {
  dashboard: 'dashboard',
  campaigns: 'campanii',
  properties: 'proprietati',
  jobs: 'joburi',
  groups: 'grupuri',
  media: 'media',
  queue: 'queue',
  livefeed: 'live feed',
  analytics: 'analytics',
  reports: 'rapoarte',
  robot: 'robot',
  settings: 'settings',
};

const navItems = [
  { id: 'properties', label: 'Proprietati', Icon: Building2 },
  { id: 'jobs', label: 'Joburi', Icon: BriefcaseBusiness },
  { id: 'groups', label: 'Grupuri', Icon: UsersRound },
];

const filterOptions = [
  { id: 'all', label: 'Toate' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'favorites', label: 'Favorite' },
  { id: 'errors', label: 'Cu erori' },
];

const sortOptions = [
  { id: 'name', label: 'Nume A-Z' },
  { id: 'recent', label: 'Cele mai recente' },
  { id: 'active', label: 'Active primele' },
  { id: 'errors', label: 'Erori primele' },
];

function getPrimaryAction(activePage, onChangePage) {
  if (activePage === 'dashboard' || activePage === 'campaigns') {
    return { label: '+ Proprietate', run: () => onChangePage('properties') };
  }

  if (activePage === 'properties') {
    return { label: '+ Proprietate', run: () => window.scrollTo({ top: 0, behavior: 'smooth' }) };
  }

  if (activePage === 'jobs') {
    return { label: '+ Job', run: () => window.scrollTo({ top: 0, behavior: 'smooth' }) };
  }

  if (activePage === 'groups') {
    return { label: '+ Grup', run: () => window.scrollTo({ top: 0, behavior: 'smooth' }) };
  }

  if (activePage === 'reports') {
    return { label: 'Vezi Analytics', run: () => onChangePage('analytics') };
  }

  return { label: '+ Nou', run: () => onChangePage('campaigns') };
}

export default function Toolbar({ activePage, onChangePage }) {
  const [openPanel, setOpenPanel] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [search, setSearch] = useState('');
  const toolbarRef = useRef(null);
  const primaryAction = getPrimaryAction(activePage, onChangePage);
  const label = pageLabels[activePage] || activePage;

  useEffect(() => {
    function handlePointerDown(event) {
      if (!toolbarRef.current?.contains(event.target)) {
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

  function togglePanel(panel) {
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  function notifyPage(next = {}) {
    window.dispatchEvent(new CustomEvent('rx:toolbar', { detail: { page: activePage, search, filter, sort, ...next } }));
  }

  return (
    <section className="toolbar" ref={toolbarRef}>
      <button className="primary-button" onClick={primaryAction.run}>
        {primaryAction.label}
      </button>

      <div className="toolbar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`ghost-button toolbar-nav-button ${activePage === item.id ? 'active' : ''}`}
            onClick={() => onChangePage(item.id)}
            aria-pressed={activePage === item.id}
          >
            <item.Icon size={16} strokeWidth={2.35} />
            {item.label}
          </button>
        ))}
      </div>

      <button className="ghost-button" onClick={() => window.location.reload()}>
        <RefreshCw size={16} strokeWidth={2.35} />
        Refresh
      </button>

      <div className="toolbar-spacer" />

      <input value={search} onChange={(event) => { setSearch(event.target.value); notifyPage({ search: event.target.value }); }} placeholder={`Cauta in ${label}...`} />

      <div className="toolbar-action-wrap">
        <button className={`ghost-button ${openPanel === 'filters' ? 'active' : ''}`} onClick={() => togglePanel('filters')}>
          <Filter size={16} strokeWidth={2.35} />
          Filtre
        </button>

        {openPanel === 'filters' && (
          <div className="toolbar-panel">
            <strong>Filtre rapide</strong>
            <div className="toolbar-panel-list">
              {filterOptions.map((option) => (
                <button
                  key={option.id}
                  className={filter === option.id ? 'selected' : ''}
                  onClick={() => { setFilter(option.id); notifyPage({ filter: option.id }); }}
                >
                  <span>{option.label}</span>
                  {filter === option.id && <Check size={15} strokeWidth={2.5} />}
                </button>
              ))}
            </div>
            <p>Filtrul se aplica paginii curente.</p>
          </div>
        )}
      </div>

      <div className="toolbar-action-wrap">
        <button className={`ghost-button ${openPanel === 'sort' ? 'active' : ''}`} onClick={() => togglePanel('sort')}>
          <ArrowDownUp size={16} strokeWidth={2.35} />
          Sortare
        </button>

        {openPanel === 'sort' && (
          <div className="toolbar-panel">
            <strong>Sortare</strong>
            <div className="toolbar-panel-list">
              {sortOptions.map((option) => (
                <button
                  key={option.id}
                  className={sort === option.id ? 'selected' : ''}
                  onClick={() => { setSort(option.id); notifyPage({ sort: option.id }); }}
                >
                  <span>{option.label}</span>
                  {sort === option.id && <Check size={15} strokeWidth={2.5} />}
                </button>
              ))}
            </div>
            <p>Sortarea se aplica paginii curente.</p>
          </div>
        )}
      </div>
    </section>
  );
}
