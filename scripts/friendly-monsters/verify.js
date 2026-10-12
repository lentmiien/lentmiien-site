#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const core = require('../../games/friendly-monsters/core');
const root = path.resolve(__dirname, '../../games/friendly-monsters');
const integrityFile = path.join(__dirname, 'asset-integrity.json');

async function verify() {
  const book = core.validateBook(JSON.parse(fs.readFileSync(path.join(root, 'story.json'), 'utf8')));
  const beats = book.chapters.flatMap(c => c.beats);
  const referenced = new Set(beats.flatMap(b => [b.background, ...b.sprites, b.audio]));
  const files = [];
  const all = ['images', 'audio'].flatMap(dir => fs.readdirSync(path.join(root, 'assets', dir)).map(name => `assets/${dir}/${name}`)).sort();
  for (const relative of all) {
    if (!referenced.has(relative)) throw new Error(`Unreferenced release asset: ${relative}`);
    const file = path.join(root, relative);
    if (fs.lstatSync(file).isSymbolicLink() || !fs.realpathSync(file).startsWith(root + path.sep)) throw new Error(`Unconfined asset: ${relative}`);
    const buffer = fs.readFileSync(file);
    const entry = { path: relative, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
    if (relative.endsWith('.webp')) {
      const metadata = await sharp(buffer).metadata();
      entry.width = metadata.width; entry.height = metadata.height; entry.alpha = metadata.hasAlpha;
      const sprite = !/\/(bg|cg)\d+\.webp$/.test(relative);
      if (metadata.format !== 'webp' || (sprite && !metadata.hasAlpha)) throw new Error(`Invalid image: ${relative}`);
      // Full decode also catches damaged image payloads.
      await sharp(buffer).stats();
    } else {
      execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    files.push(entry);
  }
  if (referenced.size !== files.length) throw new Error('Referenced asset missing');
  const source = fs.readFileSync(path.join(__dirname, 'story.txt'), 'utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#')).join('');
  const spoken = book.chapters.map((c, i) => c.beats.map(b => b.text).join('').replace(`第${i + 1}章。${c.title}。`, '')).join('');
  if (source !== spoken) throw new Error('Narration does not exactly cover the script');
  if (process.argv.includes('--write')) fs.writeFileSync(integrityFile, JSON.stringify(files, null, 2) + '\n');
  else if (JSON.stringify(files) !== JSON.stringify(JSON.parse(fs.readFileSync(integrityFile, 'utf8')))) throw new Error('Asset integrity mismatch');
  console.log(`Verified ${book.chapters.length} chapters, ${beats.length} fully narrated beats, ${files.length} confined/decoded assets; script coverage exact.`);
}
verify().catch(error => { console.error(`Friendly Monsters verification failed: ${error.message}`); process.exitCode = 1; });
