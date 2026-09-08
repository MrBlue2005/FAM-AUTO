'use strict';
const crypto = require('crypto');
const { ApplicationDataStore } = require('./ApplicationDataStore');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']);
const MAX_BYTES = 524288000;
class SupabaseApplicationDataStore extends ApplicationDataStore {
  constructor({ url = process.env.RX_APP_SUPABASE_URL, serviceRoleKey = process.env.RX_APP_SUPABASE_SERVICE_ROLE_KEY, fetchImpl = fetch } = {}) {
    super(); if (!url || !serviceRoleKey) throw new Error('RX_APP_SUPABASE_URL and RX_APP_SUPABASE_SERVICE_ROLE_KEY are required server-side.');
    this.url = url.replace(/\/$/, ''); this.key = serviceRoleKey; this.fetch = fetchImpl;
  }
  async request(path, options = {}) { const response = await this.fetch(`${this.url}${path}`, { ...options, headers: { apikey: this.key, authorization: `Bearer ${this.key}`, 'content-type': 'application/json', ...(options.headers || {}) } }); const body = await response.json().catch(() => null); if (!response.ok) throw Object.assign(new Error(body?.message || body?.error || `Supabase request failed (${response.status}).`), { status: response.status, code: body?.code }); return body; }
  async listCampaigns(kind) { return this.request(`/rest/v1/app_campaigns?select=*,app_campaign_posts(*)&kind=eq.${encodeURIComponent(kind)}&order=title.asc`); }
  async listPosts(campaignId) { return this.request(`/rest/v1/app_campaign_posts?campaign_id=eq.${campaignId}&order=day.asc`); }
  async listTargets() { return this.request('/rest/v1/app_targets?select=*&order=display_name.asc'); }
  async listCampaignFolders() { return this.request('/rest/v1/app_campaign_folders?select=*&order=name.asc'); }
  async listScheduleFolders() { return this.request('/rest/v1/app_schedule_folders?select=*&order=name.asc'); }
  async listSchedules() { return this.request('/rest/v1/app_schedules?select=*,app_schedule_campaigns(*)&order=name.asc'); }
  async getMedia(mediaId) { const rows = await this.request(`/rest/v1/app_media_objects?media_id=eq.${mediaId}&select=*,app_post_media(post_id)&limit=1`); return rows[0] || null; }
  async initiateMedia({ originalName, mimeType, byteSize, sha256, requestId }) {
    if (!ALLOWED_MIME.has(mimeType)) throw new Error('Unsupported media MIME type.'); if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > MAX_BYTES) throw new Error('Invalid media size.'); if (!/^[a-f0-9]{64}$/.test(sha256 || '')) throw new Error('A lowercase SHA-256 is required.');
    const mediaId = crypto.randomUUID(), safeName = String(originalName || 'media').replace(/[^A-Za-z0-9._-]/g, '_').slice(-160) || 'media'; const objectKey = `media/${mediaId}/${sha256}/${safeName}`;
    const inserted = await this.request('/rest/v1/app_media_objects', { method: 'POST', headers: { Prefer: 'return=representation', 'x-rx-request-id': requestId || crypto.randomUUID() }, body: JSON.stringify({ media_id: mediaId, bucket: 'fam-app-media', object_key: objectKey, sha256, byte_size: byteSize, mime_type: mimeType, original_name: safeName, state: 'STAGED' }) });
    const signed = await this.request(`/storage/v1/object/upload/sign/fam-app-media/${encodeURIComponent(objectKey).replace(/%2F/g, '/')}`, { method: 'POST', body: JSON.stringify({}) });
    return { media: inserted[0], upload: signed, expires_in: 120 };
  }
  async finalizeMedia({ mediaId, requestId }) { const media = await this.getMedia(mediaId); if (!media || media.state !== 'STAGED') throw new Error('Only staged media can be finalized.'); const signed = await this.request(`/storage/v1/object/sign/${media.bucket}/${encodeURIComponent(media.object_key).replace(/%2F/g, '/')}`, { method: 'POST', body: JSON.stringify({ expiresIn: 120 }), headers: { 'x-rx-request-id': requestId || crypto.randomUUID() } }); const updated = await this.request(`/rest/v1/app_media_objects?media_id=eq.${mediaId}&state=eq.STAGED`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ state: 'READY' }) }); if (!updated.length) throw new Error('Media finalization race detected.'); return { media: updated[0], verification_url: signed.signedURL || signed.signedUrl };
  }
  async createPreview(mediaId) { const media = await this.getMedia(mediaId); if (!media || media.state !== 'READY' || !media.app_post_media?.length) throw Object.assign(new Error('Media is not authorized for preview.'), { status: 404 }); return this.request(`/storage/v1/object/sign/${media.bucket}/${encodeURIComponent(media.object_key).replace(/%2F/g, '/')}`, { method: 'POST', body: JSON.stringify({ expiresIn: 120 }) }); }
}
module.exports = { SupabaseApplicationDataStore, ALLOWED_MIME, MAX_BYTES };
