const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const sharp = require('sharp');
const { fail } = require('./contract');
const logger = require('../../utils/logger');
const { paths, samePath, storageRoot } = require('./paths');
const FORMATS = {
  png: { extensions: ['.png'], mimes: ['image/png'], kinds: ['image'] },
  jpeg: { extensions: ['.jpg', '.jpeg'], mimes: ['image/jpeg'], kinds: ['image'] },
  webp: { extensions: ['.webp'], mimes: ['image/webp'], kinds: ['image'] },
  wav: { extensions: ['.wav'], mimes: ['audio/wav', 'audio/x-wav', 'audio/wave'], kinds: ['audio'] },
  mp3: { extensions: ['.mp3'], mimes: ['audio/mpeg', 'audio/mp3'], kinds: ['audio'] },
  flac: { extensions: ['.flac'], mimes: ['audio/flac', 'audio/x-flac'], kinds: ['audio'] },
  ogg: { extensions: ['.ogg', '.opus'], mimes: ['audio/ogg', 'audio/opus', 'application/ogg'], kinds: ['audio'] },
  mp4: { extensions: ['.mp4'], mimes: ['video/mp4', 'audio/mp4'], kinds: ['audio', 'video'] },
  m4a: { extensions: ['.m4a'], mimes: ['audio/mp4', 'audio/x-m4a'], kinds: ['audio'] },
  quicktime: { extensions: ['.mov'], mimes: ['video/quicktime'], kinds: ['audio', 'video'] },
  matroska: { extensions: ['.mkv', '.mka'], mimes: ['video/x-matroska', 'audio/x-matroska'], kinds: ['audio', 'video'] },
  webm: { extensions: ['.webm'], mimes: ['video/webm', 'audio/webm'], kinds: ['audio', 'video'] },
};
// Bounded container identification, not decoding. Inconclusive containers fail closed.
function signature(b) {
  if (b.length < 12) fail('Unsupported media signature.');
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.readUInt32LE(4) + 8 === b.length) {
    if (b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    if (b.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  }
  if (b.toString('latin1', 0, 4) === 'fLaC' && b.length >= 42 && (b[4] & 127) === 0 && b.readUIntBE(5, 3) === 34) return 'flac';
  if (b.toString('latin1', 0, 4) === 'OggS' && b.length >= 28 && b[4] === 0 && (b[5] & 2) && b[26] > 0) {
    const offset = 27 + b[26];
    if (b.toString('latin1', offset, offset + 8) === 'OpusHead' || b.subarray(offset, offset + 7).equals(Buffer.from([1,118,111,114,98,105,115]))) return 'ogg';
  }
  let offset = 0;
  if (b.toString('latin1', 0, 3) === 'ID3') {
    if (![2, 3, 4].includes(b[3]) || b.subarray(6, 10).some(n => n > 127)) fail('Unsupported media signature.');
    offset = 10 + b.subarray(6, 10).reduce((size, n) => size * 128 + n, 0) + (b[3] === 4 && (b[5] & 16) ? 10 : 0);
  }
  // Require two consecutive Layer III frames; ID3 or a sync prefix alone is ambiguous (e.g. AAC).
  const frameLength = at => {
    if (at + 4 > b.length || b[at] !== 255 || (b[at + 1] & 0xe0) !== 0xe0 || (b[at + 1] & 6) !== 2) return 0;
    const version = (b[at + 1] >> 3) & 3; const rate = (b[at + 2] >> 2) & 3; const bitrate = b[at + 2] >> 4;
    if (version === 1 || rate === 3 || bitrate === 0 || bitrate === 15) return 0;
    const kbps = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrate];
    const hz = [44100,48000,32000][rate] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    return Math.floor((version === 3 ? 144000 : 72000) * kbps / hz) + ((b[at + 2] >> 1) & 1);
  };
  const first = frameLength(offset); const second = first && frameLength(offset + first);
  if (first && second && offset + first + second <= b.length) return 'mp3';
  if (b.toString('latin1', 4, 8) === 'ftyp') {
    const size = b.readUInt32BE(0);
    if (size >= 16 && size <= Math.min(b.length, 4096) && size % 4 === 0) {
      const brand = b.toString('latin1', 8, 12);
      if (brand === 'qt  ') return 'quicktime';
      if (['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'M4A '].includes(brand)) return brand === 'M4A ' ? 'm4a' : 'mp4';
    }
  }
  if (b.subarray(0, 4).equals(Buffer.from([26,69,223,163]))) {
    // Parse only the <=4 KiB EBML header, including its exact DocType element.
    const vint = at => {
      let length = 1; while (length <= 4 && !(b[at] & (128 >> (length - 1)))) length++;
      if (length > 4 || at + length > b.length) return null;
      let value = b[at] & ((128 >> (length - 1)) - 1);
      for (let i = 1; i < length; i++) value = value * 256 + b[at + i];
      return { length, value };
    };
    const header = vint(4);
    if (header && header.value <= 4096 && 4 + header.length + header.value <= b.length) {
      const end = 4 + header.length + header.value; let at = 4 + header.length; let type;
      while (at < end) {
        const id = vint(at); if (!id) break;
        const docType = id.length === 2 && b[at] === 0x42 && b[at + 1] === 0x82;
        at += id.length; const size = vint(at); if (!size) break;
        at += size.length; if (at + size.value > end) break;
        if (docType) { if (type) break; type = b.toString('latin1', at, at + size.value); }
        at += size.value;
      }
      if (at === end && ['webm', 'matroska'].includes(type)) return type;
    }
  }
  fail('Unsupported or ambiguous media signature.');
}
// ISO BMFF reference movies can name other files/URLs. Reject external data
// references before forwarding or ever offering the original for browser playback.
function standaloneBmff(bytes) {
  let boxes = 0; let movie = false; let data = false;
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'dinf', 'stbl', 'edts', 'mvex', 'moof', 'traf']);
  function walk(start, end, depth) {
    if (depth > 12) fail('Media container nesting exceeds limits.');
    let at = start;
    while (at < end) {
      if (++boxes > 4096 || end - at < 8) fail('Invalid or excessive media container boxes.');
      let size = bytes.readUInt32BE(at); let header = 8;
      const type = bytes.toString('latin1', at + 4, at + 8);
      if (size === 1) {
        if (end - at < 16) fail('Invalid media container size.');
        const wide = bytes.readBigUInt64BE(at + 8);
        if (wide > BigInt(bytes.length)) fail('Invalid media container size.');
        size = Number(wide); header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) fail('Invalid media container size.');
      const body = at + header; const next = at + size;
      if (depth === 0 && type === 'moov') movie = true;
      if (depth === 0 && type === 'mdat' && size > header) data = true;
      if (['rmra', 'rmda', 'rdrf'].includes(type)) fail('External media references are not supported.');
      if (type === 'dref') {
        if (next - body < 8 || bytes.readUInt32BE(body) !== 0) fail('Invalid media data references.');
        const count = bytes.readUInt32BE(body + 4);
        if (count < 1 || count > 16 || next - body !== 8 + count * 12) fail('External or ambiguous media data references.');
        for (let i = body + 8; i < next; i += 12) {
          if (bytes.readUInt32BE(i) !== 12 || bytes.toString('latin1', i + 4, i + 8) !== 'url ' || bytes.readUInt32BE(i + 8) !== 1) fail('External media references are not supported.');
        }
      } else if (containers.has(type)) walk(body, next, depth + 1);
      at = next;
    }
  }
  walk(0, bytes.length, 0);
  if (!movie || !data) fail('Media container must include its movie and data.');
}
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
class Files {
  constructor(root, { platform = process.platform, io = fs, flags = constants } = {}) {
    this.platform = platform; this.path = paths(platform); this.io = io; this.flags = flags;
    this.root = storageRoot(root, this.path.resolve(__dirname, '../../public'), platform);
  }
  async init() {
    let ancestor = this.path.parse(this.root).root;
    for (const part of this.root.slice(ancestor.length).split(this.path.sep).filter(Boolean)) {
      ancestor = this.path.join(ancestor, part);
      try {
        const entry = await this.io.lstat(ancestor);
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Symlinked or unsafe pilot storage ancestor');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try { await this.io.mkdir(ancestor, { mode: 0o700 }); }
        catch (createError) { if (createError.code !== 'EEXIST') throw createError; }
        const entry = await this.io.lstat(ancestor);
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Symlinked or unsafe pilot storage ancestor');
      }
      if (!samePath(await this.io.realpath(ancestor), ancestor, this.platform)) throw new Error('Symlinked pilot storage ancestor');
    }
    // Windows inherits the checkout's ACLs; mode restricts new POSIX directories.
    if (!samePath(await this.io.realpath(this.root), this.root, this.platform)) throw new Error('Symlinked pilot storage root');
    const stat = await this.io.lstat(this.root, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || (this.rootIdentity && !identity(stat, this.rootIdentity))) throw new Error('Unsafe or replaced pilot storage root');
    this.rootIdentity = stat;
  }
  name() { return randomBytes(24).toString('hex'); }
  resolve(name) {
    if (typeof name !== 'string' || !/^[a-f0-9]{48}$/.test(name)) throw new Error('Unsafe pilot asset reference');
    return this.path.join(this.root, name);
  }
  async inspect(target) {
    const stat = await this.io.lstat(target, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size > 8388608n || !samePath(await this.io.realpath(target), target, this.platform)) throw new Error('Unsafe pilot asset');
    return stat;
  }
  async openHandle(target, flags, mode) {
    const nofollow = this.platform === 'win32' ? 0 : this.flags.O_NOFOLLOW || 0;
    try { return await this.io.open(target, flags | nofollow, mode); }
    catch (error) {
      if (!nofollow || !['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
      // Same checks before/after opening still apply; protected parent is mandatory.
      if (!this.warnedFallback) {
        logger.warning('EmbeddingGemma2 filesystem lacks no-follow open; protected root required', { category: 'embeddinggemma2' });
        this.warnedFallback = true;
      }
      return this.io.open(target, flags, mode);
    }
  }
  async verify(target, handle, before) {
    await this.init();
    const after = await this.inspect(target); const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || opened.size > 8388608n || !identity(before, after) || !identity(after, opened) || after.size !== opened.size) throw new Error('Pilot asset changed during access');
  }
  async open(name) {
    await this.init();
    const target = this.resolve(name); const before = await this.inspect(target);
    const handle = await this.openHandle(target, this.flags.O_RDONLY);
    try {
      await this.verify(target, handle, before);
      const stat = await handle.stat();
      if (stat.size <= 0 || stat.size > 8388608 || stat.nlink !== 1) throw new Error('Unsafe pilot asset');
      return { handle, stat };
    } catch (error) { await handle.close(); throw error; }
  }
  async write(name, bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 8388608) throw new Error('Unsafe pilot asset size');
    await this.init();
    const target = this.resolve(name);
    const handle = await this.openHandle(target, this.flags.O_WRONLY | this.flags.O_CREAT | this.flags.O_EXCL, 0o600);
    try {
      const created = await handle.stat({ bigint: true });
      await this.verify(target, handle, created);
      await handle.writeFile(bytes); await handle.sync();
      await this.verify(target, handle, created);
      if ((await handle.stat()).size !== bytes.length) throw new Error('Pilot asset write incomplete');
    } finally { await handle.close(); }
  }
  async remove(name) {
    await this.init();
    const target = this.resolve(name);
    try {
      const before = await this.inspect(target);
      const handle = await this.openHandle(target, this.flags.O_RDONLY);
      try { await this.verify(target, handle, before); } finally { await handle.close(); }
      if (!identity(before, await this.inspect(target))) throw new Error('Pilot asset changed before deletion');
      await this.io.unlink(target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async validate(file, kind) {
    if (!file?.buffer?.length || file.buffer.length > 8388608) fail('Media must be 1 byte–8 MiB.', 413);
    const format = signature(file.buffer);
    const spec = FORMATS[format];
    if (['mp4', 'm4a', 'quicktime'].includes(format)) standaloneBmff(file.buffer);
    const ext = path.posix.extname((file.originalname || '').replace(/\\/g, '/')).toLowerCase();
    if (!spec.kinds.includes(kind) || !spec.extensions.includes(ext) || !(spec.mimes.includes(file.mimetype) || file.mimetype === 'application/octet-stream')) fail('File extension, MIME and detected format must agree.');
    let mime = spec.mimes[0];
    if (['mp4', 'm4a'].includes(format)) mime = kind === 'audio' ? 'audio/mp4' : 'video/mp4';
    if (['matroska', 'webm'].includes(format)) mime = `${kind}/${format === 'webm' ? 'webm' : 'x-matroska'}`;
    const filename = path.basename(file.originalname.replace(/\\/g, '/')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || 'media';
    if (kind === 'image') {
      try {
        const image = sharp(file.buffer, { limitInputPixels: 4000000, animated: true, failOn: 'warning' }).timeout({ seconds: 20 });
        const meta = await image.metadata();
        if (meta.format !== format || (meta.pages || 1) !== 1 || !meta.width || !meta.height || Math.max(meta.width, meta.height) > 4096 || meta.width * meta.height > 4000000) fail('Image exceeds decoded limits or is animated.', 413);
        await image.raw().toBuffer();
      } catch (error) { if (error.status) throw error; fail('Image could not be decoded within limits.'); }
    }
    // Audio/video decoding belongs to the bounded trusted Gateway. No local subprocess or staging.
    return { filename, mime, bytes: file.buffer.length };
  }
  async clearStaging() {
    await this.init();
    const staging = new Files(this.path.join(this.root, 'staging'), { platform: this.platform, io: this.io, flags: this.flags });
    try { await this.io.lstat(staging.root); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await staging.init();
    const directory = await this.io.opendir(staging.root);
    let count = 0;
    for await (const entry of directory) {
      if (++count > 8) throw new Error('Pilot staging recovery exceeds bounded allowance');
      if (!/^[a-f0-9]{48}$/.test(entry.name)) throw new Error('Unexpected staging entry');
      await staging.remove(entry.name);
    }
  }
}
module.exports = { Files, FORMATS, signature, standaloneBmff };
