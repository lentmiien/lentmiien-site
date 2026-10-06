const path = require('path');
const fs = require('fs/promises');
const { createHash, randomUUID } = require('crypto');

const VERSION = 2;
const EXTENSIONS = /\.(png|apng|jpe?g|jfif|pjpeg|pjp|bmp|webp|tiff?|gif|mp4|mov|mkv|webm|m4v)$/i;
function invalid() { return Object.assign(new Error('Invalid ComfyUI output identity'), { code: 'COMFY_OUTPUT_INVALID_IDENTITY' }); }
function identifier(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw invalid();
  return value;
}
function descriptor(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw invalid();
  const filename = output.filename;
  if (typeof filename !== 'string' || filename.length > 255 || /[\\/:%\x00-\x1f\x7f]/.test(filename)
    || !EXTENSIONS.test(filename) || filename.trim() !== filename) throw invalid();
  const subfolder = output.subfolder ?? '';
  if (typeof subfolder !== 'string' || subfolder.length > 1024 || /[\\:%\x00-\x1f\x7f]/.test(subfolder)
    || (subfolder && subfolder.split('/').some(part => !part || part === '.' || part === '..' || part.trim() !== part))) throw invalid();
  const type = output.type ?? 'output';
  if (!['output', 'temp', 'input'].includes(type)) throw invalid();
  if (output.node_id != null && !['string', 'number'].includes(typeof output.node_id)) throw invalid();
  const nodeId = output.node_id == null ? null : identifier(String(output.node_id));
  return { filename, subfolder, type, node_id: nodeId };
}

class ComfyOutputCacheService {
  constructor({ provider, directory, fetchImage }) {
    // Never include credentials/query strings in cache identity or diagnostic data.
    const url = new URL(provider);
    this.provider = `${url.origin}${url.pathname.replace(/\/$/, '')}`;
    this.directory = path.resolve(directory);
    this.fetchImage = fetchImage;
    this.inFlight = new Map();
    this.active = 0;
    this.queue = [];
  }

  async slot(work) {
    if (this.active >= 5) {
      if (this.queue.length >= 32) throw new Error('ComfyUI output cache busy; retry');
      await new Promise(resolve => this.queue.push(resolve));
    } else {
      this.active += 1;
    }
    try { return await work(); } finally {
      const next = this.queue.shift();
      if (next) next(); else this.active -= 1;
    }
  }

  record(jobId, output, index, instanceId = null) {
    identifier(jobId);
    if (instanceId !== null) identifier(instanceId);
    if (!Number.isSafeInteger(index) || index < 0 || index >= 10000) throw invalid();
    const remote = descriptor(output);
    const key = createHash('sha256').update(JSON.stringify([
      VERSION, this.provider, instanceId, jobId, index, remote.node_id,
      remote.filename, remote.subfolder, remote.type,
    ])).digest('hex');
    const video = /\.(mp4|mov|mkv|webm|m4v)$/i.test(remote.filename);
    const cacheName = `comfy-v${VERSION}-${key}${path.extname(remote.filename).toLowerCase()}`;
    const root = this.directory;
    return { ...remote, index, cache_version: VERSION, cache_key: key, cache_name: cacheName,
      bucket: video ? 'video' : 'output', instance_id: instanceId,
      localPath: path.join(root, cacheName),
      url: `/image_gen/api/jobs/${encodeURIComponent(jobId)}/files/${index}?cache_key=${key}${instanceId ? `&instance_id=${encodeURIComponent(instanceId)}` : ''}` };
  }

  verifiedRecord(jobId, output, instanceId = null) {
    try {
      const rec = this.record(jobId, output, output?.index, instanceId);
      return output.cache_version === VERSION && output.cache_key === rec.cache_key ? rec : null;
    } catch (_) { return null; }
  }

  async exists(rec) {
    const root = path.dirname(rec.localPath);
    // Fixed configured roots and generated filenames only; reject symlink sources.
    try {
      if (await fs.realpath(root) !== root) throw invalid();
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    try {
      const stat = await fs.lstat(rec.localPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size <= 0) throw invalid();
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async ensure(jobId, output, index, instanceId = null) {
    const rec = this.record(jobId, output, index, instanceId);
    if (this.inFlight.has(rec.cache_key)) return this.inFlight.get(rec.cache_key);
    const pending = this.slot(async () => {
      if (await this.exists(rec)) return rec;
      // The validated descriptor is authoritative. A stale/mismatched view URL
      // must never select different bytes under this identity.
      const { buffer } = await this.fetchImage({ filename: rec.filename, subfolder: rec.subfolder, type: rec.type });
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Empty ComfyUI output');
      // Check the existing ancestor before recursive creation as well as the root.
      let ancestor = this.directory;
      while (true) {
        try {
          if (await fs.realpath(ancestor) !== ancestor) throw invalid();
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          ancestor = path.dirname(ancestor);
        }
      }
      await fs.mkdir(this.directory, { recursive: true });
      if (await fs.realpath(this.directory) !== this.directory) throw invalid();
      const temporary = `${rec.localPath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, buffer, { flag: 'wx' });
        // Atomic, no overwrite even across processes. Readers never see partial bytes.
        try { await fs.link(temporary, rec.localPath); } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
      } finally {
        await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      }
      if (!await this.exists(rec)) throw new Error('ComfyUI output cache unavailable');
      return rec;
    });
    this.inFlight.set(rec.cache_key, pending);
    try { return await pending; } finally { this.inFlight.delete(rec.cache_key); }
  }
}

module.exports = { ComfyOutputCacheService, descriptor, VERSION };
