#!/usr/bin/env python3
"""Compile reviewed fiction; optionally synthesize serially using the local TTS skill.
No credentials, application imports, database access, or external service calls.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GAME = ROOT / 'games/friendly-monsters'
WORK = ROOT / 'tmp_data/friendly-monsters'
VOICE = 'ja_shikoku_metan_normal'
TITLE = 'ともだちと、とんでもない幸運'


def compile_story():
    descriptions = json.loads((Path(__file__).parent / 'art-descriptions.json').read_text())
    chapters = []
    scene_count = 0
    for line in (Path(__file__).parent / 'story.txt').read_text().splitlines():
        if line.startswith('# '):
            chapters.append({'title': line[2:], 'beats': []})
        elif line.startswith('## '):
            background, cast = line[3:].split('|')
            background = background.strip()
            sprites = [s.strip() for s in cast.split(',') if s.strip()]
            scene_count += 1
        elif line.strip():
            # A paragraph remains complete in the source; playback chunks end at
            # Japanese sentence punctuation, including a following closing quote.
            sentences = re.findall(r'.+?[。！？](?:[」』])?|.+$', line)
            chunks = []
            for sentence in sentences:
                if chunks and len(chunks[-1]) + len(sentence) <= 100:
                    chunks[-1] += sentence
                else:
                    chunks.append(sentence)
            for chunk in chunks:
                if len(chunk) > 220:
                    raise ValueError('Narration chunk exceeds player bound')
                c = len(chapters)
                b = len(chapters[-1]['beats']) + 1
                digest = hashlib.sha256((VOICE + '\n' + chunk).encode()).hexdigest()[:12]
                name = f'c{c:02}-b{b:03}-{digest}'
                chapters[-1]['beats'].append(dict(text=chunk, scene=scene_count,
                    background=f'assets/images/{background}.webp', artDescription=descriptions[background],
                    sprites=[f'assets/images/{s}.webp' for s in sprites],
                    audio=f'assets/audio/{name}.mp3', duration=0))
    for number, chapter in enumerate(chapters, 1):
        first = chapter['beats'][0]
        first['text'] = (TITLE + '。' if number == 1 else '') + f'第{number}章。{chapter["title"]}。' + first['text']
        digest = hashlib.sha256((VOICE + '\n' + first['text']).encode()).hexdigest()[:12]
        first['audio'] = f'assets/audio/c{number:02}-b001-{digest}.mp3'
    return {'version': 1, 'title': TITLE, 'voice': 'VOICEVOX:四国めたん', 'chapters': chapters}


def run(args):
    WORK.mkdir(parents=True, exist_ok=True)
    (GAME / 'assets/audio').mkdir(parents=True, exist_ok=True)
    book = compile_story()
    beats = [b for c in book['chapters'] for b in c['beats']]
    generated = 0
    for i, beat in enumerate(beats):
        mp3 = GAME / beat['audio']
        name = mp3.stem
        wav = WORK / f'{name}.wav'
        text_file = WORK / f'{name}.txt'
        if args.narrate and not mp3.exists() and (not args.limit or generated < args.limit):
            text_file.write_text(beat['text'])
            if not wav.exists():
                # Foreground and strictly sequential: the next process starts only
                # after this skill process has exited. The skill also holds a lock.
                result = subprocess.run([sys.executable, str(args.tts_script), '--voice', VOICE,
                    '--text-file', str(text_file), '--output', str(wav)], capture_output=True, text=True)
                if result.returncode:
                    raise RuntimeError(result.stderr.strip())
                info = json.loads(result.stdout)
                if info.get('duration_seconds', 0) <= 0:
                    raise RuntimeError('TTS returned an empty clip')
            try:
                subprocess.run(['ffmpeg', '-loglevel', 'error', '-nostdin', '-n', '-i', str(wav),
                    '-codec:a', 'libmp3lame', '-q:a', '2', str(mp3)], check=True)
            except Exception:
                mp3.unlink(missing_ok=True)
                raise
            generated += 1
            print(f'Narration {i + 1}/{len(beats)}: {name}', flush=True)
        if mp3.exists():
            info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'a:0',
                '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', str(mp3)]))
            if info['streams'][0]['codec_name'] != 'mp3':
                raise ValueError('Unexpected audio codec')
            beat['duration'] = round(float(info['format']['duration']), 3)
    images = {p for b in beats for p in [b['background'], *b['sprites']]}
    missing_images = sorted(p for p in images if not (GAME / p).is_file())
    missing_audio = [b['audio'] for b in beats if not b['duration']]
    report = dict(chapters=len(book['chapters']), scenes=max(b['scene'] for b in beats),
        japaneseCharacters=sum(len(b['text']) for b in beats), narrationChunks=len(beats),
        durationSeconds=round(sum(b['duration'] for b in beats), 3),
        generatedAudio=len(beats) - len(missing_audio), imageCount=len(images),
        missingImages=missing_images, missingAudio=missing_audio)
    (WORK / 'inventory.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    if not missing_audio and not missing_images:
        (GAME / 'story.json').write_text(json.dumps(book, ensure_ascii=False, indent=2) + '\n')
        (Path(__file__).parent / 'inventory.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(report, ensure_ascii=False), flush=True)
    else:
        print(f'Pending: {len(missing_audio)} audio, {len(missing_images)} images. Release manifest not written.', flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--narrate', action='store_true')
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--tts-script', type=Path, default=Path.home() / '.codex/skills/generate-local-tts/scripts/generate_tts.py')
    args = parser.parse_args()
    try:
        run(args)
    except Exception as exc:
        print(f'Friendly Monsters build failed: {exc}', file=sys.stderr)
        sys.exit(1)
