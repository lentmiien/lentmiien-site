const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const { assertNoSymlinks, assertTrustedStorage, within } = require('../gptImageStorageService');
const logger = require('../../utils/logger');
const { ID, LIMITS, fail, sessionSchema } = require('./policy');

function storageRoot() { return path.resolve(__dirname, '../../private_data/experimental-models'); }
const extension = asset => ({ 'image/png': 'png', 'application/json': 'json', 'audio/wav': 'wav' })[asset.mime];
// One process owns the store. Leases prevent removal during requests and streams.
class LabStore {
  constructor({ root = storageRoot(), now = Date.now, limits = LIMITS, appLogger = logger } = {}) {
    this.root = path.resolve(root); this.now = now; this.limits = limits; this.logger = appLogger;
    this.sessions = new Map(); this.ready = false; this.busy = false; this.leases = new Map(); this.waiters = [];
  }
  async exclusive(work, wait = false) {
    while (wait && this.busy) await new Promise(resolve => this.waiters.push(resolve));
    if (this.busy) fail('storage_busy', 429, 'Test storage is busy. Retry shortly.');
    this.busy = true;
    try { await this.initialize(); return await work(); } finally { this.busy = false; this.waiters.splice(0).forEach(resolve => resolve()); }
  }
  async checkRoot() {
    const app = path.resolve(__dirname, '../..');
    for (const mount of [path.join(app, 'public'), path.join(app, 'games'), path.join(app, 'node_modules'), process.env.VUE_PATH].filter(Boolean)) {
      const real = await fs.realpath(mount).catch(error => { if (error.code === 'ENOENT') return path.resolve(mount); throw error; });
      if ([path.resolve(mount), real].some(value => within(value, this.root) || within(this.root, value))) throw new Error('Unsafe lab root');
    }
    let ancestor = this.root;
    while (!await fs.lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) ancestor = path.dirname(ancestor);
    await assertNoSymlinks(ancestor); await assertTrustedStorage(ancestor, ancestor !== this.root);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await assertNoSymlinks(this.root); await assertTrustedStorage(this.root);
  }
  directory(id) {
    if (!ID.test(id)) fail('not_found', 404, 'Test session not found.');
    return path.join(this.root, id);
  }
  async safeOpen(directory, name, maxBytes) {
    await assertNoSymlinks(directory);
    const file = path.join(directory, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error('Unsafe lab file');
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat();
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) throw new Error('Lab file changed');
      return { handle, stat: opened };
    } catch (error) { await handle.close(); throw error; }
  }
  async safeRead(directory, name, maxBytes) {
    const { handle } = await this.safeOpen(directory, name, maxBytes);
    try { return await handle.readFile(); } finally { await handle.close(); }
  }
  async initialize() {
    await this.checkRoot();
    if (this.ready) return;
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    if (entries.length > this.limits.globalSessions) throw new Error('Lab directory count exceeds limit');
    this.sessions.clear();
    for (const entry of entries) {
      if (!ID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unexpected lab directory');
      const directory = this.directory(entry.name);
      let session;
      try {
        session = sessionSchema.parse(JSON.parse(await this.safeRead(directory, 'session.json', 262144)));
        if (session.id !== entry.name || session.expiresAt !== session.createdAt + this.limits.ttlMs
          || new Set(session.assets.map(asset => asset.id)).size !== session.assets.length) throw new Error('Invalid manifest');
      } catch (_) {
        // The process no longer holds requests or local file handles. Recovery never
        // replays generation or attempts to delete Gateway voices.
        await this.purgeDirectory(entry.name);
        this.logger.warning('Removed invalid Experimental Models staging session during recovery', { category: 'experimental_models' });
        continue;
      }
      this.sessions.set(session.id, session);
      for (const job of session.jobs) {
        if (['queued', 'waiting_gateway'].includes(job.state)) {
          job.state = job.state === 'queued' ? 'cancelled' : 'interrupted';
          job.error = job.state === 'interrupted' ? 'Site restarted. Gateway completion is unknown; generation was not replayed.' : 'Site restarted before forwarding; local job cancelled.';
          job.endedAt = this.now(); job.reservedBytes = 0;
          this.logger.warning('Experimental Models job interrupted by Site restart; generation not replayed', { category: 'experimental_models' });
        }
      }
      await this.save(session);
      const expected = new Set(['session.json', ...session.assets.map(asset => `${asset.id}.${extension(asset)}`)]);
      for (const file of await fs.readdir(directory)) {
        if (!expected.has(file)) await fs.rm(path.join(directory, file), { recursive: true, force: true });
      }
      // Missing or unsafe asset data invalidates this local-only session.
      try {
        for (const asset of session.assets) {
          const bytes = await this.safeRead(directory, `${asset.id}.${extension(asset)}`, this.limits.fileBytes);
          if (bytes.length !== asset.bytes) throw new Error('Invalid asset length');
        }
      } catch (_) {
        await this.purge(session);
        this.logger.warning('Removed damaged Experimental Models staging session during recovery', { category: 'experimental_models' });
      }
    }
    this.ready = true;
    await this.sweepUnlocked();
  }
  async save(session) {
    const directory = this.directory(session.id);
    await assertNoSymlinks(directory);
    const temp = path.join(directory, `${randomUUID()}.tmp`);
    const handle = await fs.open(temp, 'wx', 0o600);
    try {
      try { await handle.writeFile(JSON.stringify(session)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, path.join(directory, 'session.json'));
    } catch (error) { await fs.rm(temp, { force: true }); throw error; }
  }
  owned(owner, binding, id, allowPending = false) {
    const session = ID.test(id) && this.sessions.get(id);
    if (!session || session.owner !== owner || session.binding !== binding || (!allowPending && session.deletePending) || session.expiresAt <= this.now()) {
      fail('not_found', 404, 'Test session not found.');
    }
    return session;
  }
  summary(session) {
    return { id: session.id, createdAt: session.createdAt, expiresAt: session.expiresAt,
      deletePending: session.deletePending, jobs: session.jobs.map(job => ({ ...job })),
      bytes: this.usage(session), assets: session.assets.map(asset => ({ ...asset })) };
  }
  list(owner, binding) {
    return this.exclusive(async () => [...this.sessions.values()].filter(s => s.owner === owner && s.binding === binding && (!s.deletePending || this.leases.get(s.id)) && s.expiresAt > this.now()).map(s => this.summary(s)));
  }
  create(owner, binding) {
    return this.exclusive(async () => {
      await this.sweepUnlocked();
      if (!/^[a-f0-9]{24}$/.test(owner) || !ID.test(binding)) throw new Error('Invalid principal');
      if (this.sessions.size >= this.limits.globalSessions || [...this.sessions.values()].filter(s => s.owner === owner).length >= this.limits.userSessions) {
        fail('session_limit', 429, 'Test session limit reached. Clear a session or wait for expiry.');
      }
      const createdAt = this.now();
      const session = { version: 1, id: randomUUID(), owner, binding, createdAt, expiresAt: createdAt + this.limits.ttlMs, deletePending: false, assets: [], jobs: [] };
      await fs.mkdir(this.directory(session.id), { mode: 0o700 });
      this.sessions.set(session.id, session);
      try { await this.save(session); } catch (error) { session.deletePending = true; throw error; }
      return this.summary(session);
    });
  }
  get(owner, binding, id) { return this.exclusive(async () => this.summary(this.owned(owner, binding, id, true))); }
  async purgeDirectory(id) {
    await assertNoSymlinks(this.root);
    const directory = this.directory(id);
    await fs.rm(directory, { recursive: true, force: true }); // rm unlinks symlinks, never follows them.
  }
  async purge(session) { await this.purgeDirectory(session.id); this.sessions.delete(session.id); }
  clear(owner, binding, id) {
    return this.exclusive(async () => {
      const session = this.owned(owner, binding, id, true);
      session.deletePending = true;
      this.cancelQueued(session);
      await this.save(session);
      if (!this.leases.get(id)) await this.purge(session);
      return { deleted: !this.sessions.has(id), deletePending: this.sessions.has(id) };
    });
  }
  async sweepUnlocked() {
    for (const session of this.sessions.values()) {
      if (session.deletePending || session.expiresAt <= this.now()) {
        session.deletePending = true; this.cancelQueued(session);
        if (!this.leases.get(session.id)) await this.purge(session);
        else await this.save(session);
      }
    }
  }
  sweep() { return this.exclusive(() => this.sweepUnlocked()); }
  upload(owner, binding, id, file) {
    return this.exclusive(async () => {
      const session = this.owned(owner, binding, id);
      if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) fail('invalid_file', 400, 'Choose one PNG, JPEG or WebP image.');
      if (file.buffer.length > this.limits.fileBytes) fail('file_limit', 413, 'Image exceeds 8 MiB.');
      const formats = { 'image/png': ['png', /\.png$/i], 'image/jpeg': ['jpeg', /\.jpe?g$/i], 'image/webp': ['webp', /\.webp$/i] };
      const expected = formats[file.mimetype];
      if (!expected || typeof file.originalname !== 'string' || file.originalname.length > 200 || /[\\/\x00-\x1f]/.test(file.originalname) || !expected[1].test(file.originalname)) {
        fail('invalid_file', 400, 'Image type, filename and content must match.');
      }
      if (session.assets.length + session.jobs.filter(j => j.reservedBytes).length >= this.limits.sessionFiles) fail('file_count', 429, 'Session file limit reached.');
      let bytes, metadata;
      try {
        const image = sharp(file.buffer, { limitInputPixels: this.limits.maxPixels, failOn: 'warning', animated: true }).timeout({ seconds: 10 });
        metadata = await image.metadata();
        if (metadata.format !== expected[0] || (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height
          || metadata.width < 32 || metadata.height < 32 || metadata.width > this.limits.maxEdge || metadata.height > this.limits.maxEdge
          || Math.max(metadata.width / metadata.height, metadata.height / metadata.width) > 200) throw new Error('Invalid raster');
        const normalized = await image.rotate().toColourspace('srgb').removeAlpha().png().toBuffer({ resolveWithObject: true });
        bytes = normalized.data; metadata = normalized.info; // EXIF orientation before stripping metadata; coordinates match preview.
      } catch (_) { fail('invalid_image', 400, 'Use a valid single-frame image, 32–16384 pixels per side, at most 16 million pixels and aspect ratio 200.'); }
      if (bytes.length > this.limits.fileBytes) fail('file_limit', 413, 'Normalized image exceeds 8 MiB.');
      this.checkQuota(session, bytes.length);
      // TTL may have elapsed during decode. Clear and upload share this lock.
      this.owned(owner, binding, id);
      const asset = { id: randomUUID(), mime: 'image/png', bytes: bytes.length, width: metadata.width, height: metadata.height };
      const filePath = path.join(this.directory(id), `${asset.id}.${extension(asset)}`);
      const handle = await fs.open(filePath, 'wx', 0o600);
      // Reserve quota before I/O so write/flush/close failures cannot leave an
      // uncounted file. The whole session is then quarantined for cleanup.
      session.assets.push(asset);
      try {
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        await this.save(session);
      } catch (error) {
        session.deletePending = true;
        throw error;
      }
      return { ...asset };
    });
  }
  usage(session) { return session.assets.reduce((sum, asset) => sum + asset.bytes, 0) + session.jobs.reduce((sum, job) => sum + job.reservedBytes, 0); }
  checkQuota(session, bytes) {
    const sessions = [...this.sessions.values()];
    if (this.usage(session) + bytes > this.limits.sessionBytes
      || sessions.filter(s => s.owner === session.owner).reduce((sum, s) => sum + this.usage(s), 0) + bytes > this.limits.userBytes
      || sessions.reduce((sum, s) => sum + this.usage(s), 0) + bytes > this.limits.globalBytes) fail('storage_limit', 429, 'Test storage quota reached. Clear test data first.');
  }
  lease(id) { this.leases.set(id, (this.leases.get(id) || 0) + 1); }
  release(id) {
    const count = (this.leases.get(id) || 1) - 1;
    if (count) this.leases.set(id, count); else this.leases.delete(id);
  }
  cancelQueued(session) {
    this.onSessionClosing?.(session.id);
    for (const job of session.jobs) if (job.state === 'queued') {
      job.state = 'cancelled'; job.endedAt = this.now(); job.reservedBytes = 0;
      job.error = 'Local job cancelled before forwarding to Gateway.';
    }
  }
  job(owner, binding, id, jobId) {
    return this.exclusive(async () => {
      const session = this.owned(owner, binding, id, true);
      const job = ID.test(jobId) && session.jobs.find(j => j.id === jobId);
      if (!job) fail('not_found', 404, 'Test job not found.');
      return { ...job };
    });
  }
  download(owner, binding, id, assetId) {
    return this.exclusive(async () => {
      const session = this.owned(owner, binding, id);
      const asset = ID.test(assetId) && session.assets.find(value => value.id === assetId);
      if (!asset) fail('not_found', 404, 'Test file not found.');
      const { handle, stat } = await this.safeOpen(this.directory(id), `${asset.id}.${extension(asset)}`, this.limits.fileBytes);
      if (stat.size !== asset.bytes) { await handle.close(); throw new Error('Damaged lab asset'); }
      this.lease(session.id);
      const close = handle.close.bind(handle); let closed = false;
      handle.close = async () => { try { return await close(); } finally { if (!closed) { closed = true; this.release(session.id); } } };
      return { handle, asset: { ...asset } };
    });
  }
}
module.exports = { LabStore, storageRoot };
