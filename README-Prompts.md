# Prompt Library (Icons and Illustrations)

This document contains four prompt templates tailored to your brand and mascot. Each has placeholders, usage guidance, and example values. The palette is Graphite #20242A, Ember #FF6A1F, and Golden Amber #FFC247.

Templates
- A) Generic tool icons (no character, no text)
- B) Character tool icons (with reference image)
- C) General illustrations (no character)
- D) Character illustrations (with reference image)

Global tips
- Always forbid text: add “no letters, no words, no numbers, no logos” and include it in negative prompts or model-specific “--no” parameters.
- Keep icons simple: vector-like, minimal shading, solid shapes, readable at 24–32 px.
- For reference-guided prompts, set identity/style strength high enough to preserve the mascot but not the source composition.

## A) Generic tool icons (no character)

Goal: flat pictograms for your tools, in-brand, 1:1.

Template:
```
High-detail, brand-aligned flat pictogram icon of {{ICON_CONCEPT}}. Vector-like, minimal shading, crisp edges, high contrast, centered, 1:1. Graphite (#20242A) base or backdrop in {{BADGE_SHAPE}}, primary shapes in Ember (#FF6A1F), highlight/glow accents in Golden Amber (#FFC247). No people, no photos. No letters, no words, no numbers, no logos. Clean negative space, 2–2.5px equivalent stroke weight at 32 px, solid fills, simple geometry, readable at 24 px. Dark UI ready.

Style variant: {{RENDER_STYLE}}.

Negative prompt: text, letters, words, numbers, typography, watermark, signature, UI screenshot, photo, photorealistic, clutter, gradient banding, excessive glow
```

Placeholders
- {{ICON_CONCEPT}} examples
  - Write blog: fountain pen nib over a blank page sheet
  - Add budget transaction: stacked coin and a small plus badge
  - Cookbook: closed cookbook with a spoon emblem
  - Knowledge: open book with a small spark
  - Cooking calendar: calendar page with fork and knife overlay
  - Batch: stacked chat/message sheets with a rightward sequence arrow
  - VUE app: layered chevrons forming a stylized V-like mark (no letters)
  - PDF to image converter: document page morphing into a picture frame (curved arrow)
  - Upload receipt: perforated receipt stub with an upward arrow
  - Product details: shipping box with a magnifying glass
  - Gallery: stacked photo frames (mountain + sun glyph)
  - Payroll: wallet with a coin
  - Emergency stock manager: alert triangle with a crate/box
  - Calendar: simple calendar with date dots (no numerals)
  - Image Generator: magic wand with sparkles and a picture frame
  - Bulk Image Generator: stack of picture frames with sparkles
  - Video Generator: clapperboard with a play triangle
- {{BADGE_SHAPE}}: circle, rounded square, no background
- {{RENDER_STYLE}}: flat pictogram, semi-flat cel-shaded, sticker-style badge

Model notes
- Midjourney: --ar 1:1 --s 300 --style raw --no text,letters,words,numbers,logo,watermark
- SDXL: 768×768 or 1024×1024, CFG 5.5–7, steps 28–35


## B) Character tool icons (with reference image)

Goal: mascot head/bust inside a badge + a tiny functional glyph (no text).

Template (prepend your reference image URL):
```
[{{REF_IMAGE_URL}}]

Mascot-based icon, 1:1. Use the reference only for identity and palette (cat ears, twin tails, golden-amber eyes). Bust/head crop in {{BADGE_SHAPE}} badge on Graphite (#20242A). Add a small, clean pictogram for {{ICON_CONCEPT}} as an overlay/side glyph in Ember (#FF6A1F) with Golden Amber (#FFC247) highlight; keep it tiny and readable. Vector-like, minimal shading, crisp edges, 2–2.5px equivalent stroke at 32 px, no text, no letters, no numbers, no logos. High contrast, centered composition, icon clarity at 24–32 px.

Style variant: {{RENDER_STYLE}}.

Negative prompt: full body, text, letters, words, numbers, watermark, signature, clutter, heavy gradients, photo, photorealistic
```

