# Visual Guided Tour Page — Reusable Prompt Template

Replace every `{{PLACEHOLDER}}` before using this prompt. Delete lines that do not apply. The `OPTIONAL_DETAILS` field may override any default below.

## Project inputs

- `TOPIC`: {{TOPIC}}
- `APP_SLUG`: {{APP_SLUG}}
- `DISPLAY_TITLE`: {{DISPLAY_TITLE}}
- `COVERAGE_SCOPE`: {{COVERAGE_SCOPE}}
- `LANGUAGE_MODE`: {{English | Japanese | English + Japanese}}
- `TARGET_EXPERIENCE`: {{for example: 6–8 minutes, 8 core chapters, 2–3 quizzes, and a finale}}
- `AUDIENCE`: {{AUDIENCE}}
- `VISUAL_DIRECTION`: {{VISUAL_DIRECTION, or "derive an original direction from the topic"}}
- `OPTIONAL_DETAILS`: {{OPTIONAL_DETAILS, or "none"}}

---

I want to create a polished, cinematic visual introduction and guided tour about **{{TOPIC}}** in this repository.

This is primarily an entertaining audiovisual presentation, not a conventional game. A few short multiple-choice discoveries should preserve a light game feel, but they must support the narrative rather than dominate it.

Create the complete standalone app under `games/{{APP_SLUG}}/`, including all required code, generated images, narration, transcripts, documentation, tests, and resource subfolders. Implement and validate the experience; do not stop at a proposal or mockup.

## Creative brief

Use `games/sweden_journey/` as the interaction and quality reference. Study its scene-based storytelling, full-screen generated artwork, narration controls, lightweight quizzes, progress navigation, responsive presentation, and source notes. Create an original identity suited to **{{TOPIC}}**; do not reuse Sweden-specific copy, branding, images, facts, or decorative motifs.

The display title is **{{DISPLAY_TITLE}}**. Cover the following breadth and depth:

**{{COVERAGE_SCOPE}}**

Target experience:

**{{TARGET_EXPERIENCE}}**

Design for:

**{{AUDIENCE}}**

Additional requirements or preferences:

**{{OPTIONAL_DETAILS}}**

When a minor decision is unspecified, make a sensible, documented choice and keep moving. Ask only when a missing decision would materially change the requested experience.

## Language mode

Build the complete UI, narration scripts, transcripts, accessibility labels, metadata, quiz copy, feedback, help text, and source notes in:

**{{LANGUAGE_MODE}}**

Apply these rules:

- For `English`, use natural, polished English throughout.
- For `Japanese`, use natural Japanese written for listening as well as reading. Give unfamiliar names and terms pronunciations that work well in speech synthesis.
- For `English + Japanese`, provide a clearly labeled language choice on the opening screen and an always-available in-experience switch. Persist the choice, update the document language, and localize every user-facing string. Give each language its own narration and exact transcript assets; do not mix languages except when intentionally teaching a local word or name.
- In bilingual mode, switching language on a scene must safely replace that scene's narration and transcript without losing navigation or quiz progress.
- Local or specialist terms may appear in their original language when helpful, followed by a concise explanation in the selected UI language.

## Research and story

Research before writing. Because facts, boundaries, records, laws, population figures, and current institutions may change, verify them against current authoritative sources. Prefer governments, national museums, universities, statistical agencies, recognized cultural institutions, and primary historical sources. Cross-check sensitive or disputed claims, avoid unsupported superlatives, and clearly distinguish legend, interpretation, reconstruction, and established fact.

Shape the result as a journey with a beginning, progression, and satisfying ending rather than an encyclopedia:

1. Open with a strong sense of place and an invitation into the topic.
2. Move through the requested history, geography, people, culture, ideas, nature, achievements, or other scope in a coherent order.
3. Give each core chapter one memorable idea, a concise supporting explanation, and two to four scannable facts.
4. Include human texture: daily life, sounds, rituals, objects, food, language, or surprising connections where appropriate.
5. Treat Indigenous peoples, living communities, conflict, religion, colonialism, and contested history with accurate, respectful wording and relevant first-party sources.
6. Place short quizzes at natural narrative pauses. Use three plausible answer choices, explain the answer after selection, and never shame a wrong answer. Quiz narration should invite an answer without revealing it.
7. End with a concise reflection or finale that connects the chapters and allows a restart.

Keep on-screen prose compact enough for the image to remain important. Put richer storytelling into the narration without making the visual panel feel like a transcript.

## Generated visual assets

Use the available `$imagegen` skill to create multiple original raster images specifically for this experience.

- Establish one coherent art direction based on **{{VISUAL_DIRECTION}}**.
- Generate at least one purposeful 16:9 scene for each major topic unless a deliberate visual callback is stronger.
- Favor cinematic composition, depth, atmosphere, and a clear focal subject. Avoid generic travel-poster repetition.
- Keep important subjects visible under both left- and right-aligned desktop panels and within mobile crops. Record any scene-specific focal positioning needed by the UI.
- Do not put captions, labels, flags with invented details, signatures, watermarks, or pseudo-text into generated images.
- For historical scenes, specify the era, setting, clothing, materials, and technology carefully. Present reconstructions as artistic interpretations, not documentary photographs.
- Optimize final assets as WebP at an appropriate quality and resolution, normally around 1600×900, while preserving the generated originals only when useful.
- Save a concise asset manifest containing each filename, scene purpose, generation prompt, dimensions, and any historical caveat.
- Do not depend on third-party image URLs at runtime.

