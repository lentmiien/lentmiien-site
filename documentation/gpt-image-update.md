# GPT Image models and shared private library

## Security contract

- Feature/zone: GPT Image Studio, model-pinned chat tools and image/reference library; logged-in.
- Principals: validated application users. No new machine credentials or anonymous operations.
- Classification/scope: private shared library for **all authenticated site users**, approved by Lennart in request `796f5eee-98c5-46cc-a77c-d000316d951c`. No owner restriction or admin override. Legacy public media remains public.
- Capabilities: `gpt_image.library.read`, `gpt_image.library.like`, `gpt_image.generate`; explicit role bundles preserve existing logged-in access. Tools revalidate their application principal; caller-supplied identity/model overrides cannot elevate access.
- Mutations: POST with shared session CSRF token/origin validation before multipart parsing. Like IDs and reference IDs are validated.
- Bounds: 32,000 prompt characters, 1–10 outputs, 16 total references, at most 8 uploads of 12 MiB each; decoded raster and stored-byte limits; bounded concurrent generations and browser mutation rate limits.
- Output: escaped Pug/textContent, safeJson configuration, raster MIME allowlist and opaque generated filenames. No prompt text in new filenames.
- Storage: all new outputs and uploaded references outside static roots; authenticated media route checks shared-library record membership and safe file resolution. No public copies or generated variants. Symlinks are rejected in private storage and static aliases into it are blocked.
- Outbound: OpenAI Images API only; references are read locally and uploaded as bytes. No client-controlled URL fetching.
- Cache: private/no-store on studio, APIs and media (including errors); no analytics; nosniff, no-referrer and noindex headers.
- Logs: actionable failures with stable messages and bounded diagnostic codes, without prompts, filenames, usernames, credentials or provider response bodies.
- Retention: durable library; failed new writes cleaned up, no automatic legacy migration/deletion. Back up private media alongside MongoDB.
- Negative tests: unauthenticated/missing capability/invalid principal, unknown or unregistered media, traversal/symlinks/static aliases, CSRF, invalid uploads and model options, excess work and spoofed identity.
- Legacy plan: retain existing file URLs verbatim and resolve legacy references only from the existing image directory. Missing model metadata falls back to `gpt-image-2` at read time. No database rewrite.

## Model contracts and evidence

Checked **2026-09-10** against official OpenAI documentation:

- [Images generation reference](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [Images edit reference](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [GPT Image 2.5 prompting: model parameters](https://developers.openai.com/api/docs/guides/image-prompting#model-parameters)
- [Sunburst model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [Flare model](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)

| App contract | GPT Image 2 | Sunburst | Flare |
| --- | --- | --- | --- |
| Model ID | `gpt-image-2` | `gpt-image-2.5-sunburst` | `gpt-image-2.5-flare` |
| Generate / edit | Both | Both | Both |
| Quality | auto, low, medium, high | auto, low, medium, high, xhigh, max | auto, low, medium, high, xhigh, max |
| Background | auto, opaque (existing choices retained) | auto, opaque, transparent | auto, opaque, transparent |
| Studio default | selectable | **default** | selectable |
| Tool name | `generate_image` (unchanged) | `generate_image_sunburst` | `generate_image_flare` |

The generation and edit references explicitly name all three models. The Flare model overview does not list an edit endpoint, but the endpoint-specific reference explicitly supports Flare edits; implementation follows that reference and the image-generation guide. No live generation/edit requests or credential/account inspection were performed. Account access, actual output quality, latency and billing remain unverified by this release.

Both endpoints document 1–10 outputs, prompts up to 32,000 characters, PNG/JPEG/WebP, JPEG/WebP compression 0–100 and moderation auto/low. Transparent output requires PNG/WebP. New tools reject compression with PNG; the original tool retains its documented behavior of ignoring PNG compression. The app keeps its existing defaults: one output, medium quality, 1024×1024, auto background/moderation, PNG, and compression 100 when applicable. These app defaults are distinct from the API's auto defaults.

All three accept auto or custom WIDTHxHEIGHT: each edge divisible by 16 and at most 3840, aspect ratio within 1:3–3:1, 655,360–8,294,400 pixels. More than 3,686,400 pixels is experimental. Studio supports existing presets and custom dimensions; new tool schemas advertise custom sizes, while the original tool schema retains its preset choices. All server paths validate the same numeric constraints.

Edit references are supplied through the installed OpenAI SDK's multipart `image` field using `OpenAI.toFile`, as demonstrated by the guide; up to 16 references. App upload limits are stricter: 8 uploads, 12 MiB each, one raster frame and at most 41,943,040 decoded pixels; stored/provider images must be below 50 MiB. The installed SDK supports string model IDs at runtime; no SDK/dependency update is required.

`input_fidelity`, masks, streaming/partial images, style and response_format are not exposed or sent. The guide explicitly says to omit input_fidelity for GPT Image 2; per-model tunable fidelity for 2.5 is not established by the generic edit field description, so this release does not add it. GPT image output arrives as base64. Provider `user` is derived from the validated application principal for tools and Studio. The original GPT Image 2 edit compatibility retry remains intact; new models fail rather than silently dropping requested options.

## Storage and deployment

1. Deploy this commit through the normal development-to-production process; this task does not deploy or mutate production. No dependencies changed. Use pinned Node 24.20.0 and the existing lockfile (`npm ci` if installing a fresh release).
2. Configure `GPT_IMAGE_STORAGE_DIR` to a durable absolute directory, for example `/srv/lentmiien-private/gpt-image`, writable by the application user. If omitted, the default is `<application>/private_data/gpt-image`, ignored by git. Keep it outside all public, game, vendor and VUE static roots and outside disposable release/cache/tmp directories. Existing ancestors must not be symlinks. New directories/files use 0700/0600 subject to OS permissions/umask.
3. Persist this directory across releases/restarts and back it up with MongoDB. Multiple app instances must share the same media volume; configure filesystem permissions accordingly. Do not point nginx/Cloudflare/static hosting, directory aliases, backup publishing or symlinks at this tree. App static mounts additionally refuse canonical paths inside it, including compressed aliases. Do not change the configured root without transferring the private tree intact.
4. Restart the app and any workers using the new code and storage configuration. Normal startup `seedMissingToolManagerEntries` inserts the two missing tool records using `$setOnInsert`; it preserves existing original/new custom definitions and enabled states. Check production logs for failed startup seeding. No force sync or destructive reseed is needed. Existing tool descriptions in MongoDB may still mention `/img` until manually edited; their runtime uses private storage regardless. Avoid a force sync just to update that description.
5. Select the new tools in the desired chat tool configuration after they appear in `/admin/tools`; startup does not change existing conversation selections. Existing capability bundles give all authenticated users this narrowly scoped image feature; admin-tool management retains its existing authorization.
6. Exclude `/gpt-image` and descendants from proxy/CDN caching, honoring `private, no-store`. The media endpoint returns inline raster MIME, opaque filename, nosniff and no-referrer, and does not use ETags, public immutable caching or range responses. Legacy `/img/...` content and caching remain unchanged. Sharing a new image URL externally requires the recipient to log in; existing public links remain public.
7. `CSRF_ALLOWED_ORIGINS` follows the existing shared CSRF configuration. Studio uploads and likes send the session token in `X-CSRF-Token`; upload checks happen before multipart parsing. Browser limits are 5 generation requests/minute and 30 likes/minute per user. Per process, at most two generations and one generation per principal run concurrently. Multiply these bounds when sizing multiple workers/instances; these are not distributed budget controls.

No media or historical model backfill is required. The existing generation schema already has a model field; aggregation/serialization explicitly supplies the historical fallback. New uploads are held in bounded memory and written only to private storage after raster validation. No thumbnails/variants are generated by this feature. If variants are added later, they must use the same private storage and authorization.

Prompt to 3D remains on GPT Image 2. Its new image output is reused by Pixal3D through an optional `inputImage.storage = 'gpt-image'` marker and uploaded bytes, without a public duplicate. Deleting a Pixal3D job does not delete its shared GPT Image source. Legacy Pixal3D input records default to public storage; no unrelated upload or 3D-model migration is included. The existing configured Pixal3D gateway receives those bytes, just as it previously received the copied image.

Failed generations clean newly created files. If MongoDB partially inserts a batch, rollback removes only that new generation ID before deleting its files. If rollback also fails, files remain private and an actionable reconciliation error includes the generation ID. Investigate that batch before manual cleanup; do not delete historical media. Files without a library record cannot be served by the authenticated route.

Rollback must preserve the private volume and media-delivery code: old code cannot display or reuse new authenticated URLs. Prefer a forward fix or disabling the new tool selections to reverting private storage support.

## Verification

Automated checks use synthetic data, temporary directories, mocked MongoDB/OpenAI/gateway calls and local HTTP servers. They do not run app startup, setup.js against configured data, paid generations, database migrations or production commands.

The final full Jest run on pinned Node 24.20.0 passed all configured coverage thresholds: 285 suites / 2,775 tests. The focused run passed 15 suites / 163 tests; all 24 media tests also passed after the final error-handler review. Earlier runs on the shell-default Node 24.12.0 passed too. No pre-existing test failures were observed. Focused regressions cover the rendered selector, option changes, CSRF headers, private reference handoff and partial-save cleanup. Browser discovery returned no connected browser; no visual screenshot or live-provider assertion is claimed.

Live checklist for Lennart after deployment:

- [ ] Check storage ownership/persistence and startup logs; see all three selectable entries in `/admin/tools` without altered custom configurations. Confirm existing chat selections remain unchanged.
- [ ] Open Studio as a normal user: Sunburst selected, all three models listed; switching to GPT Image 2 removes xhigh/max and transparency; JPEG removes transparency, PNG hides/disables compression.
- [ ] When ready to incur generation cost, generate one small image from each tool and Studio; verify original tool uses GPT Image 2 even after using Sunburst, and every result appears in the same gallery with the right label. Confirm an old record shows GPT Image 2 and its original URL.
- [ ] Exercise new upload edit, new-gallery reference edit and legacy-gallery reference edit. Inspect provider success and model metadata; no provider should be asked to fetch a login-only URL. Try an unsupported quality/format combination and confirm a 400 without an API generation.
- [ ] Inspect private storage after output/upload: no new GPT Image file in public/img or any variant directory. Open an output and an uploaded-reference URL as a second logged-in user; both work. Anonymous/expired sessions receive 401, never media bytes; legacy public URLs still work anonymously.
- [ ] Inspect media headers: private/no-store, correct raster MIME, inline safe filename, nosniff; refresh through your real proxy/CDN and verify no public cache hits. Invalid IDs/traversal and unregistered private filenames return no image.
- [ ] Check gallery pagination/filtering, likes, Open image and selected references across pages. Reject missing/invalid CSRF and cross-origin generation/like requests.
- [ ] Run Prompt to 3D when ready for its cost: image remains GPT Image 2, preview works, Pixal3D receives bytes, no public source copy; deleting its 3D job retains the gallery image.
- [ ] Restart and verify new outputs/references remain accessible and tool seeding stays idempotent. Visually check desktop/mobile layout and labels.

## Changed paths

- `.gitignore`
- `app.js`
- `controllers/gptImageController.js`
- `documentation/gpt-image-update.md`
- `env_sample`
- `models/pixal3d_job.js`
- `public/js/gpt_image.js`
- `routes/gpt_image.js`
- `services/data/toolSeeds.js`
- `services/gptImageModels.js`
- `services/gptImageService.js`
- `services/gptImageStorageService.js`
- `services/gptImageToolService.js`
- `services/pixal3dGatewayService.js`
- `services/pixal3dJobService.js`
- `services/promptTo3dJobService.js`
- `services/toolHandlerRegistry.js`
- `tests/unit/gptImageClient.test.js`
- `tests/unit/gptImageGeneration.test.js`
- `tests/unit/gptImageMedia.test.js`
- `tests/unit/gptImageModels.test.js`
- `tests/unit/gptImageService.test.js`
- `tests/unit/gptImageTool.test.js`
- `tests/unit/pixal3dJobService.test.js`
- `tests/unit/promptTo3dJobService.test.js`
- `utils/gptImageAuthorizationPolicy.js`
- `views/gpt_image/index.pug`
