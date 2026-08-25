import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, GripVertical, ImagePlus, LoaderCircle, Star, Trash2, UploadCloud, X } from 'lucide-react';
import { api } from '../services/api';

const ACCEPTED_TYPES = ['video/mp4', 'video/quicktime'];
const MAX_FILES = 10;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

function isAccepted(file) {
  return file.type.startsWith('image/') || ACCEPTED_TYPES.includes(file.type);
}

function isVideo(reference) {
  return /\.(mp4|mov|quicktime)(?:$|\?)/i.test(reference);
}

export default function MediaDropzone({ entityId, day, media = [], onChange }) {
  const inputRef = useRef(null);
  const uploadControllerRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryMedia, setLibraryMedia] = useState([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [progress, setProgress] = useState(0);

  async function upload(filesLike) {
    const files = Array.from(filesLike || []);
    if (!files.length) return;

    if (media.length + files.length > MAX_FILES) {
      setError(`Poti adauga maximum ${MAX_FILES} fisiere pentru o zi.`);
      return;
    }

    const invalidFile = files.find((file) => !isAccepted(file) || file.size > MAX_FILE_SIZE);
    if (invalidFile) {
      setError(`Fisier neacceptat sau mai mare de 100 MB: ${invalidFile.name}`);
      return;
    }

    setUploading(true);
    setProgress(0);
    uploadControllerRef.current = new AbortController();
    setError('');
    try {
      const result = await api.uploadMedia({ propertyId: entityId, day, files, onProgress: setProgress, signal: uploadControllerRef.current.signal });
      const uploaded = result.files.map((file) => file.path);
      onChange([...new Set([...media, ...uploaded])]);
      if (result.files.some((file) => file.duplicate)) setError('Un fisier identic exista deja. A fost reutilizata copia existenta.');
    } catch (uploadError) {
      setError(uploadError.name === 'AbortError' ? 'Upload anulat.' : uploadError.message || 'Media nu a putut fi incarcata.');
    } finally {
      setUploading(false);
      uploadControllerRef.current = null;
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    upload(event.dataTransfer.files);
  }

  function removeMedia(item) {
    onChange(media.filter((reference) => reference !== item));
  }

  function moveMedia(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex === null) return;
    const next = [...media];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  }

  function setCover(item) {
    onChange([item, ...media.filter((reference) => reference !== item)]);
  }

  async function openLibrary() {
    setLibraryOpen(true);
    setError('');
    try {
      setLibraryMedia(await api.getMedia());
    } catch {
      setError('Biblioteca media nu a putut fi incarcata.');
    }
  }

  function addFromLibrary(item) {
    const reference = item.path;
    if (!media.includes(reference)) onChange([...media, reference]);
  }

  return (
    <div className="media-uploader">
      <input
        ref={inputRef}
        className="media-dropzone-input"
        type="file"
        multiple
        accept="image/*,video/mp4,video/quicktime"
        onChange={(event) => upload(event.target.files)}
      />

      <button
        type="button"
        className={`media-dropzone ${dragActive ? 'drag-active' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
        onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
        onDrop={handleDrop}
        disabled={uploading}
      >
        {uploading ? <LoaderCircle className="spin" size={25} /> : <UploadCloud size={25} />}
        <strong>{uploading ? 'Se incarca...' : 'Trage media aici'}</strong>
        <span>sau apasa pentru selectare · imagini / MP4 / MOV · max. 100 MB</span>
      </button>
      {uploading && <div className="media-upload-progress"><div><span style={{ width: `${progress}%` }} /></div><strong>{progress}%</strong><button type="button" onClick={() => uploadControllerRef.current?.abort()}>Anuleaza</button></div>}
      <button type="button" className="secondary-button media-library-trigger" onClick={openLibrary}>
        <FolderOpen size={15} /> Alege din Media Library
      </button>

      {error && <p className="media-upload-error" role="alert">{error}</p>}

      {media.length > 0 && (
        <div className="media-preview-grid">
          {media.map((item, index) => {
            const source = api.getMediaUrl(item);
            return (
              <div
                className={`media-preview-item ${index === 0 ? 'is-cover' : ''}`}
                key={item}
                draggable
                onDragStart={() => setDraggedIndex(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  moveMedia(draggedIndex, index);
                  setDraggedIndex(null);
                }}
                onDragEnd={() => setDraggedIndex(null)}
              >
                <span className="media-drag-handle" title="Trage pentru reordonare"><GripVertical size={14} /></span>
                {index === 0 && <span className="media-cover-badge"><Star size={11} /> Coperta</span>}
                {source && isVideo(item) ? (
                  <video src={source} muted preload="metadata" />
                ) : source ? (
                  <img src={source} alt="Previzualizare media" />
                ) : (
                  <span className="media-file-fallback"><ImagePlus size={22} /></span>
                )}
                <button className="media-remove-button" type="button" onClick={() => removeMedia(item)} aria-label="Elimina fisierul">
                  <Trash2 size={14} />
                </button>
                {index > 0 && (
                  <button className="media-cover-button" type="button" onClick={() => setCover(item)}>
                    Seteaza coperta
                  </button>
                )}
                <small title={item}>{item.split(/[\\/]/).pop()}</small>
              </div>
            );
          })}
        </div>
      )}
      {libraryOpen && createPortal(
        <div className="media-library-backdrop" role="presentation" onMouseDown={() => setLibraryOpen(false)}>
          <section className="media-library-picker" role="dialog" aria-modal="true" aria-label="Media Library" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><h3>Media Library</h3><p>Reutilizeaza un fisier deja incarcat.</p></div><button type="button" onClick={() => setLibraryOpen(false)} aria-label="Inchide"><X size={18} /></button></header>
            <input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Cauta fisier sau campanie..." autoFocus />
            <div className="media-library-results">
              {libraryMedia.filter((item) => `${item.name} ${item.propertyId}`.toLowerCase().includes(librarySearch.toLowerCase())).slice(0, 80).map((item) => (
                <button type="button" key={item.path} className={media.includes(item.path) ? 'selected' : ''} onClick={() => addFromLibrary(item)}>
                  {item.type === 'video' ? <video src={api.getMediaUrl(item.path)} muted /> : <img src={api.getMediaUrl(item.path)} alt="" />}
                  <span><strong>{item.name}</strong><small>{item.propertyId} · Ziua {item.day}</small></span>
                </button>
              ))}
            </div>
          </section>
        </div>
        ,
        document.body
      )}
    </div>
  );
}
