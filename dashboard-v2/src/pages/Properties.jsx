import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import ProfileStartModal from '../components/ProfileStartModal';
import MediaDropzone from '../components/MediaDropzone';
import FacebookPostPreview from '../components/FacebookPostPreview';
import { notify } from '../utils/notify';
import { clearFormDraft, loadFormDraft, saveFormDraft } from '../utils/formDraft';

const DRAFT_KEY = 'rx-property-form-draft';

const defaultPosts = [
  { day: 1, title: 'Ziua 1', variant: 'A', active: true, published: false, imagePath: '', media: [], text: '' },
  { day: 2, title: 'Ziua 2', variant: 'B', active: true, published: false, imagePath: '', media: [], text: '' },
  { day: 3, title: 'Ziua 3', variant: 'C', active: true, published: false, imagePath: '', media: [], text: '' },
];

const emptyForm = {
  id: '',
  name: '',
  transactionType: 'rent',
  active: true,
  facebookProfileId: '',
  posts: defaultPosts,
};

function generateIdFromName(name) {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function freshForm() {
  return {
    ...emptyForm,
    posts: defaultPosts.map((post) => ({ ...post })),
  };
}

function PropertyPreviewModal({ property, profileLabel, onClose }) {
  const posts = property.posts?.length ? property.posts : defaultPosts;
  const [selectedPostIndex, setSelectedPostIndex] = useState(0);
  const selectedPost = posts[selectedPostIndex] || posts[0];

  return (
    <div className="modal-backdrop property-preview-backdrop" onMouseDown={onClose}>
      <section
        className="property-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview pentru ${property.name}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>Preview postari</h2>
            <p>{property.name}</p>
          </div>
          <button type="button" className="secondary-button small-button" onClick={onClose}>Inchide</button>
        </header>

        <div className="property-preview-tabs" role="tablist" aria-label="Alege ziua postarii">
          {posts.map((post, index) => (
            <button
              key={`${post.day}-${index}`}
              type="button"
              role="tab"
              aria-selected={selectedPostIndex === index}
              className={selectedPostIndex === index ? 'active' : ''}
              onClick={() => setSelectedPostIndex(index)}
            >
              Ziua {post.day || index + 1}
            </button>
          ))}
        </div>

        {selectedPost && (
          <FacebookPostPreview post={selectedPost} profileLabel={profileLabel} open hideToggle />
        )}
      </section>
    </div>
  );
}

export default function Properties({ editRequest, onEditHandled, onDirtyChange, onChangePage }) {
  const [properties, setProperties] = useState([]);
  const [propertyLogs, setPropertyLogs] = useState([]);
  const [form, setForm] = useState(() => loadFormDraft(DRAFT_KEY, freshForm));
  const [message, setMessage] = useState('');
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [pendingPropertyName, setPendingPropertyName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openDetailsId, setOpenDetailsId] = useState(null);
  const [previewProperty, setPreviewProperty] = useState(null);
  const [search, setSearch] = useState('');
  const [facebookProfiles, setFacebookProfiles] = useState([]);
  const [toolbarFilter, setToolbarFilter] = useState('all');
  const [toolbarSort, setToolbarSort] = useState('name');
  const [selectedIds, setSelectedIds] = useState([]);
  const [validationErrors, setValidationErrors] = useState({});
  const [formBaseline, setFormBaseline] = useState(freshForm);
  const [postTextHeight, setPostTextHeight] = useState(null);
  const initialFormRef = useRef(form);
  const editorRef = useRef(null);
  const activePostTextareaRef = useRef(null);
  const postTextareaRefs = useRef([]);

  const isDirty = JSON.stringify(form) !== JSON.stringify(formBaseline);

  function scrollToEditor() {
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  useEffect(() => {
    function synchronizePostTextareas() {
      const textarea = activePostTextareaRef.current;
      if (!textarea) return;
      const height = Math.round(textarea.getBoundingClientRect().height);
      activePostTextareaRef.current = null;
      if (height >= 120) setPostTextHeight(height);
    }

    document.addEventListener('pointerup', synchronizePostTextareas);
    document.addEventListener('pointercancel', synchronizePostTextareas);
    return () => {
      document.removeEventListener('pointerup', synchronizePostTextareas);
      document.removeEventListener('pointercancel', synchronizePostTextareas);
    };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const activeTextarea = activePostTextareaRef.current;
      if (!activeTextarea || !entries.some((entry) => entry.target === activeTextarea)) return;

      const height = Math.round(activeTextarea.getBoundingClientRect().height);
      for (const textarea of postTextareaRefs.current) {
        if (textarea && textarea !== activeTextarea) {
          textarea.style.height = `${height}px`;
        }
      }
    });

    for (const textarea of postTextareaRefs.current) {
      if (textarea) observer.observe(textarea);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onDirtyChange?.(isDirty);
    if (editingId) {
      clearFormDraft(DRAFT_KEY);
      return;
    }
    saveFormDraft(DRAFT_KEY, form);
  }, [editingId, form, isDirty, onDirtyChange]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      onDirtyChange?.(false);
    };
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    const handleToolbar = (event) => {
      if (event.detail?.page !== 'properties') return;
      if (typeof event.detail.search === 'string') setSearch(event.detail.search);
      if (event.detail.filter) setToolbarFilter(event.detail.filter);
      if (event.detail.sort) setToolbarSort(event.detail.sort);
    };
    window.addEventListener('rx:toolbar', handleToolbar);
    return () => window.removeEventListener('rx:toolbar', handleToolbar);
  }, []);

  async function loadData() {
    const [propertiesData, logsData, config] = await Promise.all([
      api.getProperties(),
      api.getPropertyLogs(),
      api.getRuntimeConfig(),
    ]);

    setProperties(propertiesData);
    setPropertyLogs(logsData);
    setFacebookProfiles(config.facebookProfiles || []);
  }

  useEffect(() => {
    let ignore = false;
    const transferId = new URLSearchParams(window.location.search).get('descriptionTransfer');
    const transferRequest = transferId
      ? api.getPropertyDescriptionTransfer(transferId)
        .then((data) => ({ data }))
        .catch((error) => ({ error }))
      : Promise.resolve(null);

    Promise.all([
      api.getProperties(),
      api.getPropertyLogs(),
      api.getRuntimeConfig(),
      transferRequest,
    ]).then(([propertiesData, logsData, config, transferResult]) => {
      if (ignore) return;
      setProperties(propertiesData);
      setPropertyLogs(logsData);
      setFacebookProfiles(config.facebookProfiles || []);

      const requestedId = editRequest?.id || window.localStorage.getItem('rx-edit-property-id');
      const requestedProperty = propertiesData.find((item) => item.id === requestedId);

      if (transferResult?.data) {
        const transfer = transferResult.data;
        const initialForm = initialFormRef.current;
        const staleEditDraft = initialForm.id
          && propertiesData.some((property) => property.id === initialForm.id);
        const baseForm = staleEditDraft ? freshForm() : initialForm;
        const fallbackPosts = freshForm().posts;
        const importedForm = {
          ...baseForm,
          name: baseForm.name || transfer.sourceTitle || '',
          transactionType: transfer.transactionType || baseForm.transactionType,
          posts: fallbackPosts.map((fallbackPost, index) => ({
            ...fallbackPost,
            ...(baseForm.posts?.[index] || {}),
            day: index + 1,
            title: transfer.descriptions[index]?.title || baseForm.posts?.[index]?.title || fallbackPost.title,
            text: transfer.descriptions[index]?.text || '',
          })),
        };
        window.localStorage.removeItem('rx-edit-property-id');
        clearFormDraft(DRAFT_KEY);
        onEditHandled?.();
        setEditingId(null);
        setFormBaseline(baseForm);
        setForm(importedForm);
        initialFormRef.current = importedForm;
        setValidationErrors({});
        setOpenMenuId(null);
        setMessage('Cele 3 descrieri au fost importate in zilele 1, 2 si 3.');
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete('descriptionTransfer');
        window.history.replaceState({}, '', currentUrl);
        scrollToEditor();
      } else if (transferResult?.error) {
        setMessage(transferResult.error.message || 'Descrierile nu au putut fi importate.');
      } else if (requestedProperty) {
        window.localStorage.removeItem('rx-edit-property-id');
        clearFormDraft(DRAFT_KEY);
        onEditHandled?.();
        setEditingId(requestedProperty.id);
        const requestedForm = {
          ...freshForm(),
          ...requestedProperty,
          posts: requestedProperty.posts?.length ? requestedProperty.posts : freshForm().posts,
        };
        setFormBaseline(requestedForm);
        setForm(requestedForm);
        setValidationErrors({});
        setOpenMenuId(null);
        setMessage(`Editezi: ${requestedProperty.name}`);
        scrollToEditor();
      } else {
        const initialForm = initialFormRef.current;
        const staleEditDraft = initialForm.id
          && propertiesData.some((property) => property.id === initialForm.id);
        if (staleEditDraft) {
          const resetForm = freshForm();
          clearFormDraft(DRAFT_KEY);
          initialFormRef.current = resetForm;
          setFormBaseline(resetForm);
          setForm(resetForm);
          setValidationErrors({});
          setMessage('');
        }
      }
    });

    return () => {
      ignore = true;
    };
  }, [editRequest, onEditHandled]);

  useEffect(() => {
    function closeActionMenu(event) {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('.menu-wrap')) {
        setOpenMenuId(null);
      }
    }

    function closeActionMenuOnEscape(event) {
      if (event.key === 'Escape') {
        setOpenMenuId(null);
      }
    }

    document.addEventListener('pointerdown', closeActionMenu);
    document.addEventListener('keydown', closeActionMenuOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeActionMenu);
      document.removeEventListener('keydown', closeActionMenuOnEscape);
    };
  }, []);

  function getLog(propertyId) {
    return (
      propertyLogs.find((log) => log.propertyId === propertyId) || {
        prepared: 0,
        posted: 0,
        errors: 0,
        total: 0,
        lastEntry: null,
      }
    );
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updatePost(index, field, value) {
    setForm((prev) => {
      const posts = [...prev.posts];
      posts[index] = { ...posts[index], [field]: value };
      return { ...prev, posts };
    });
  }

  function handleEdit(property) {
    clearFormDraft(DRAFT_KEY);
    setEditingId(property.id);
    const editForm = {
      ...freshForm(),
      ...property,
      posts: property.posts?.length ? property.posts : freshForm().posts,
    };
    setFormBaseline(editForm);
    setForm(editForm);
    setValidationErrors({});
    setOpenMenuId(null);
    setMessage(`Editezi: ${property.name}`);
    scrollToEditor();
  }

  function handleCancelEdit() {
    const resetForm = freshForm();
    setEditingId(null);
    setFormBaseline(resetForm);
    setForm(resetForm);
    setValidationErrors({});
    setMessage('');
    clearFormDraft(DRAFT_KEY);
  }

  async function handleToggleActive(property) {
    const updatedProperty = { ...property, active: !property.active };

    await api.saveProperty(updatedProperty);
    await loadData();

    setOpenMenuId(null);
    setMessage(updatedProperty.active ? `${property.name} este activa.` : `${property.name} este inactiva.`);
  }

  async function handleResetHistory(property) {
    const ok = window.confirm(`Stergi istoricul pentru "${property.name}"?`);
    if (!ok) return;

    await api.clearPropertyHistory(property.id);
    await loadData();

    setOpenMenuId(null);
    setMessage(`History resetat pentru ${property.name}.`);
  }

  async function handleRunOnlyProperty(property) {
    const config = await api.getRuntimeConfig();

    await api.saveRuntimeConfig({
      ...config,
      selectedPropertyIds: [property.id],
    });

    setOpenMenuId(null);
    setPendingPropertyName(property.name);
    setStartModalOpen(true);
  }

  async function handleCloneProperty(property) {
    const clonedProperty = {
      ...property,
      id: `${property.id}_COPY_${Date.now()}`,
      name: `${property.name} - copie`,
      active: false,
    };

    await api.saveProperty(clonedProperty);
    await loadData();

    setOpenMenuId(null);
    setMessage(`Proprietate clonata: ${clonedProperty.name}.`);
  }

  function handleExportProperty(property) {
    const blob = new Blob([JSON.stringify(property, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${property.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setOpenMenuId(null);
  }

  async function handleDeleteProperty(property) {
    const ok = window.confirm(
      `Stergi definitiv proprietatea "${property.name}"?\n\nAceasta actiune nu poate fi anulata.`
    );

    if (!ok) return;

    await api.deleteProperty(property.id);
    await loadData();

    setOpenMenuId(null);
    setMessage(`Proprietatea ${property.name} a fost stearsa.`);
  }

  async function bulkSetActive(active) {
    const selected = properties.filter((property) => selectedIds.includes(property.id));
    await Promise.all(selected.map((property) => api.saveProperty({ ...property, active })));
    setSelectedIds([]);
    await loadData();
    notify(`${selected.length} proprietati au fost ${active ? 'activate' : 'dezactivate'}.`);
  }

  async function handleSave(nextAction = 'stay') {
    if (!form.name.trim()) {
      setValidationErrors({ name: true });
      setMessage('Adauga numele proprietatii.');
      window.setTimeout(() => document.querySelector('[data-validation-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
      return;
    }

    const nextId = form.id || generateIdFromName(form.name);
    if (!editingId && properties.some((property) => property.id === nextId)) {
      setValidationErrors({ id: true });
      setMessage(`Exista deja o proprietate cu ID-ul ${nextId}.`);
      return;
    }

    const invalidPost = form.posts.find((post) => post.active !== false && (!post.text?.trim() || !(post.media?.length || post.imagePath?.trim())));
    if (invalidPost) {
      setValidationErrors({ [`post-${invalidPost.day}`]: true });
      setMessage(`Ziua ${invalidPost.day}: adauga textul si cel putin un fisier media.`);
      window.setTimeout(() => document.querySelector('[data-validation-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
      return;
    }
    setValidationErrors({});

    const propertyToSave = {
      ...form,
      id: nextId,
      posts: form.posts.map((post, index) => ({ ...post, day: index + 1 })),
    };

    await api.saveProperty(propertyToSave);

    setMessage(
      editingId
        ? `Proprietatea ${propertyToSave.name} a fost actualizata.`
        : `Proprietatea ${propertyToSave.name} a fost salvata.`
    );
    notify(`Proprietatea ${propertyToSave.name} a fost salvata.`);

    setEditingId(null);
    clearFormDraft(DRAFT_KEY);
    setFormBaseline(freshForm());
    setForm(freshForm());
    await loadData();
    if (nextAction === 'queue') onChangePage?.('queue');
  }

  const filteredProperties = properties
    .filter((property) => `${property.name} ${property.id}`.toLowerCase().includes(search.toLowerCase()))
    .filter((property) => toolbarFilter === 'active' ? property.active : toolbarFilter === 'inactive' ? !property.active : true)
    .sort((a, b) => toolbarSort === 'recent' ? String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) : toolbarSort === 'active' ? Number(Boolean(b.active)) - Number(Boolean(a.active)) : a.name.localeCompare(b.name));

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Proprietati</h1>
          <p>Adauga, editeaza, activeaza si urmareste campaniile pe proprietati.</p>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cauta proprietate..."
        />
      </header>

      <section className="editor-panel" data-edit-target ref={editorRef}>
        <div className="panel-title-row">
          <h2>{editingId ? 'Editeaza proprietate' : 'Adauga proprietate'}</h2>
          {isDirty && <span className="draft-status">Draft salvat automat</span>}
        </div>

        <div className="form-grid">
          <label data-validation-error={validationErrors.id || undefined} className={validationErrors.id ? 'field-error' : ''}>
            ID proprietate
            <input
              value={form.id}
              onChange={(event) => updateField('id', event.target.value)}
              placeholder="ex: IANCULUI_001"
              disabled={Boolean(editingId)}
            />
          </label>

          <label data-validation-error={validationErrors.name || undefined} className={validationErrors.name ? 'field-error' : ''}>
            Nume proprietate
            <input
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              placeholder="ex: Spatiu comercial Iancului"
            />
          </label>

          <label>
            Tip tranzactie
            <select
              value={form.transactionType}
              onChange={(event) => updateField('transactionType', event.target.value)}
            >
              <option value="rent">Inchiriere</option>
              <option value="sale">Vanzare</option>
            </select>
          </label>

          <label>
            Profil Facebook postare
            <select
              value={form.facebookProfileId || ''}
              onChange={(event) => updateField('facebookProfileId', event.target.value)}
            >
              <option value="">Profil default din Queue</option>
              {facebookProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label || profile.id}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="posts-editor">
          {form.posts.map((post, index) => (
            <div className={`post-box ${validationErrors[`post-${post.day}`] ? 'field-error' : ''}`} data-validation-error={validationErrors[`post-${post.day}`] || undefined} key={`${post.day}-${index}`}>
              <h3>Ziua {post.day}</h3>

              <label>
                Titlu intern
                <input
                  value={post.title}
                  onChange={(event) => updatePost(index, 'title', event.target.value)}
                />
              </label>
              <FacebookPostPreview
                post={post}
                profileLabel={facebookProfiles.find((profile) => profile.id === form.facebookProfileId)?.label || 'Profil Facebook default'}
              />

              <label>
                Cale media
                <input
                  value={post.imagePath}
                  onChange={(event) => updatePost(index, 'imagePath', event.target.value)}
                  placeholder="C:\\Users\\admin\\Desktop\\folder\\cover1.jpg"
                />
              </label>

              <MediaDropzone
                entityId={form.id || generateIdFromName(form.name) || 'TEMP'}
                day={post.day}
                media={post.media || []}
                onChange={(paths) => {
                  updatePost(index, 'media', paths);
                  updatePost(index, 'imagePath', paths[0] || '');
                }}
              />

              <label>
                Text postare
                <textarea
                  ref={(node) => {
                    postTextareaRefs.current[index] = node;
                  }}
                  value={post.text}
                  onChange={(event) => updatePost(index, 'text', event.target.value)}
                  onPointerDown={(event) => {
                    activePostTextareaRef.current = event.currentTarget;
                  }}
                  rows={8}
                  style={postTextHeight ? { height: postTextHeight } : undefined}
                />
              </label>
            </div>
          ))}
        </div>

        <div className="button-row">
          <button className="primary-button" onClick={() => handleSave('stay')}>
            {editingId ? 'Actualizeaza proprietatea' : 'Salveaza proprietatea'}
          </button>
          <button className="secondary-button" onClick={() => handleSave('queue')}>
            Salveaza si mergi la Queue
          </button>

          {editingId && (
            <button className="secondary-button" onClick={handleCancelEdit}>
              Renunta la editare
            </button>
          )}
        </div>

        {message && <p className="save-message">{message}</p>}

        <ProfileStartModal
          open={startModalOpen}
          onClose={() => setStartModalOpen(false)}
          onConfirm={async (options) => {
            const result = await api.startRobot(options);
            setStartModalOpen(false);
            setMessage(result.robotStatus === 'running'
              ? `Robot pornit doar pentru ${pendingPropertyName}.`
              : result.lastMessage || 'Pornirea robotului a fost blocata.');
          }}
        />
      </section>

      <section className="entity-list">
        <div className="panel-title-row"><h2>Proprietati existente</h2>{selectedIds.length > 0 && <div className="button-row"><span className="muted-text">{selectedIds.length} selectate</span><button className="secondary-button small-button" onClick={() => bulkSetActive(true)}>Activeaza</button><button className="secondary-button small-button" onClick={() => bulkSetActive(false)}>Dezactiveaza</button><button className="ghost-button small-button" onClick={() => setSelectedIds([])}>Anuleaza</button></div>}</div>

        {filteredProperties.map((property) => {
          const log = getLog(property.id);
          const lastEntry = log.lastEntry;

          return (
            <article className="entity-card" key={property.id}>
              <label className="entity-select"><input type="checkbox" checked={selectedIds.includes(property.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, property.id] : current.filter((id) => id !== property.id))} /><span>Selecteaza</span></label>
              <div className="entity-main">
                <div>
                  <strong>{property.name}</strong>
                  <span>{property.id}</span>
                </div>

                <span>{property.transactionType === 'rent' ? 'Inchiriere' : 'Vanzare'}</span>

                <span className={property.active ? 'status-pill active' : 'status-pill inactive'}>
                  {property.active ? 'Activa' : 'Inactiva'}
                </span>

                <button
                  className={`secondary-button small-button details-toggle ${
                    openDetailsId === property.id ? 'active' : ''
                  }`}
                  onClick={() =>
                    setOpenDetailsId(openDetailsId === property.id ? null : property.id)
                  }
                >
                  {openDetailsId === property.id ? 'Ascunde detalii' : 'Detalii'}
                </button>

                <button
                  type="button"
                  className="secondary-button small-button property-preview-button"
                  onClick={() => setPreviewProperty(property)}
                >
                  Preview
                </button>

                <div className="menu-wrap">
                  <button
                    className="ghost-button menu-button"
                    onClick={() => setOpenMenuId(openMenuId === property.id ? null : property.id)}
                  >
                    More
                  </button>

                  {openMenuId === property.id && (
                    <div className="action-menu">
                      <button onClick={() => handleEdit(property)}>Editeaza</button>
                      <button onClick={() => handleToggleActive(property)}>
                        {property.active ? 'Dezactiveaza' : 'Activeaza'}
                      </button>
                      <button onClick={() => handleRunOnlyProperty(property)}>
                        Ruleaza doar aceasta proprietate
                      </button>
                      <button onClick={() => handleCloneProperty(property)}>Cloneaza</button>
                      <button onClick={() => handleExportProperty(property)}>Export JSON</button>
                      <button className="danger-link" onClick={() => handleResetHistory(property)}>
                        Reseteaza history
                      </button>
                      <button className="danger-link" onClick={() => handleDeleteProperty(property)}>
                        Sterge proprietatea
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {openDetailsId === property.id && (
                <div className="entity-details-dropdown">
                  <div className="metric-grid">
                    <div>
                      <span>Postari configurate</span>
                      <strong>{property.posts?.length || 0}</strong>
                    </div>
                    <div>
                      <span>Postate</span>
                      <strong>{log.posted}</strong>
                    </div>
                    <div>
                      <span>Pregatite</span>
                      <strong>{log.prepared}</strong>
                    </div>
                    <div>
                      <span>Erori</span>
                      <strong className={log.errors > 0 ? 'error-count' : ''}>{log.errors}</strong>
                    </div>
                    <div>
                      <span>Total actiuni</span>
                      <strong>{log.total}</strong>
                    </div>
                  </div>

                  <div className="last-action">
                    <span>Ultima actiune:</span>
                    <strong>
                      {lastEntry ? `${lastEntry.status} / ${lastEntry.groupName || '-'}` : 'Nicio actiune inca'}
                    </strong>
                  </div>
                </div>
              )}
            </article>
          );
        })}

        {filteredProperties.length === 0 && (
          <div className="empty-state-v2">Nu exista proprietati pentru cautarea curenta.</div>
        )}
      </section>

      {previewProperty && (
        <PropertyPreviewModal
          property={previewProperty}
          profileLabel={facebookProfiles.find((profile) => profile.id === previewProperty.facebookProfileId)?.label || 'Profil Facebook default'}
          onClose={() => setPreviewProperty(null)}
        />
      )}
    </div>
  );
}
