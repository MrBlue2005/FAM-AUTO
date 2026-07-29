import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { Sparkles, Trash2 } from 'lucide-react';
import { notify } from '../utils/notify';

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function MediaThumbnail({ item }) {
  const [failed, setFailed] = useState(false);
  const source = api.getMediaUrl(item.path);
  const label = item.type === 'video' ? 'VIDEO' : 'IMG';

  if (!source || failed) {
    return <span className="media-thumb-fallback">{label}</span>;
  }

  if (item.type === 'video') {
    return (
      <video
        src={source}
        muted
        preload="metadata"
        aria-label={`Preview ${item.name}`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <img
      src={source}
      alt={`Preview ${item.name}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export default function Media() {
  const [media, setMedia] = useState([]);
  const [properties, setProperties] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [usageFilter, setUsageFilter] = useState('all');

  useEffect(() => {
    let ignore = false;

    Promise.all([api.getMedia(), api.getProperties(), api.getJobs()]).then(
      ([mediaData, propertiesData, jobsData]) => {
        if (ignore) return;
        setMedia(mediaData);
        setProperties(propertiesData);
        setJobs(jobsData);
      }
    );

    return () => {
      ignore = true;
    };
  }, []);

  const campaignMap = useMemo(() => {
    const map = new Map();
    properties.forEach((item) => map.set(item.id, item.name));
    jobs.forEach((item) => map.set(item.id, item.title));
    return map;
  }, [properties, jobs]);

  const campaigns = useMemo(
    () =>
      Array.from(new Set(media.map((item) => item.propertyId))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [media]
  );

  const filteredMedia = media.filter((item) => {
    const text = `${item.name} ${item.propertyId} ${item.relativePath}`.toLowerCase();
    if (!text.includes(search.toLowerCase())) return false;
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (campaignFilter !== 'all' && item.propertyId !== campaignFilter) return false;
    if (usageFilter === 'unused' && item.used) return false;
    if (usageFilter === 'used' && !item.used) return false;
    if (usageFilter === 'duplicates' && !item.duplicate) return false;
    return true;
  });

  const imageCount = media.filter((item) => item.type === 'image').length;
  const videoCount = media.filter((item) => item.type === 'video').length;
  const totalSize = media.reduce((sum, item) => sum + (item.size || 0), 0);
  const unusedCount = media.filter((item) => !item.used).length;

  async function deleteMedia(item) {
    if (!window.confirm(`Stergi definitiv fisierul "${item.name}"?\n\nStergerea este permisa doar daca nu este folosit intr-o campanie.`)) return;
    try {
      await api.deleteMedia(item.path);
      setMedia((current) => current.filter((entry) => entry.path !== item.path));
      notify(`Fisier sters: ${item.name}`);
    } catch (error) {
      notify(error.message || 'Fisierul nu a putut fi sters.', 'error');
    }
  }

  async function cleanupUnused() {
    if (!unusedCount || !window.confirm(`Stergi definitiv toate cele ${unusedCount} fisiere nefolosite? Aceasta actiune nu poate fi anulata.`)) return;
    const result = await api.cleanupUnusedMedia();
    setMedia((current) => current.filter((item) => item.used));
    notify(`Au fost sterse ${result.deleted} fisiere si eliberati ${formatSize(result.freedBytes)}.`);
  }

  return (
    <div className="management-page">
      <header className="management-header">
        <div>
          <h1>Media Library</h1>
          <p>Biblioteca fisierelor incarcate pentru proprietati si joburi.</p>
        </div>

        <div className="button-row"><button className="danger-button" disabled={!unusedCount} onClick={cleanupUnused}><Sparkles size={15} /> Curata nefolosite ({unusedCount})</button><button className="secondary-button" onClick={() => window.location.reload()}>Refresh</button></div>
      </header>

      <section className="summary-grid media-summary">
        <div>Total fisiere: <strong>{media.length}</strong></div>
        <div>Imagini: <strong>{imageCount}</strong></div>
        <div>Video: <strong>{videoCount}</strong></div>
        <div>Spatiu: <strong>{formatSize(totalSize)}</strong></div>
      </section>

      <section className="filter-grid">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cauta fisier, campanie sau path..."
        />

        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="all">Toate tipurile</option>
          <option value="image">Imagini</option>
          <option value="video">Video</option>
        </select>

        <select
          value={campaignFilter}
          onChange={(event) => setCampaignFilter(event.target.value)}
        >
          <option value="all">Toate campaniile</option>
          {campaigns.map((campaignId) => (
            <option key={campaignId} value={campaignId}>
              {campaignMap.get(campaignId) || campaignId}
            </option>
          ))}
        </select>
        <select value={usageFilter} onChange={(event) => setUsageFilter(event.target.value)}><option value="all">Toate utilizarile</option><option value="used">Folosite</option><option value="unused">Nefolosite</option><option value="duplicates">Duplicate</option></select>
      </section>

      <section className="media-grid-v2">
        {filteredMedia.map((item) => (
          <article className="media-card-v2" key={item.path}>
            <div className={`media-thumb ${item.type}`}>
              <MediaThumbnail item={item} />
              <span className="media-type-badge">
                {item.type === 'video' ? 'VIDEO' : 'IMG'}
              </span>
            </div>

            <div className="media-card-body">
              <strong>{item.name}</strong>
              <span>{campaignMap.get(item.propertyId) || item.propertyId}</span>
              <span>Ziua {item.day}</span>
              <span>{formatSize(item.size)} / {formatDate(item.updatedAt)}</span>
              <code>{item.relativePath}</code>
              <div className="media-flags"><span className={item.used ? 'used' : 'unused'}>{item.used ? 'Folosita' : 'Nefolosita'}</span>{item.duplicate && <span className="duplicate">Duplicat</span>}<small title={item.hash}>SHA {item.hash?.slice(0, 10)}</small></div>
            </div>
            <button className="media-delete-button" onClick={() => deleteMedia(item)} title="Sterge definitiv"><Trash2 size={15} /></button>
          </article>
        ))}

        {filteredMedia.length === 0 && (
          <div className="empty-state-v2">Nu exista fisiere media pentru filtrele curente.</div>
        )}
      </section>
    </div>
  );
}
