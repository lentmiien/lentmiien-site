# Kardashev Civilizations

`games/kardashev/` is a standalone, English-language cinematic introduction to the Kardashev scale. The main server discovers the folder when it starts, lists it on `/games`, and serves the experience at `/kardashev/`.

## Experience

- Twelve navigable scenes form an approximately ten-minute arc: the 1964 SETI origin, humanity around K ≈ 0.73, Type I, the cislunar industrial threshold, Type II and Dyson swarms, stellar-scale materials and waste heat, Type III, galactic light lag, and a future-facing finale.
- The scene mix is eight story chapters, three short multiple-choice discoveries, and one finale. Each discovery has three plausible choices and explanatory, non-shaming feedback.
- Nine original cinematic images are local 1600×900 WebPs. Quiz scenes deliberately return to a relevant chapter image so the question feels like a narrative pause rather than a new spectacle.
- Every scene has English Piper Lessac narration, an exact transcript, replay/mute controls, and an audio progress indicator. WAV masters and browser-ready MP3 exports are both retained.
- The story panel can be hidden for artwork-and-narration mode. Discovery scenes force it visible, then the viewer’s stored preference resumes on the next scene.
- Transcripts, navigation, direct progress, sound, help, and panel controls stay available while the story panel is hidden.
- Artwork crossfades, restrained spectral motion, and tone-specific accents support the scale changes. `prefers-reduced-motion` removes decorative animation and camera movement.

## Controls

| Action | Control |
| --- | --- |
| Previous / next scene | On-screen controls or `←` / `→` |
| Answer a discovery | `1`, `2`, or `3` |
| Replay narration | `R` |
| Toggle transcript | `C` |
| Toggle narration sound | `M` |
| Show / hide story panel | `P` |
| Close transcript | `Escape` |

The opening action is the required browser audio gesture. Failed audio and transcript requests fall back to readable UI copy. Access to `localStorage` is wrapped so private or embedded contexts remain usable.

## Structure

```text
kardashev/
├── README.md
├── index.html
├── css/styles.css
├── js/
│   ├── story.js
│   └── app.js
└── assets/
    ├── images/
    │   ├── GENERATED-ASSETS.md
    │   └── *.webp
    └── audio/
        ├── README.md
        ├── *.txt
        ├── *.mp3
        └── source-wav/*.wav
```

`story.js` contains presentation data only and exposes `window.STORY_SLIDES`. `app.js` owns navigation, quiz state, panel preference, image transitions, transcript loading, narration, accessibility announcements, and the decorative canvas atmosphere.

## Research and interpretation

The story uses the common modern thresholds of approximately 10¹⁶, 10²⁶, and 10³⁶ watts while explicitly noting that Kardashev’s 1964 numerical classes differed. Humanity’s K ≈ 0.73 is presented as an estimate because energy-accounting conventions vary. Current measured anchors come from the IEA, NASA, IAU, IPCC, and U.S. Department of Energy; speculative engineering is framed as inference and artist interpretation. The in-experience information dialog links the full research trail.

The scale is treated as an energy-and-detectability axis, never as a measure of moral worth. Type I emphasizes biosphere stewardship and resilience, Type II uses a distributed swarm rather than a rigid shell, and Type III is presented as a delay-tolerant civilizational ecology rather than a synchronized empire.

## Visual and audio systems

The page imports `/css/color-theme.css`. Graphite remains the base, Ember is reserved for primary actions, and Golden Amber carries links and focus. Scene-specific blue, violet, lunar, and stellar colors are decorative accents only.

Images were generated with the built-in image-generation tool and optimized locally with FFmpeg/libwebp. See `assets/images/GENERATED-ASSETS.md` for prompts, focal notes, and caveats.

English narration uses local Piper voice `en_US-lessac-medium`. WAV masters are preserved; MP3 playback uses `libmp3lame` VBR quality 2. See `assets/audio/README.md` for durations and verification details.

## Validation

Focused checks:

```bash
npm test -- tests/unit/kardashevGame.test.js --runInBand --coverage=false
node --check games/kardashev/js/story.js
node --check games/kardashev/js/app.js
```

Do not use `npm start` as a routine smoke test in this repository; its prestart process mutates generated and database data.
