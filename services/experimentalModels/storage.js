const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const { validateWav } = require('./contracts');
const { assertNoSymlinks, assertTrustedStorage, within } = require('../gptImageStorageService');
const logger = require('../../utils/logger');
const { ID, LIMITS, fail, sessionSchema } = require('./policy');

// Capture server configuration once, shared by the store and static delivery guard.
// Changing the root requires a restart; never discover or migrate a previous store.
const configuredRoot = process.env.EXPERIMENTAL_MODELS_STORAGE_ROOT;
function configurationError() {
  return Object.assign(new Error('Experimental Models storage configuration is invalid.'), { code: 'EXPERIMENTAL_MODELS_STORAGE_CONFIG' });
}
function resolveStorageRoot(value, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value) || !paths.isAbsolute(value)) throw configurationError();
  const parts = value.split(platform === 'win32' ? /[\\/]/ : /\//);
  // Do not normalize away a component that could be a symlink/junction.
  if (parts.some(part => part === '.' || part === '..')) throw configurationError();
  if (platform === 'win32') {
    const portable = value.replace(/\\/g, '/');
    // Require a drive-qualified or UNC path. Reject drive-relative/root-relative
    // paths, device namespaces, ADS, and Win32 aliases (trailing dots/spaces).
    const drive = /^[a-z]:\//i.test(portable);
    if (!drive && !/^\/\/[^/]+\/[^/]+(?:\/|$)/.test(portable)) throw configurationError();
    const names = drive ? parts.slice(1) : parts.slice(2);
    if (names.some(part => /[<>:"|?*]|[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw configurationError();
  }
  return paths.resolve(value);
}
function storageRoot() {
  return configuredRoot === undefined ? path.resolve(__dirname, '../../private_data/experimental-models') : resolveStorageRoot(configuredRoot);
}
const extension = asset => ({ 'image/png': 'png', 'application/json': 'json', 'audio/wav': 'wav' })[asset.mime];
// One process owns the store. Leases prevent removal during requests and streams.
class LabStore {
  constructor({ root, now = Date.now, limits = LIMITS, appLogger = logger } = {}) {
    // Defer invalid config to the normal operation/cleanup error handlers, which
    // log safe diagnostics without stopping unrelated Site features on import.
    try { this.root = root === undefined ? storageRoot() : resolveStorageRoot(root); }
    catch (error) { this.configurationError = error; }
    this.now = now; this.limits = limits; this.logger = appLogger;
    this.sessions = new Map(); this.ready = false; this.busy = false; this.leases = new Map(); this.waiters = [];
  }
  async exclusive(work, wait = false) {
    while (wait && this.busy) await new Promise(resolve => this.waiters.push(resolve));
    if (this.busy) fail('storage_busy', 429, 'Test storage is busy. Retry shortly.');
    this.busy = true;
    try { await this.initialize(); return await work(); } finally { this.busy = false; this.waiters.splice(0).forEach(resolve => resolve()); }
  }
  async checkRoot() {
    if (this.configurationError) throw this.configurationError;
    const app = path.resolve(__dirname, '../..');
    for (const mount of [path.join(app, 'public'), path.join(app, 'games'), path.join(app, 'node_modules'), process.env.VUE_PATH].filter(Boolean)) {
      const real = await fs.realpath(mount).catch(error => { if (error.code === 'ENOENT') return path.resolve(mount); throw error; });
      if ([path.resolve(mount), real].some(value => within(value, this.root) || within(this.root, value))) throw new Error('Unsafe lab root');
    }
    let ancestor = this.root;
    while (!await fs.lstat(ancestor).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) ancestor = path.dirname(ancestor);
    await assertNoSymlinks(ancestor);
    // Reject filesystem aliases (including Windows short names) so the static
    // guard and every store operation refer to the same canonical directory.
    if (path.relative(ancestor, await fs.realpath(ancestor))) throw new Error('Unsafe lab root');
    await assertTrustedStorage(ancestor, ancestor !== this.root);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await assertNoSymlinks(this.root);
    if (path.relative(this.root, await fs.realpath(this.root))) throw new Error('Unsafe lab root');
    await assertTrustedStorage(this.root);
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
          job.endedAt = this.now(); job.reservedBytes = 0; job.reservedMetadataBytes = 0;
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
    const serialized = JSON.stringify(session);
    if (Buffer.byteLength(serialized) > 262144) throw new Error('Lab manifest exceeds limit');
    const temp = path.join(directory, `${randomUUID()}.tmp`);
    const handle = await fs.open(temp, 'wx', 0o600);
    try {
      try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
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
      this.checkQuota(session, 0);
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
  upload(owner, binding, id, file, reference = false) {
    return this.exclusive(async () => {
      const session = this.owned(owner, binding, id);
      if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) fail('invalid_file', 400, 'Choose one supported file.');
      if (file.buffer.length > this.limits.fileBytes) fail('file_limit', 413, 'Image exceeds 8 MiB.');
      const formats = { 'image/png': ['png', /\.png$/i], 'image/jpeg': ['jpeg', /\.jpe?g$/i], 'image/webp': ['webp', /\.webp$/i] };
      const expected = reference ? (['audio/wav', 'audio/x-wav', 'audio/wave'].includes(file.mimetype) ? ['wav', /\.wav$/i] : null) : formats[file.mimetype];
      if (!expected || typeof file.originalname !== 'string' || file.originalname.length > 200 || /[\\/\x00-\x1f]/.test(file.originalname) || !expected[1].test(file.originalname)) {
        fail('invalid_file', 400, 'File type, filename and content must match.');
      }
      if (session.assets.length + session.jobs.filter(j => j.reservedBytes).length >= this.limits.sessionFiles) fail('file_count', 429, 'Session file limit reached.');
      let bytes, metadata, audio;
      if (reference) {
        audio = validateWav(file.buffer, { reference: true });
        bytes = file.buffer;
      } else try {
        const image = sharp(file.buffer, { limitInputPixels: this.limits.maxPixels, failOn: 'warning', animated: true }).timeout({ seconds: 10 });
        metadata = await image.metadata();
        if (metadata.format !== expected[0] || (metadata.pages || 1) !== 1 || !metadata.width || !metadata.height
          || metadata.width < 32 || metadata.height < 32 || metadata.width > this.limits.maxEdge || metadata.height > this.limits.maxEdge
          || Math.max(metadata.width / metadata.height, metadata.height / metadata.width) > 200) throw new Error('Invalid raster');
        const normalized = await image.rotate().toColourspace('srgb').removeAlpha().png().toBuffer({ resolveWithObject: true });
        bytes = normalized.data; metadata = normalized.info; // EXIF orientation before stripping metadata; coordinates match preview.
      } catch (_) { fail('invalid_image', 400, 'Use a valid single-frame image, 32–16384 pixels per side, at most 16 million pixels and aspect ratio 200.'); }
      if (bytes.length > this.limits.fileBytes) fail('file_limit', 413, 'Normalized image exceeds 8 MiB.');
      this.checkQuota(session, bytes.length + 512);
      // TTL may have elapsed during decode. Clear and upload share this lock.
      this.owned(owner, binding, id);
      const asset = { id: randomUUID(), mime: reference ? 'audio/wav' : 'image/png', bytes: bytes.length,
        ...(reference ? { audio } : { width: metadata.width, height: metadata.height }) };
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
  usage(session) { return Buffer.byteLength(JSON.stringify(session)) + session.assets.reduce((sum, asset) => sum + asset.bytes, 0) + session.jobs.reduce((sum, job) => sum + job.reservedBytes + (job.reservedMetadataBytes || 0), 0); }
  checkQuota(session, bytes) {
    const sessions = [...this.sessions.values()];
    if (!this.sessions.has(session.id)) sessions.push(session);
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
      job.state = 'cancelled'; job.endedAt = this.now(); job.reservedBytes = 0; job.reservedMetadataBytes = 0;
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
module.exports = { LabStore, storageRoot, resolveStorageRoot };