Placeholders
- {{REF_IMAGE_URL}}: URL to your chosen mascot image
- {{ICON_CONCEPT}}: speech bubble with small spark (Chat), open book (Knowledge), magic wand (Image Generator), etc.
- {{BADGE_SHAPE}}: circle, rounded square
- {{RENDER_STYLE}}: flat avatar badge, semi-flat cel-shaded avatar

Model notes
- SDXL with IP-Adapter/Reference-Only: style/identity strength 0.7–0.9
- Midjourney: prepend the image URL, then the prompt; add --ar 1:1 --s 300 --style raw --no text,letters,words,numbers,logo


## C) General illustrations (no character)

Goal: brand-themed scene art for headers/blogs.

Template:
```
High-detail anime illustration using a dark brand palette. Subject: {{SCENE_BRIEF}}. Emphasize Graphite (#20242A) forms with Ember (#FF6A1F) as primary accent and Golden Amber (#FFC247) as glow/highlight. Clean line art, semi-realistic cel shading, controlled highlights, subtle rim light. Composition: {{COMPOSITION}} with clear focal point and negative space for cropping. Background: abstract soft graphite gradient or deep charcoal, no letters, no words, no numbers, no logos.

Style variant: {{RENDER_STYLE}}.

Negative prompt: text, letters, words, numbers, signage, watermark, signature, photorealistic photo, cluttered background, low contrast
```

Placeholders
- {{SCENE_BRIEF}} examples: abstract brand crest with cat-ear silhouette and energy ribbons; isometric blogging desk tools; finance widgets morphing into coin shapes; image frames and sparkles swirling; clapperboard and frames in motion
- {{COMPOSITION}}: wide hero 16:9 with left-safe copy space, centered poster 3:4, square 1:1
- {{RENDER_STYLE}}: crisp poster-cel, soft ambient cel, high-contrast rim-lit

Model notes
- Midjourney: --ar 16:9 or 3:4 as needed --s 250–400 --style raw --no text,letters,words,numbers,logo
- SDXL: 1152×768 (16:9) or 896×1152 (3:4), CFG 5.5–7


## D) Character illustrations (with reference image)

Goal: your mascot doing things (e.g., blog post image: skiing), on-brand.

Template (prepend your reference image URL):
```
[{{REF_IMAGE_URL}}]

High-detail anime illustration of the same catgirl mascot, using the reference only for identity (cat ears, twin tails, golden-amber eyes, Graphite + Ember outfit cues). Scene: {{SCENE_ACTION}} in {{SETTING}}. Keep brand palette: Graphite (#20242A) base, Ember (#FF6A1F) accents, Golden Amber (#FFC247) glows. Outfit adapts functionally to the action while keeping the futuristic hoodie + A-line silhouette and black nickel details. Clean line art, semi-realistic cel shading, controlled highlights, soft rim light. No letters, no words, no numbers, no logos. Composition: {{COMPOSITION}} with clear subject separation.

Style variant: {{MOOD_STYLE}}.

Negative prompt: text, letters, words, numbers, watermark, signature, extra limbs, distorted anatomy, heavy bloom
```

Placeholders
- {{REF_IMAGE_URL}}: URL to the mascot reference image
- {{SCENE_ACTION}} examples: skiing down a snowy slope; writing with a glowing pen; cooking with Ember sparks; organizing a gallery wall of images; working at a terminal with Ember UI holograms
- {{SETTING}} examples: snowy mountain daylight; neon-lit city rooftop; minimalist studio with soft graphite gradient; cozy kitchen; abstract data space
- {{COMPOSITION}}: dynamic 3:4 action poster, cinematic 16:9 with motion blur, clean square 1:1
- {{MOOD_STYLE}}: energetic rim-lit, calm studio light, cinematic dusk glow

