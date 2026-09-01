import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import MediaDropzone from '../components/MediaDropzone';
import FacebookPostPreview from '../components/FacebookPostPreview';
import CampaignPreviewDrawer from '../components/CampaignPreviewDrawer';
import { notify } from '../utils/notify';
import { clearFormDraft, loadFormDraft, saveFormDraft } from '../utils/formDraft';

const DRAFT_KEY = 'rx-job-form-draft';

const firstPost = {
  day: 1,
  title: 'Ziua 1',
  variant: 'A',
  active: true,
  published: false,
  imagePath: '',
  media: [],
  text: '',
};

const emptyJob = {
  id: '',
  title: '',
  company: 'ZONE Real Estate',
  active: true,
  facebookProfileId: '',
  posts: [firstPost],
};

function generateIdFromName(name) {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function createPost(day) {
  return {
    day,
    title: `Ziua ${day}`,
    variant: day <= 26 ? String.fromCharCode(64 + day) : String(day),
    active: true,
    published: false,
    imagePath: '',
    media: [],
    text: '',
  };
}

function freshJob() {
  return {
    ...emptyJob,
    posts: [{ ...firstPost }],
  };
}

export default function Jobs({ editRequest, onEditHandled, onDirtyChange, onChangePage }) {
  const [jobs, setJobs] = useState([]);
  const [form, setForm] = useState(() => loadFormDraft(DRAFT_KEY, freshJob));
  const [editingId, setEditingId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [previewJob, setPreviewJob] = useState(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [facebookProfiles, setFacebookProfiles] = useState([]);
  const [toolbarFilter, setToolbarFilter] = useState('all');
  const [toolbarSort, setToolbarSort] = useState('name');
  const [selectedIds, setSelectedIds] = useState([]);
  const [validationErrors, setValidationErrors] = useState({});
  const [formBaseline, setFormBaseline] = useState(freshJob);
  const editorRef = useRef(null);

  const isDirty = JSON.stringify(form) !== JSON.stringify(formBaseline);

  function scrollToEditor() {
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handleJobCardClick(event, job) {
    if (event.target.closest('button, input, label, a')) return;
    setPreviewJob(job);
  }

  useEffect(() => {
    saveFormDraft(DRAFT_KEY, form);
    onDirtyChange?.(isDirty);
  }, [form, isDirty, onDirtyChange]);

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
      if (event.detail?.page !== 'jobs') return;
      if (typeof event.detail.search === 'string') setSearch(event.detail.search);
      if (event.detail.filter) setToolbarFilter(event.detail.filter);
      if (event.detail.sort) setToolbarSort(event.detail.sort);
    };
    window.addEventListener('rx:toolbar', handleToolbar);
    return () => window.removeEventListener('rx:toolbar', handleToolbar);
  }, []);

  async function loadJobs() {
    const [data, config] = await Promise.all([api.getJobs(), api.getRuntimeConfig()]);
    setJobs(data);
    setFacebookProfiles(config.facebookProfiles || []);
  }

  useEffect(() => {
    let ignore = false;

    Promise.all([api.getJobs(), api.getRuntimeConfig()]).then(([data, config]) => {
      if (ignore) return;

      setJobs(data);
      setFacebookProfiles(config.facebookProfiles || []);

      const requestedId = editRequest?.id || window.localStorage.getItem('rx-edit-job-id');
      const requestedJob = data.find((item) => item.id === requestedId);

      if (requestedJob) {
        window.localStorage.removeItem('rx-edit-job-id');
        onEditHandled?.();
        setEditingId(requestedJob.id);
        const requestedForm = {
          ...freshJob(),
          ...requestedJob,
          posts: requestedJob.posts?.length ? requestedJob.posts : [{ ...firstPost }],
        };
        setFormBaseline(requestedForm);
        setForm(requestedForm);
        setOpenMenuId(null);
        setMessage(`Editezi: ${requestedJob.title}`);
        scrollToEditor();
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

  function addPostDay() {
    setForm((prev) => {
      const nextDay = prev.posts.length + 1;
      return { ...prev, posts: [...prev.posts, createPost(nextDay)] };
    });
  }

  function updatePostCount(value) {
    const requestedCount = Math.max(Number(value) || 1, 1);

    setForm((prev) => {
      const posts = Array.from({ length: requestedCount }, (_, index) => {
        const existingPost = prev.posts[index];
        return existingPost ? { ...existingPost, day: index + 1 } : createPost(index + 1);
      });

      return { ...prev, posts };
    });
  }

  function deletePostDay(index) {
    setForm((prev) => {
      if (prev.posts.length === 1) {
        setMessage('Campania trebuie sa aiba cel putin o zi.');
        return prev;
      }

      const posts = prev.posts
        .filter((_, postIndex) => postIndex !== index)
        .map((post, postIndex) => ({
          ...post,
          day: postIndex + 1,
          title: post.title || `Ziua ${postIndex + 1}`,
        }));

      return { ...prev, posts };
    });
  }

  function clonePostDay(index) {
    setForm((prev) => {
      const source = prev.posts[index];
      const nextDay = prev.posts.length + 1;

      return {
        ...prev,
        posts: [
          ...prev.posts,
          {
            ...source,
            day: nextDay,
            title: `${source.title || `Ziua ${source.day}`} - copie`,
            published: false,
          },
        ],
      };
    });
  }

  function handleEdit(job) {
    setEditingId(job.id);
    const editForm = {
      ...freshJob(),
      ...job,
      posts: job.posts?.length ? job.posts : [{ ...firstPost }],
    };
    setFormBaseline(editForm);
    setForm(editForm);
    setOpenMenuId(null);
    setMessage(`Editezi: ${job.title}`);
    scrollToEditor();
  }

  function handleCancelEdit() {
    setEditingId(null);
    setFormBaseline(freshJob());
    setForm(freshJob());
    setMessage('');
    clearFormDraft(DRAFT_KEY);
  }

  async function handleToggleActive(job) {
    const updatedJob = { ...job, active: !job.active };

    await api.saveJob(updatedJob);
    await loadJobs();

    setOpenMenuId(null);
    setMessage(updatedJob.active ? 'Job activat.' : 'Job dezactivat.');
  }

  async function handleCloneJob(job) {
    const clonedJob = {
      ...job,
      id: `${job.id}_COPY_${Date.now()}`,
      title: `${job.title} - copie`,
      active: false,
    };

    await api.saveJob(clonedJob);
    await loadJobs();

    setOpenMenuId(null);
    setMessage(`Job clonat: ${clonedJob.title}`);
  }

  function handleExportJob(job) {
    const blob = new Blob([JSON.stringify(job, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${job.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setOpenMenuId(null);
  }

  async function handleDeleteJob(job) {
    const ok = window.confirm(
      `Stergi definitiv jobul "${job.title}"?\n\nAceasta actiune nu poate fi anulata.`
    );

    if (!ok) return;

    await api.deleteJob(job.id);
    await loadJobs();

    setOpenMenuId(null);
    setMessage(`Job sters: ${job.title}`);
  }

  async function handleResetHistory(job) {
    const ok = window.confirm(`Stergi history pentru jobul "${job.title}"?`);
    if (!ok) return;

    await api.clearPropertyHistory(job.id);
    await loadJobs();

    setOpenMenuId(null);
    setMessage(`History resetat pentru ${job.title}.`);
  }

  async function bulkSetActive(active) {
    const selected = jobs.filter((job) => selectedIds.includes(job.id));
    await Promise.all(selected.map((job) => api.saveJob({ ...job, active })));
    setSelectedIds([]);
    await loadJobs();
    notify(`${selected.length} joburi au fost ${active ? 'activate' : 'dezactivate'}.`);
  }

  async function handleSave(nextAction = 'stay') {
    if (!form.title.trim()) {
      setValidationErrors({ title: true });
      setMessage('Adauga titlul jobului.');
      window.setTimeout(() => document.querySelector('[data-validation-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
      return;
    }

    const nextId = form.id || generateIdFromName(form.title);
    if (!editingId && jobs.some((job) => job.id === nextId)) {
      setValidationErrors({ id: true });
      setMessage(`Exista deja un job cu ID-ul ${nextId}.`);
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

    const jobToSave = {
      ...form,
      id: nextId,
      transactionType: 'job',
      campaignCategory: 'jobs',
      posts: form.posts.map((post, index) => ({ ...post, day: index + 1 })),
    };

    await api.saveJob(jobToSave);

    setMessage(
      editingId
        ? `Jobul ${jobToSave.title} a fost actualizat.`
        : `Jobul ${jobToSave.title} a fost salvat.`
    );
    notify(`Jobul ${jobToSave.title} a fost salvat.`);

    setEditingId(null);
    clearFormDraft(DRAFT_KEY);
    setFormBaseline(freshJob());
    setForm(freshJob());
    await loadJobs();
    if (nextAction === 'queue') onChangePage?.('queue');
  }

  const filteredJobs = jobs
    .filter((job) => `${job.title} ${job.id} ${job.company || ''}`.toLowerCase().includes(search.toLowerCase()))
    .filter((job) => toolbarFilter === 'active' ? job.active : toolbarFilter === 'inactive' ? !job.active : true)
    .sort((a, b) => toolbarSort === 'recent' ? String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) : toolbarSort === 'active' ? Number(Boolean(b.active)) - Number(Boolean(a.active)) : a.title.localeCompare(b.title));

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Joburi</h1>
          <p>Adauga, editeaza si pregateste postari pentru campanii de recrutare.</p>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cauta job..."
        />
      </header>

      <section className="editor-panel" data-edit-target ref={editorRef}>
        <div className="panel-title-row">
          <h2>{editingId ? 'Editeaza job' : 'Adauga job'}</h2>
          <div className="button-row">
            {isDirty && <span className="draft-status">Draft salvat automat</span>}
            <button className="primary-button" onClick={addPostDay}>
              + Adauga zi
            </button>
          </div>
        </div>

        <div className="form-grid">
          <label data-validation-error={validationErrors.id || undefined} className={validationErrors.id ? 'field-error' : ''}>
            ID job
            <input
              value={form.id}
              onChange={(event) => updateField('id', event.target.value)}
              placeholder="ex: AGENT_IMOBILIAR_001"
              disabled={Boolean(editingId)}
            />
          </label>

          <label data-validation-error={validationErrors.title || undefined} className={validationErrors.title ? 'field-error' : ''}>
            Titlu job
            <input
              value={form.title}
              onChange={(event) => updateField('title', event.target.value)}
              placeholder="ex: Angajam agent imobiliar"
            />
          </label>

          <label>
            Companie
            <input
              value={form.company}
              onChange={(event) => updateField('company', event.target.value)}
            />
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

          <label>
            Numar zile postari
            <input
              type="number"
              min="1"
              value={form.posts.length}
              onChange={(event) => updatePostCount(event.target.value)}
            />
          </label>
        </div>

        <div className="posts-editor">
          {form.posts.map((post, index) => (
            <div className={`post-box ${validationErrors[`post-${post.day}`] ? 'field-error' : ''}`} data-validation-error={validationErrors[`post-${post.day}`] || undefined} key={`${post.day}-${index}`}>
              <div className="panel-title-row compact">
                <h3>Ziua {post.day}</h3>
                <div className="button-row">
                  <button className="secondary-button small-button" onClick={() => clonePostDay(index)}>
                    Cloneaza
                  </button>
                  <button className="danger-button small-button" onClick={() => deletePostDay(index)}>
                    Sterge
                  </button>
                </div>
              </div>

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
                  placeholder="C:\\Users\\admin\\Desktop\\jobs\\cover1.jpg"
                />
              </label>

              <MediaDropzone
                entityId={form.id || generateIdFromName(form.title) || 'TEMP_JOB'}
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
                  value={post.text}
                  onChange={(event) => updatePost(index, 'text', event.target.value)}
                  rows={8}
                  placeholder="Textul complet al postarii de recrutare..."
                />
              </label>
            </div>
          ))}
        </div>

        <div className="button-row">
          <button className="primary-button" onClick={() => handleSave('stay')}>
            {editingId ? 'Actualizeaza job' : 'Salveaza job'}
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
      </section>

      <section className="entity-list">
        <div className="panel-title-row"><h2>Joburi existente</h2>{selectedIds.length > 0 && <div className="button-row"><span className="muted-text">{selectedIds.length} selectate</span><button className="secondary-button small-button" onClick={() => bulkSetActive(true)}>Activeaza</button><button className="secondary-button small-button" onClick={() => bulkSetActive(false)}>Dezactiveaza</button><button className="ghost-button small-button" onClick={() => setSelectedIds([])}>Anuleaza</button></div>}</div>

        {filteredJobs.map((job) => (
          <article
            className="entity-card property-preview-card"
            key={job.id}
            onClick={(event) => handleJobCardClick(event, job)}
          >
            <label className="entity-select"><input type="checkbox" checked={selectedIds.includes(job.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, job.id] : current.filter((id) => id !== job.id))} /><span>Selecteaza</span></label>
            <div className="entity-main">
              <div>
                <strong>{job.title}</strong>
                <span>{job.id}</span>
              </div>

              <span>{job.company || '-'}</span>

              <span className={job.active ? 'status-pill active' : 'status-pill inactive'}>
                {job.active ? 'Activ' : 'Inactiv'}
              </span>

              <span>{job.posts?.length || 0} postari</span>

              <button
                type="button"
                className="secondary-button small-button property-preview-button"
                onClick={() => setPreviewJob(job)}
              >
                Preview
              </button>

              <div className="menu-wrap">
                <button
                  className="ghost-button menu-button"
                  onClick={() => setOpenMenuId(openMenuId === job.id ? null : job.id)}
                >
                  More
                </button>

                {openMenuId === job.id && (
                  <div className="action-menu">
                    <button onClick={() => handleEdit(job)}>Editeaza</button>
                    <button onClick={() => handleToggleActive(job)}>
                      {job.active ? 'Dezactiveaza' : 'Activeaza'}
                    </button>
                    <button onClick={() => handleCloneJob(job)}>Cloneaza</button>
                    <button onClick={() => handleExportJob(job)}>Export JSON</button>
                    <button className="danger-link" onClick={() => handleResetHistory(job)}>
                      Reseteaza history
                    </button>
                    <button className="danger-link" onClick={() => handleDeleteJob(job)}>
                      Sterge jobul
                    </button>
                  </div>
                )}
              </div>
            </div>
          </article>
        ))}

        {filteredJobs.length === 0 && (
          <div className="empty-state-v2">Nu exista joburi pentru cautarea curenta.</div>
        )}
      </section>

      {previewJob && (
        <CampaignPreviewDrawer
          campaign={previewJob}
          fallbackPosts={[firstPost]}
          profileLabel={facebookProfiles.find((profile) => profile.id === previewJob.facebookProfileId)?.label || 'Profil Facebook default'}
          onClose={() => setPreviewJob(null)}
        />
      )}
    </div>
  );
}
