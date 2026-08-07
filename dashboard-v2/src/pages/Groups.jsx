import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

const emptyGroup = {
  name: '',
  url: '',
  active: true,
  favorite: false,
  category: 'real_estate',
  overrideType: null,
};

function detectType(group) {
  if (group.overrideType) return group.overrideType;

  const name = String(group.name || '').toLowerCase();
  const rent = ['chirii', 'chirie', 'inchirieri', 'inchiriere', 'inchiriat'].some((key) =>
    name.includes(key)
  );
  const sale = ['vanzari', 'vanzare', 'vand', 'de vanzare'].some((key) =>
    name.includes(key)
  );

  if (rent && sale) return 'mixed';
  if (rent) return 'rent';
  if (sale) return 'sale';
  return 'mixed';
}

function getCategory(group) {
  return group.category || 'real_estate';
}

function nextGroupId(groups) {
  const max = groups.reduce((highest, group) => {
    const number = Number(String(group.id || '').replace('GROUP_', ''));
    return Number.isFinite(number) && number > highest ? number : highest;
  }, 0);

  return `GROUP_${String(max + 1).padStart(3, '0')}`;
}

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [message, setMessage] = useState('');
  const [newGroup, setNewGroup] = useState(emptyGroup);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const groupEditorRefs = useRef(new Map());

  async function loadGroups() {
    const data = await api.getGroups();
    setGroups(data);
  }

  useEffect(() => {
    let ignore = false;

    api.getGroups().then((data) => {
      if (!ignore) setGroups(data);
    });

    return () => {
      ignore = true;
    };
  }, []);

  function updateGroup(index, field, value) {
    setGroups((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  }

  function focusGroupEditor(groupId) {
    const row = groupEditorRefs.current.get(groupId);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.requestAnimationFrame(() => {
      row.querySelector('[data-group-name]')?.focus({ preventScroll: true });
    });
  }

  function addGroup() {
    if (!newGroup.url.trim()) {
      setMessage('Adauga URL-ul grupului.');
      return;
    }

    const groupId = nextGroupId(groups);
    const group = {
      id: groupId,
      name: newGroup.name.trim() || `Grup Facebook ${groupId}`,
      url: newGroup.url.trim(),
      active: newGroup.active,
      favorite: newGroup.favorite,
      category: newGroup.category,
      overrideType: newGroup.overrideType,
    };

    setGroups((prev) => [...prev, group]);
    setNewGroup(emptyGroup);
    setMessage('Grup adaugat local. Apasa Salveaza ca sa fie scris in groups.json.');
  }

  function deleteGroup(groupId) {
    const confirmDelete = window.confirm('Sigur vrei sa stergi acest grup din lista?');
    if (!confirmDelete) return;

    setGroups((prev) => prev.filter((group) => group.id !== groupId));
    setMessage('Grup sters local. Apasa Salveaza ca sa fie scris in groups.json.');
  }

  function activateAll() {
    setGroups((prev) => prev.map((group) => ({ ...group, active: true })));
  }

  function deactivateAll() {
    setGroups((prev) => prev.map((group) => ({ ...group, active: false })));
  }

  function activateFavorites() {
    setGroups((prev) =>
      prev.map((group) => ({ ...group, active: Boolean(group.favorite) }))
    );
  }

  function activateCategory(category) {
    setGroups((prev) =>
      prev.map((group) => ({ ...group, active: getCategory(group) === category }))
    );
  }

  function activateFirst(limit) {
    setGroups((prev) =>
      prev.map((group, index) => ({ ...group, active: index < limit }))
    );
  }

  async function saveGroups() {
    await api.saveGroups(groups);
    setMessage('Grupurile au fost salvate in groups.json.');
    await loadGroups();
  }

  const filteredGroups = groups.filter((group) => {
    const type = detectType(group);
    const groupCategory = getCategory(group);
    const searchText = `${group.name} ${group.url}`.toLowerCase();

    if (!searchText.includes(search.toLowerCase())) return false;
    if (categoryFilter !== 'all' && groupCategory !== categoryFilter) return false;
    if (filter === 'active') return group.active;
    if (filter === 'inactive') return !group.active;
    if (filter === 'favorite') return group.favorite;
    if (filter === 'rent') return type === 'rent';
    if (filter === 'sale') return type === 'sale';
    if (filter === 'mixed') return type === 'mixed';

    return true;
  });

  const activeCount = groups.filter((group) => group.active).length;
  const favoriteCount = groups.filter((group) => group.favorite).length;
  const realEstateCount = groups.filter((group) => getCategory(group) === 'real_estate').length;
  const jobsCount = groups.filter((group) => getCategory(group) === 'jobs').length;
  const mixedCount = groups.filter((group) => detectType(group) === 'mixed').length;

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Grupuri</h1>
          <p>Adauga, sterge, filtreaza si clasifica grupurile Facebook.</p>
        </div>

        <button className="primary-button" onClick={saveGroups}>
          Salveaza grupurile
        </button>
      </header>

      <section className="summary-grid">
        <div>Total: <strong>{groups.length}</strong></div>
        <div>Active: <strong>{activeCount}</strong></div>
        <div>Favorite: <strong>{favoriteCount}</strong></div>
        <div>Imobiliare: <strong>{realEstateCount}</strong></div>
        <div>Joburi: <strong>{jobsCount}</strong></div>
        <div>Mixed: <strong>{mixedCount}</strong></div>
      </section>

      <section className="editor-panel">
        <h2>Adauga grup</h2>

        <div className="group-add-grid">
          <input
            value={newGroup.name}
            onChange={(event) => setNewGroup((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Nume grup"
          />

          <input
            value={newGroup.url}
            onChange={(event) => setNewGroup((prev) => ({ ...prev, url: event.target.value }))}
            placeholder="https://www.facebook.com/groups/..."
          />

          <select
            value={newGroup.category}
            onChange={(event) =>
              setNewGroup((prev) => ({ ...prev, category: event.target.value }))
            }
          >
            <option value="real_estate">Imobiliare</option>
            <option value="jobs">Joburi</option>
          </select>

          <select
            value={newGroup.overrideType || 'auto'}
            onChange={(event) =>
              setNewGroup((prev) => ({
                ...prev,
                overrideType: event.target.value === 'auto' ? null : event.target.value,
              }))
            }
          >
            <option value="auto">Auto</option>
            <option value="rent">Chirie</option>
            <option value="sale">Vanzare</option>
            <option value="mixed">Mixed</option>
          </select>

          <button className="primary-button" onClick={addGroup}>
            Adauga
          </button>
        </div>
      </section>

      <section className="action-strip">
        <button className="primary-button" onClick={() => activateFirst(1)}>
          Activeaza primul grup
        </button>
        <button className="secondary-button" onClick={() => activateFirst(5)}>
          Activeaza primele 5
        </button>
        <button className="secondary-button" onClick={() => activateFirst(10)}>
          Activeaza primele 10
        </button>
        <button className="secondary-button" onClick={activateFavorites}>
          Activeaza favorite
        </button>
        <button className="secondary-button" onClick={() => activateCategory('real_estate')}>
          Activeaza Imobiliare
        </button>
        <button className="secondary-button" onClick={() => activateCategory('jobs')}>
          Activeaza Joburi
        </button>
        <button className="secondary-button" onClick={activateAll}>
          Activeaza toate
        </button>
        <button className="danger-button" onClick={deactivateAll}>
          Dezactiveaza toate
        </button>
      </section>

      <section className="filter-grid">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cauta dupa nume sau URL..."
        />

        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">Toate categoriile</option>
          <option value="real_estate">Imobiliare</option>
          <option value="jobs">Joburi</option>
        </select>

        <select value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">Toate statusurile</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="favorite">Favorite</option>
          <option value="rent">Chirie</option>
          <option value="sale">Vanzare</option>
          <option value="mixed">Mixed</option>
        </select>
      </section>

      {message && <p className="save-message">{message}</p>}

      <section className="groups-table-v2">
        {filteredGroups.map((group) => {
          const originalIndex = groups.findIndex((item) => item.id === group.id);

          return (
            <article
              className="group-row-v2"
              key={group.id}
              ref={(node) => {
                if (node) groupEditorRefs.current.set(group.id, node);
                else groupEditorRefs.current.delete(group.id);
              }}
            >
              <input
                type="checkbox"
                checked={group.active}
                onChange={(event) => updateGroup(originalIndex, 'active', event.target.checked)}
              />

              <button
                className={`star-button ${group.favorite ? 'star-active' : ''}`}
                onClick={() => updateGroup(originalIndex, 'favorite', !group.favorite)}
                title="Favorite"
              >
                *
              </button>

              <div className="group-edit-main">
                <input
                  data-group-name
                  value={group.name}
                  onChange={(event) => updateGroup(originalIndex, 'name', event.target.value)}
                />

                <input
                  value={group.url}
                  onChange={(event) => updateGroup(originalIndex, 'url', event.target.value)}
                />
              </div>

              <span className={group.active ? 'status-pill active' : 'status-pill inactive'}>
                {group.active ? 'Activ' : 'Inactiv'}
              </span>

              <select
                value={getCategory(group)}
                onChange={(event) => updateGroup(originalIndex, 'category', event.target.value)}
              >
                <option value="real_estate">Imobiliare</option>
                <option value="jobs">Joburi</option>
              </select>

              <select
                value={group.overrideType || 'auto'}
                onChange={(event) =>
                  updateGroup(
                    originalIndex,
                    'overrideType',
                    event.target.value === 'auto' ? null : event.target.value
                  )
                }
              >
                <option value="auto">Auto ({detectType(group)})</option>
                <option value="rent">Chirie</option>
                <option value="sale">Vanzare</option>
                <option value="mixed">Mixed</option>
              </select>

              <div className="group-row-actions">
                <button className="secondary-button small-button" onClick={() => focusGroupEditor(group.id)}>
                  Editeaza
                </button>
                <button className="danger-button small-button" onClick={() => deleteGroup(group.id)}>
                  Sterge
                </button>
              </div>
            </article>
          );
        })}

        {filteredGroups.length === 0 && (
          <div className="empty-state-v2">Nu exista grupuri care se potrivesc filtrelor.</div>
        )}
      </section>
    </div>
  );
}