Use subject-specific color and atmosphere as accents while keeping this repository's Graphite, Ember, and Golden Amber UI hierarchy from `documentation/README-Colors.md`.

## Narration and audio

Write narration as a guided performance: warm, varied in rhythm, vivid, factually grounded, and comfortable to hear. Avoid simply reading fact cards aloud.

Use the available `$generate-local-tts` skill for every requested language and `$convert-wav-to-mp3` for browser-ready audio, following each skill's supported voices and workflow.

- Create one narration script per scene, including quiz and finale scenes.
- Keep every transcript exactly aligned with its corresponding spoken script.
- Retain organized WAV masters and serve optimized MP3 files in the page.
- Use consistent voice selection and pacing within each language.
- Verify filenames, duration, audibility, and browser playback for every scene.
- Start narration only after a user gesture, then support replay, mute/unmute, progress indication, and graceful recovery from blocked or failed playback.
- If both languages are requested, use a clear asset structure such as `assets/audio/en/` and `assets/audio/ja/`.
- Keep subtle interface sounds optional and subordinate to narration.
- Do not call external speech or media services at runtime.

## Required experience and UI behavior

Create a visually polished full-screen experience with:

- A cinematic opening screen with the title, a concise invitation, duration/chapter/quiz expectations, and a clear start action.
- Crossfading scene artwork, restrained atmospheric motion, and topic-specific transitions that do not interfere with reading.
- A glass-like information/story panel containing the current chapter's title, concise copy, facts, local term, narration state, and quiz when applicable.
- Previous/next controls, scene count, chapter label, and direct progress navigation.
- Narration replay and sound controls.
- Optional captions/transcript that can be opened and closed independently of the information panel.
- An information dialog explaining controls, generated-media disclosure, narration disclosure, and linked sources.

The information panel must support an image-and-narration viewing mode:

- Provide a discoverable show/hide button and a keyboard shortcut.
- Default to visible for a first-time viewer and remember the viewer's preference when practical.
- Hiding the panel must not pause narration or remove navigation, sound, caption, progress, or language controls.
- Reduce panel-oriented gradients or shading while hidden so the artwork is genuinely more visible, especially on small screens.
- Every quiz scene must automatically reveal the information panel so the question can be answered. Prevent it from being hidden while the quiz requires interaction.
- If the viewer preferred the panel hidden, restore that hidden state automatically after leaving the quiz.
- Keep control labels, `aria-pressed` state, focus behavior, and screen-reader announcements synchronized with the actual panel state.

In bilingual mode, the language switch must remain available whether the information panel is shown or hidden.

## Responsive, accessible, and technical requirements

- Follow the repository's `AGENTS.md` and neighboring standalone-game conventions.
- Import `/css/color-theme.css` and use the documented global theme tokens. Subject colors are decorative accents, not replacements for action, focus, or semantic colors.
- Use semantic HTML, visible focus, useful landmarks, appropriate ARIA, polite status announcements, and touch targets suitable for mobile.
- Support keyboard navigation, quiz number keys, narration replay, captions, sound, and panel visibility. Document the shortcuts in the help dialog.
- Respect `prefers-reduced-motion`; remove decorative animation without removing content or functionality.
- Make the experience work at narrow phone widths and short landscape heights. Ensure the hidden-panel mode reveals a meaningful portion of every image on small devices.
- Account for safe-area insets, long translations, Japanese line breaking, and browser audio restrictions.
- Preload only the opening artwork initially, then warm later assets without blocking first render.
- Keep all runtime assets local and avoid adding dependencies unless they are clearly necessary.
- Keep story/localization data separate from interaction code so future content and language changes remain manageable.
- Handle unavailable `localStorage`, missing audio, and failed transcript fetches gracefully.
- Do not run `npm start` as a routine smoke test because this repository's prestart process mutates data.

Use a structure similar to:

```text
games/{{APP_SLUG}}/
├── README.md
├── index.html
├── css/
│   └── styles.css
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
        └── source-wav/
            └── *.wav
```

Adapt the structure for language-specific subfolders when `English + Japanese` is selected.

## Validation and completion

Add a focused Jest test under `tests/unit/` that verifies at minimum:

- the standalone localized shell and essential controls;
- the intended number and type of scenes and quizzes;
- every referenced image, transcript, MP3, and WAV exists and is non-empty;
- panel show/hide behavior is implemented and quizzes force the panel visible;
- narration, captions, keyboard controls, and reduced-motion support are present;
- bilingual asset coverage and language switching, when applicable.

Run the focused test and syntax checks for changed JavaScript. Review the app at desktop, narrow mobile, and short landscape dimensions when browser tooling is available. Check the final diff for accidental or unrelated changes.

Finish by reporting:

- the app path and route;
- the narrative scope and scene count;
- language and voice choices;
- generated image and audio asset counts;
- panel and quiz behavior;
- tests run and their results;
- any limitations or deliberate creative choices.

Do not commit or push unless **{{OPTIONAL_DETAILS}}** explicitly requests it.
