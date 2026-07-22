# SVERIGE · 光と余白の国へ

`sweden_journey` is a standalone, Japanese-language visual introduction to Sweden. The main server discovers the folder automatically, lists it on `/games`, and serves it at `/sweden_journey/` after restart.

## Experience

- Eight original cinematic environments cover geography, Viking Age trade, the Vasa era, democracy, Sápmi and nature, fika, inventions and the Nobel Prize, and modern music.
- Twelve navigable scenes combine eight story chapters, three optional multiple-choice discoveries, and a finale.
- Every scene has Japanese Voicevox narration, an exact transcript, replay and mute controls, and a visible audio-progress indicator.
- Backgrounds crossfade with a restrained atmosphere layer. `prefers-reduced-motion` disables movement and particles.
- Arrow controls and the progress rail revisit any scene. Keyboard shortcuts are `←` / `→` to travel, `1`–`3` to answer, `R` to replay narration, `C` for captions, and `M` for sound.
- The source dialog links to the Swedish Government, Swedish Institute, Sámi Parliament, Vasa Museum, Uppsala University, Nobel Prize, and NATO material used to check the story.

## Structure

```text
sweden_journey/
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

`story.js` is content-only and exposes `window.STORY_SLIDES`. `app.js` owns navigation, quizzes, image transitions, captions, narration, audio cues, accessibility state, and the canvas atmosphere.

## Visual system

The standalone page imports `/css/color-theme.css`. Graphite surfaces, Ember actions, Golden Amber focus and highlights, and semantic Jade feedback follow the site theme. Swedish blue and yellow are used as subject-specific decorative colors rather than replacing the shared action hierarchy.

All generated images are saved as 1600×900 WebP at quality 86. Their prompts are recorded in `assets/images/GENERATED-ASSETS.md`.

## Voice assets

Japanese narration uses the local Voicevox `ja_shikoku_metan_normal` voice. WAV masters are retained, while browser playback uses high-quality `libmp3lame` VBR quality 2 exports. See `assets/audio/README.md` for durations and naming.
