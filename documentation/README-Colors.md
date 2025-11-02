# Brand and UI Color System

This document defines the dark-first color system that aligns with your mascot (catgirl with twin tails, golden-amber eyes, Graphite outfit with Ember trims). It includes tokens, usage guidance, accessibility notes, and quick mappings for common UI components and icons.

## Brand anchors
- Dark neutral base: Graphite family
- Primary action color: Ember (#FF6A1F)
- Spark/highlight color: Golden Amber (#FFC247) — mirrors the mascot’s eye color
- Accent glows and focus: Golden Amber
- Optional semantic hues: Jade, Citrine, Vermilion, Aqua

## Core palette (hex)
- Background and surfaces
  - Background: #0E0F13
  - Surface-1 (cards/panels): #171A20
  - Surface-2 (elevated): #1B2026
  - Surface-3 Graphite (nav/header/hero): #20242A
  - Border: #262B34
  - Divider (hairlines): #2B313C

- Brand
  - Ember (Primary/CTA): #FF6A1F
  - Ember Hover: #FF7C3B
  - Ember Active: #E05F1C
  - Ember Tint (bg/overlays): rgba(255, 106, 31, 0.14)

- Spark / Accent
  - Golden Amber: #FFC247
  - Amber Hover: #FFD36F
  - Amber Active: #E6A92D
  - Amber Tint: rgba(255, 194, 71, 0.18)

- Text on dark
  - Text Primary: #E8ECF2
  - Text Secondary: #C1C7D3
  - Text Muted: #9AA3B2
  - Inverse on light: #111418

- Optional semantic
  - Success (Jade): #17C696
  - Warning (Citrine): #FFC63D
  - Danger (Vermilion): #FF4D4F
  - Info (Aqua): #19E3E3

- Illustration backgrounds (neutral)
  - Soft graphite gray gradient: #D9D9E0 → #C7CCD6
  - Deep charcoal gradient: #14161A → #0E0F13

## Design tokens (CSS variables)
```css
:root {
  /* Neutrals */
  --bg: #0E0F13;
  --surface-1: #171A20;
  --surface-2: #1B2026;
  --surface-3: #20242A; /* Graphite */
  --border: #262B34;
  --divider: #2B313C;

  /* Text */
  --text: #E8ECF2;
  --text-secondary: #C1C7D3;
  --text-muted: #9AA3B2;
  --text-inverse: #111418;

  /* Brand */
  --brand: #FF6A1F;       /* Ember */
  --brand-hover: #FF7C3B;
  --brand-active: #E05F1C;
  --brand-tint: rgba(255,106,31,0.14);

  /* Accent / Spark */
  --accent: #FFC247;      /* Golden Amber */
  --accent-hover: #FFD36F;
  --accent-active: #E6A92D;
  --accent-tint: rgba(255,194,71,0.18);

  /* Semantic */
  --success: #17C696;
  --warning: #FFC63D;
  --danger: #FF4D4F;
  --info: #19E3E3;

  /* Focus ring */
  --focus: #FFC247;       /* Golden Amber */
}
```

## Component mapping (quick start)
- Primary Button
  - Background: var(--brand)
  - Text: var(--text-inverse)
  - Hover/Active: var(--brand-hover) / var(--brand-active)
  - Focus: 2–3px outline var(--focus)

- Secondary Button
  - Background: transparent
  - Border: 1–2px var(--brand)
  - Text: var(--brand)
  - Hover: background var(--brand-tint)

- Link
  - Default: var(--accent)
  - Hover/Active: var(--accent-hover) / var(--accent-active)
  - Do not color links in Ember when a primary button is nearby (reduces visual conflict)

- Inputs
  - Background: var(--surface-1)
  - Border: var(--border)
  - Text: var(--text)
  - Placeholder: var(--text-muted) at 80% opacity
  - Focus: 2–3px outer ring var(--focus)

- Cards/Panels
  - Background: var(--surface-1)
  - Border: 1px var(--border)
  - Headers: var(--surface-3) if you want a darker cap

- Navigation
  - Bar: var(--surface-3)
  - Active item: Ember dot/stripe + text var(--text) or var(--brand)
  - Hover: background tint (var(--brand-tint) or var(--accent-tint) at 8–12%)

- Icons
  - Neutral stroke/fill: var(--text) on dark
  - Active states: var(--brand) or var(--accent)
  - Chatbot avatar ring: var(--accent) 2–3px, optional small Ember notch

- Data Visualization
  - Highlight series: var(--accent)
  - Other series: #4656FF (Indigo), #17C696 (Jade), #FF7E79 (Coral), #4A6BFF (Slate Blue)
  - Gridlines: var(--divider); Axes: var(--text-secondary)

## Accessibility
- Contrast targets: 7:1 for body text on surfaces, 4.5:1 for secondary text.
- Ember as button fill requires dark text (var(--text-inverse) #111418), not white.
- Avoid Amber text on Ember background; use dark text or separate with neutral surfaces.
- Focus ring: 2–3px Amber outside the element (visible against all surfaces).

## Gradients and glow
- Use sparingly for hero art and illustrations.
- Recommended gradient: Ember → Golden Amber at ~18–24°, or a subtle radial glow behind the mascot.
- For UI controls, prefer flat fills; micro-glows are reserved for indicators and active states.

## Mapping to the mascot
- Hair/outfit base echo Graphite surfaces.
- Eyes = Golden Amber; reuse for links, focus, small indicators.
- Outfit trims = Ember; reuse for primary CTAs and active toggles.
- Micro-glows = Golden Amber; match eye spark in illustrations and icons.

## Light-mode note (optional)
- If you introduce light mode later, invert neutrals and use Ember/Amber at reduced saturation; retain Amber for focus to preserve identity.

## Examples
- Primary CTA: Ember background, dark text, Amber focus ring.
- Link in body text: Golden Amber. If near a CTA, keep links Amber and the CTA Ember.
- Alert/Warning: Citrine background tint (10–14%), Amber icon, dark text.

## Maintenance
- Prefer adjusting lightness ±6–8% for hover, ±12–16% for active.
- Keep tints between 10–18% opacity to avoid muddy overlays.
- Test chart colors for color-blind safety; keep series distinguishable by lightness and dash patterns.