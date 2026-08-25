import { useState } from 'react';
import { Eye, ThumbsUp, MessageCircle, Share2 } from 'lucide-react';
import { api } from '../services/api';

export default function FacebookPostPreview({
  post,
  profileLabel = 'Profil Facebook',
  open: controlledOpen,
  onOpenChange,
  hideToggle = false,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = typeof controlledOpen === 'boolean' ? controlledOpen : internalOpen;
  const media = post.media?.length ? post.media : post.imagePath ? [post.imagePath] : [];

  function togglePreview() {
    if (typeof controlledOpen === 'boolean') {
      onOpenChange?.(!controlledOpen);
      return;
    }
    setInternalOpen((value) => !value);
  }

  return (
    <div className="facebook-preview-wrap">
      {!hideToggle && (
        <button type="button" className="secondary-button preview-toggle" onClick={togglePreview}>
          <Eye size={15} /> {open ? 'Inchide preview' : 'Preview Facebook'}
        </button>
      )}
      {open && (
        <article className="facebook-post-preview">
          <header><span className="facebook-avatar">RX</span><p><strong>{profileLabel}</strong><small>Acum · Public</small></p></header>
          <div className="facebook-post-text">{post.text?.trim() || 'Textul postarii va aparea aici.'}</div>
          {media.length > 0 ? (
            <div className={`facebook-media-grid count-${Math.min(media.length, 4)}`}>
              {media.slice(0, 4).map((item, index) => {
                const source = api.getMediaUrl(item);
                const video = /\.(mp4|mov|quicktime)(?:$|\?)/i.test(item);
                return <div key={item}>{video ? <video src={source} muted /> : <img src={source} alt={`Media ${index + 1}`} />}{index === 3 && media.length > 4 && <span>+{media.length - 4}</span>}</div>;
              })}
            </div>
          ) : <div className="facebook-no-media">Fara media selectata</div>}
          <footer><span><ThumbsUp size={14} /> Imi place</span><span><MessageCircle size={14} /> Comenteaza</span><span><Share2 size={14} /> Distribuie</span></footer>
        </article>
      )}
    </div>
  );
}
