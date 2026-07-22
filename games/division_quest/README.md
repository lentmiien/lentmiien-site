# Divide & Shine: The Lantern Garden

`division_quest` is a standalone, voice-first division game for young learners. It is discovered automatically by the site's `/games` route and is served at `/division_quest`.

## Learning flow

1. Share a total fairly across a known number of lanterns.
2. Make equal groups of a known size and count the groups.
3. Use equal hops on a number line to reach zero.
4. Connect multiplication and division as a fact family.
5. Solve six scaffolded practice problems.
6. Continue in an adaptive endless mode that gradually grows from facts using 2 and 3 through the full 10-times table.

The game uses whole-number problems without remainders. A wrong answer never removes progress: Lumi speaks a strategy-specific hint and the current model reveals its counting step so the learner can try again.

## Voice and accessibility

- Lesson narration, prompts, hints, feedback, and every number from 0 through 100 are local audio files.
- Dynamic problems are spoken by sequencing reusable MP3 phrase and number clips.
- The voice is Piper's English `en_US-lessac-medium` voice.
- MP3 files use FFmpeg's `libmp3lame` encoder at VBR quality 2.
- Original WAV sources are retained in `assets/audio/source-wav/`.
- `assets/audio/audio-script.json` records the exact narration script and number range.
- All controls have accessible names, guidance is also captioned, status changes use live regions, and answer choices support touch, mouse, and keys 1–3.
- `H` shows a hint and `R` repeats the current problem. Reduced-motion preferences are honored.

## Structure

```text
division_quest/
├── index.html
├── css/game.css
├── js/game.js
└── assets/
    ├── images/
    │   ├── lantern-garden.webp
    │   └── lumi.webp
    └── audio/
        ├── audio-script.json
        ├── *.mp3
        └── source-wav/*.wav
```

The two WebP illustrations are original generated assets created for this game. All teaching diagrams, star-seed animations, particles, feedback effects, and UI icons are rendered locally with HTML, CSS, and inline SVG.
