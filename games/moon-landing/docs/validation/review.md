# Realism review — three sessions

Reviewed 2026-10-04, against NASA photographs AS11-40-5927, AS11-44-6574,
AS11-37-5454, and AS11-40-5864, and the Apollo Lunar Surface Journal dust notes.
Grades below are subjective visual assessments, not measured physical fidelity.
Exactly three visual review sessions were used. Automated functional checks
also ran while correcting issues; they are not additional realism reviews.

## Session 1 — first implementation

**6/10.** The silhouette, ladder, engine bell, four pads, and black sky read as
an Apollo scene, but the materials and ground did not earn top marks.

Observed: excessively smooth ascent-stage shading, plain gold blankets, coarse
surface noise, an unnatural ring of rocks around touchdown, and weak dust.

Applied: sharpened panel normals, procedural foil crease normals and reflectance,
dark upper blanket panels, filtered surface grain, a continuous rock distribution,
and a larger ballistic dust population. Removed deprecated renderer settings.
Paused rendering and shadow maps no longer redraw unnecessarily.

## Session 2 — material, terrain, and camera review

**7/10.** Foil and panel edges improved. The fixed surface camera exposed a
terrain datum error that was difficult to see from above: flattening to zero
had raised the landing site above its surroundings. This was unacceptable for
the requested resting-on-the-surface result.

Applied: normalize terrain against its actual origin before grading the landing
area; add regression assertions that nearby terrain is within one metre of the
site. Move the fixed observer to a clear view. Use crease-aware normals, soften
exhaust silhouette edges, add distant crater relief and small regolith pits,
and adjust the phone composition. The commander-window camera now follows the
spacecraft attitude. Radar altitude now accounts for the actual local ground.

## Session 3 — final descent, settling, and responsive review

**8/10 as an interactive browser visualization; not top marks for photorealism.**
The corrected terrain places the pads on the regolith, the long shadow meets
the craft, the engine stops before contact, and the final state stays still.
The stronger Apollo silhouette and material separation are clear. Portrait
controls fit. Exhaust is appropriately subtle against the surface.

Remaining review feedback: the dust veil was still too faint, close-ground pits
were too dense, and short landscape screens left too little unobstructed scene
space. Applied the final adjustments from this review: increase the optical
weight of the bounded grain ensembles and the slow post-cutoff population,
reduce small-pit density/depth, and collapse landscape telemetry and controls.
The subsequent automated check asserts that landscape instruments clear the
playback console. No fourth subjective review was performed.

Limits: the NASA visualization mesh still has visible facets and simplified
hardware; procedural regolith is not a photographed or surveyed site; the foil,
exhaust, and dust are real-time approximations. Ground lighting does not include
full ray-traced interreflection or terrain self-shadowing. The descent is a
bounded illustrative controller, not historical telemetry or a training model.

## Checks and evidence

- Final focused Jest run: **25 tests passed**.
- Full repository run: **355 suites passed; 4,416 tests passed**; 6 suites and
  103 tests skipped by the repository. Coverage thresholds passed. This broad
  run preceded the final ground-datum regression addition; the final focused
  run includes it.
- Chromium **148.0.7778.96**, WebGL 2 / software GPU, at 1440×1000, 390×844,
  and 844×390. The in-app Browser was unavailable; local Chromium supplied the
  visual review and interaction checks.
- Automated UI checks: start / pause / 5× playback / end / replay; all cameras;
  keyboard shortcuts; hide / restore instruments; mission notes and Escape;
  responsive layout; denied model loading and unavailable WebGL fallbacks.
- No unexpected browser errors or warnings. No runtime third-party requests.
- Numerical landing: about **111.48 s**, **2.00 m/s** contact speed, **1,317 kg**
  remaining propellant; observed for 24 seconds afterward.

The accompanying images are captures of the final implementation from the
functional verification, after the adjustments above:

- `01-preview.webp`: initial 24 m composition.
- `02-one-kilometre.webp`: start of the requested flight segment.
- `03-final-approach.webp`: low approach with powered descent.
- `04-surface-approach.webp`: surface observer looking at the engine / legs.
- `05-touchdown.webp`, `06-dust-settling.webp`, `07-at-rest.webp`: cutoff through rest.
- `08-onboard.webp`, `09-wide.webp`: other inspection cameras.
- `10-phone.webp`, `11-phone-landed.webp`, `12-landscape.webp`: responsive layouts.

`browser-check.cjs` recreates screenshots and `browser-results.json` using an
isolated static preview, without starting the application's database lifecycle.
