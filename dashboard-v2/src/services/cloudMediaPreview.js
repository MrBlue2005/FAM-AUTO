const MIN_TTL_MS = 1000;

export function createEphemeralPreviewCache({ requestPreview, now = () => Date.now() }) {
  const entries = new Map();
  return {
    async resolve(mediaId) {
      const id = String(mediaId || '');
      if (!id) return '';
      const cached = entries.get(id);
      if (cached && cached.expiresAt > now() + MIN_TTL_MS) return cached.url;
      const preview = await requestPreview(id);
      if (typeof preview?.url !== 'string' || !preview.url) throw new Error('Previzualizarea media nu a putut fi autorizata.');
      const expiresIn = Math.max(1, Math.min(120, Number(preview.expiresIn) || 120));
      entries.set(id, { url: preview.url, expiresAt: now() + expiresIn * 1000 });
      return preview.url;
    },
    invalidate(mediaId) { entries.delete(String(mediaId || '')); },
    clear() { entries.clear(); },
  };
}
