const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { execFile } = require('child_process');
const sharp = require('sharp');
const { fail } = require('./contract');
const logger = require('../../utils/logger');
const FORMATS = {
  png: { extensions: ['.png'], mimes: ['image/png'], kinds: ['image'] },
  jpeg: { extensions: ['.jpg', '.jpeg'], mimes: ['image/jpeg'], kinds: ['image'] },
  webp: { extensions: ['.webp'], mimes: ['image/webp'], kinds: ['image'] },
  wav: { extensions: ['.wav'], mimes: ['audio/wav', 'audio/x-wav', 'audio/wave'], kinds: ['audio'] },
  mp3: { extensions: ['.mp3'], mimes: ['audio/mpeg', 'audio/mp3'], kinds: ['audio'] },
  flac: { extensions: ['.flac'], mimes: ['audio/flac', 'audio/x-flac'], kinds: ['audio'] },
  ogg: { extensions: ['.ogg', '.opus'], mimes: ['audio/ogg', 'audio/opus', 'application/ogg'], kinds: ['audio'] },
  mov: { extensions: ['.mp4', '.m4a', '.mov'], mimes: ['video/mp4', 'audio/mp4', 'video/quicktime'], kinds: ['audio', 'video'] },
  matroska: { extensions: ['.mkv', '.mka', '.webm'], mimes: ['video/x-matroska', 'audio/x-matroska', 'video/webm', 'audio/webm'], kinds: ['audio', 'video'] },
};
function signature(b) {
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (b.toString('ascii', 0, 4) === 'fLaC') return 'flac';
  if (b.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 255 && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  if (b.toString('ascii', 4, 8) === 'ftyp') return 'mov';
  if (b.subarray(0, 4).equals(Buffer.from([26,69,223,163]))) return 'matroska';
  fail('Unsupported media signature.');
}
function run(binary, args, maxBuffer = 131072) {
  return new Promise((resolve, reject) => execFile('prlimit', ['--as=1073741824', '--cpu=20', '--fsize=16777216', '--', binary, ...args], { timeout: 20000, killSignal: 'SIGKILL', maxBuffer, encoding: 'buffer', windowsHide: true }, (error, stdout) => {
    if (error) return reject(error.code === 'ENOENT' || error.code === 127 ? Object.assign(new Error('Media decoder unavailable'), { code: 'ENOENT' }) : new Error('Media decoder rejected input'));
    resolve(stdout);
  }));
}
class Files {
  constructor(root) { this.root = root; }
  async init() {
    // Reject existing symlink ancestors before mkdir can create anything through them.
    let ancestor = path.parse(this.root).root;
    for (const part of this.root.slice(ancestor.length).split(path.sep).filter(Boolean)) {
      ancestor = path.join(ancestor, part);
      try {
        const entry = await fs.lstat(ancestor);
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('Symlinked or unsafe pilot storage ancestor');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    if (await fs.realpath(this.root) !== this.root) throw new Error('Symlinked pilot storage root');
    const stat = await fs.lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe pilot storage root');
  }
  name() { return randomBytes(24).toString('hex'); }
  resolve(name) {
    if (typeof name !== 'string' || !/^[a-f0-9]{48}$/.test(name)) throw new Error('Unsafe pilot asset reference');
    return path.join(this.root, name);
  }
  async open(name) {
    await this.init();
    const handle = await fs.open(this.resolve(name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8388608) throw new Error('Unsafe pilot asset');
      return { handle, stat };
    } catch (error) { await handle.close(); throw error; }
  }
  async write(name, bytes) {
    await this.init();
    const handle = await fs.open(this.resolve(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  }
  async remove(name) {
    await this.init();
    const target = this.resolve(name);
    try {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe pilot asset deletion');
      await fs.unlink(target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async validate(file, kind) {
    if (!file?.buffer?.length || file.buffer.length > 8388608) fail('Media must be 1 byte–8 MiB.', 413);
    const format = signature(file.buffer);
    const spec = FORMATS[format];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!spec.kinds.includes(kind) || !spec.extensions.includes(ext) || !(spec.mimes.includes(file.mimetype) || file.mimetype === 'application/octet-stream')) fail('File extension, MIME and decoded format must agree.');
    let mime = spec.mimes[0];
    if (format === 'mov') mime = ext === '.mov' ? 'video/quicktime' : kind === 'audio' ? 'audio/mp4' : 'video/mp4';
    if (format === 'matroska') mime = ext === '.webm' ? `${kind}/webm` : `${kind}/x-matroska`;
    const filename = path.basename(file.originalname.replace(/\\/g, '/')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || 'media';
    if (kind === 'image') {
      try {
        const image = sharp(file.buffer, { limitInputPixels: 4000000, animated: true, failOn: 'warning' });
        const meta = await image.metadata();
        if (meta.format !== format || (meta.pages || 1) !== 1 || !meta.width || !meta.height || Math.max(meta.width, meta.height) > 4096 || meta.width * meta.height > 4000000) fail('Image exceeds decoded limits or is animated.', 413);
        await image.raw().toBuffer();
      } catch (error) { if (error.status) throw error; fail('Image could not be decoded within limits.'); }
    } else {
      // Separate staging namespace prevents query files becoming persistent records.
      const staging = new Files(path.join(this.root, 'staging'));
      const name = staging.name();
      try {
        await staging.write(name, file.buffer);
        const mediaPath = staging.resolve(name);
        const flags = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', format, '-threads', '1', '-max_alloc', '67108864'];
        if (format === 'mov') flags.push('-enable_drefs', '0', '-use_absolute_path', '0');
        const probe = JSON.parse((await run('ffprobe', [...flags, '-show_entries', 'format=duration:stream=codec_type,width,height,duration', '-of', 'json', mediaPath])).toString());
        if (!Array.isArray(probe.streams) || probe.streams.length > 4) fail('Media exceeds stream limits.', 413);
        const stream = probe.streams.find(s => s.codec_type === kind);
        const duration = Number(stream?.duration || probe.format?.duration);
        if (!stream || !Number.isFinite(duration) || duration <= 0 || duration > (kind === 'audio' ? 10 : 8)) fail('Audio must be ≤10s; video ≤8s with a known duration.', 413);
        if (kind === 'video' && (!Number.isSafeInteger(stream.width) || stream.width <= 0 || !Number.isSafeInteger(stream.height) || stream.height <= 0 || stream.width * stream.height > 2073600 || Math.max(stream.width, stream.height) > 2048)) fail('Video exceeds decoded dimensions.', 413);
        const output = kind === 'audio'
          ? ['-map', '0:a:0', '-t', '10.01', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']
          : ['-map', '0:v:0', '-an', '-t', '9', '-vf', 'fps=1:start_time=0:round=near,scale=1:1', '-frames:v', '9', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'];
        const decoded = await run('ffmpeg', [...flags, '-nostdin', '-noautorotate', '-i', mediaPath, ...output], kind === 'audio' ? 650000 : 131072);
        if (!decoded.length || decoded.length > (kind === 'audio' ? 640000 : 24)) fail('Decoded media exceeds duration/frame bounds.', 413);
      } catch (error) {
        if (error.status) throw error;
        if (error.code === 'ENOENT') {
          logger.error('EmbeddingGemma2 media decoder is missing', { category: 'embeddinggemma2' });
          fail('Media validation unavailable; operator must install FFmpeg/ffprobe.', 503);
        }
        if (['EACCES', 'EPERM', 'ENOSPC', 'EDQUOT', 'EROFS', 'EIO', 'EMFILE', 'ENFILE', 'EEXIST', 'ENOTDIR', 'ELOOP'].includes(error.code)) {
          logger.error('EmbeddingGemma2 staging storage unavailable', { category: 'embeddinggemma2', metadata: { code: error.code } });
          fail('Private media staging is unavailable.', 503);
        }
        fail('Media could not be decoded within limits.');
      } finally {
        try { await staging.remove(name); } catch (error) {
          logger.error('EmbeddingGemma2 staging cleanup failed', { category: 'embeddinggemma2', metadata: { errorName: error.name } });
          throw error;
        }
      }
    }
    return { filename, mime, bytes: file.buffer.length };
  }
  async clearStaging() {
    const staging = new Files(path.join(this.root, 'staging'));
    await staging.init();
    const directory = await fs.opendir(staging.root);
    let count = 0;
    for await (const entry of directory) {
      if (++count > 8) throw new Error('Pilot staging recovery exceeds bounded allowance');
      if (!/^[a-f0-9]{48}$/.test(entry.name)) throw new Error('Unexpected staging entry');
      await staging.remove(entry.name);
    }
  }
}
module.exports = { Files, FORMATS, signature };
