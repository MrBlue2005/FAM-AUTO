'use strict';
const crypto = require('crypto'); const fs = require('fs'); const fsp = fs.promises; const path = require('path'); const os = require('os');
const safe = (value) => /^[A-Za-z0-9_-]+$/.test(String(value || ''));
class TaskMediaMaterializer {
  constructor({ root = path.join(os.tmpdir(), 'rx-agent-media'), fetchImpl = fetch, retries = 1 } = {}) { this.root = path.resolve(root); this.fetch = fetchImpl; this.retries = retries; }
  async materialize(task, manifest) {
    if (!safe(task?.task_id) || !Array.isArray(manifest?.media)) throw Object.assign(new Error('Invalid task media manifest.'), { code: 'MEDIA_MANIFEST_INVALID' });
    const dir = path.resolve(this.root, task.task_id); if (!dir.startsWith(`${this.root}${path.sep}`)) throw Object.assign(new Error('Unsafe media task directory.'), { code: 'MEDIA_PATH_UNSAFE' }); await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const localMediaPaths = [];
    try { for (const item of [...manifest.media].sort((a, b) => a.ordinal - b.ordinal)) localMediaPaths.push(await this.download(dir, item)); return { localMediaPaths, cleanup: async () => fsp.rm(dir, { recursive: true, force: true }) }; }
    catch (error) { await fsp.rm(dir, { recursive: true, force: true }); throw error; }
  }
  async download(dir, item) {
    if (!safe(item?.media_id) || !Number.isInteger(item?.ordinal) || !/^[a-f0-9]{64}$/.test(item?.sha256 || '') || !Number.isInteger(item?.byte_size) || item.byte_size < 1 || typeof item.download_url !== 'string') throw Object.assign(new Error('Invalid immutable media item.'), { code: 'MEDIA_MANIFEST_INVALID' });
    const target = path.join(dir, `${String(item.ordinal).padStart(4, '0')}-${item.media_id}`); const partial = `${target}.partial`;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) { try { const response = await this.fetch(item.download_url); if (!response.ok || !response.body) throw Object.assign(new Error('Media download failed.'), { code: 'MEDIA_DOWNLOAD_FAILED' }); const out = fs.createWriteStream(partial, { flags: 'w', mode: 0o600 }); const digest = crypto.createHash('sha256'); let bytes = 0; for await (const chunk of response.body) { bytes += chunk.length; digest.update(chunk); if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve)); } await new Promise((resolve, reject) => out.end((error) => error ? reject(error) : resolve())); if (bytes !== item.byte_size) throw Object.assign(new Error('Media byte size mismatch.'), { code: 'MEDIA_SIZE_MISMATCH' }); if (digest.digest('hex') !== item.sha256) throw Object.assign(new Error('Media SHA-256 mismatch.'), { code: 'MEDIA_HASH_MISMATCH' }); await fsp.rename(partial, target); return target; } catch (error) { await fsp.rm(partial, { force: true }); if (attempt === this.retries || ['MEDIA_SIZE_MISMATCH', 'MEDIA_HASH_MISMATCH'].includes(error.code)) throw error; } }
  }
}
module.exports = { TaskMediaMaterializer };
