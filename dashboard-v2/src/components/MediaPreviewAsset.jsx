import { useEffect, useState } from 'react';
import { api } from '../services/api';

function isVideo(item) {
  return item?.type === 'video' || /\.(mp4|mov|quicktime)(?:$|\?)/i.test(typeof item === 'string' ? item : item?.name || item?.path || '');
}

export default function MediaPreviewAsset({ item, alt = '', className, muted = true, preload = 'metadata', onError, fallback = null }) {
  const [source, setSource] = useState('');
  const [failedItem, setFailedItem] = useState(null);
  const [refreshes, setRefreshes] = useState(0);
  const mediaId = typeof item === 'object' ? item?.mediaId || item?.id : null;
  const itemKey = mediaId || item;
  const failed = failedItem === itemKey;

  useEffect(() => {
    let cancelled = false;
    api.getMediaPreviewUrl(item).then((url) => { if (!cancelled) { setSource(url); setFailedItem(null); } }).catch(() => { if (!cancelled) setSource(''); });
    return () => { cancelled = true; };
  }, [item, refreshes]);

  function handleError(event) {
    if (api.isCloudReadOnly() && mediaId && refreshes === 0) {
      api.refreshMediaPreviewUrl(mediaId).then((url) => { setSource(url); setRefreshes(1); }).catch(() => setFailedItem(itemKey));
      return;
    }
    setFailedItem(itemKey); onError?.(event);
  }

  if (!source || failed) return fallback;
  return isVideo(item)
    ? <video className={className} src={source} muted={muted} preload={preload} aria-label={alt} onError={handleError} />
    : <img className={className} src={source} alt={alt} loading="lazy" onError={handleError} />;
}