Model notes
- SDXL Reference strength 0.7–0.9; upscale after you get the right pose
- Midjourney: image URL + prompt; --style raw or niji; --s 250–400


## Examples (ready to paste)

- Generic icon (PDF to Image Converter)
```
High-detail, brand-aligned flat pictogram icon of a document page morphing into a picture frame with a curved arrow between. Vector-like, minimal shading, crisp edges, high contrast, centered, 1:1. Graphite (#20242A) base or backdrop in circle, primary shapes in Ember (#FF6A1F), highlight accents in Golden Amber (#FFC247). No people, no photos. No letters, no words, no numbers, no logos. Clean negative space, solid fills, readable at 24 px. Dark UI ready.

Style variant: flat pictogram.

Negative prompt: text, letters, words, numbers, typography, watermark, signature, photo, photorealistic, clutter
```

- Character tool icon (Chat)
```
REF_IMAGE

Mascot-based icon, 1:1. Use the reference only for identity and palette (cat ears, twin tails, golden-amber eyes). Bust/head crop in circle badge on Graphite (#20242A). Add a small speech bubble glyph as an overlay in Ember (#FF6A1F) with a tiny Golden Amber (#FFC247) spark; keep it tiny and readable. Vector-like, minimal shading, crisp edges, 2–2.5px stroke at 32 px, no text, no letters, no numbers, no logos. High contrast, centered, icon clarity at 24–32 px.

Style variant: flat avatar badge.

Negative prompt: full body, text, letters, words, numbers, watermark, signature, heavy gradients, photo
```

- General illustration (Blog header: writing)
```
High-detail anime illustration using a dark brand palette. Subject: isometric desk scene with pen, notebook, and subtle UI panels suggesting writing/blogging. Emphasize Graphite (#20242A) forms with Ember (#FF6A1F) accents and Golden Amber (#FFC247) glow highlights. Clean line art, semi-realistic cel shading, soft rim light. Composition: wide hero 16:9 with left-safe copy space. Background: abstract deep charcoal gradient, no letters, no words, no logos.

Style variant: crisp poster-cel.

Negative prompt: text, letters, words, numbers, watermark, signature, photorealistic, cluttered
```

- Character illustration (Blog post: skiing)
```
REF_IMAGE

High-detail anime illustration of the same catgirl mascot, using the reference only for identity (cat ears, twin tails, golden-amber eyes, Graphite + Ember outfit cues). Scene: skiing down a snowy slope with dynamic motion spray. Setting: bright snowy mountain daylight with cool shadows. Keep brand palette: Graphite base, Ember accents on outfit trims, Golden Amber glows in goggles reflections and eye spark. Outfit adapts for winter while keeping the futuristic hoodie + A-line silhouette and black nickel details. Clean line art, semi-realistic cel shading, controlled highlights, soft rim light. No letters, no words, no logos. Composition: dynamic 3:4 action poster with clear focal point.

Style variant: energetic rim-lit.

Negative prompt: text, letters, words, numbers, watermark, signature, extra limbs, distorted anatomy, heavy bloom
```

## Batch suggestions
- For a uniform icon set: fix {{BADGE_SHAPE}} = “rounded square” and {{RENDER_STYLE}} = “flat pictogram.”
- File naming: tool-icon_write-blog_flat-rounded-square.png
- Export sizes: 24, 32, 48, 64, 128, 256; adjust stroke weights accordingly.
- Keep a CSV/JSON map of “tool → ICON_CONCEPT” for repeatable generation.

## Troubleshooting
- If text still appears, add to negatives: typography, alphabet, Latin letters, kana, hanzi.
- If the character icon generates a full body, add “head/bust only, tight crop, large head in frame” and keep 1:1 aspect.
- If colors drift, explicitly restate hex values and limit the palette to Graphite, Ember, and Golden Amber.