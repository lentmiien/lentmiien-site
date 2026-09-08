# Miien character chat — phase 1

## Security contract (implementation design)

- Feature: optional Chat5 Miien character chat. Zone: logged-in. Interactive principals: admin by default; family and user require explicit grants. Machine principals: none.
- Data: private conversations and sensitive microphone audio. Capabilities: `chat.conversation.read`, `chat.conversation.write`, `chat.audio.transcribe`. Admin bundle grants all three; family/user bundles grant none. No admin object override.
- Scope: existing Chat5 member names from the validated principal, restricted to single-member conversations for this PoC. New records use the same persistence contract. No client-selected owner/member fields. Every conversation route rechecks membership. Resume supports bounded text-only Chat5 conversations without tools; no legacy conversion.
- Browser mutations: POST only, shared session CSRF token plus Origin checks. Read responses private/no-store; no analytics or third-party resources on Miien pages.
- Limits: strict allowlists; text 4,000 characters; context 4,000; 200 saved messages; context window 2–40; saved text messages at most 64,000 characters; bounded model catalog choices; one submission per conversation, at most four active submissions per process, at most two pending responses per account, durable duplicate request protection, rate limits per validated principal. Existing Chat5 provider timeouts/recovery apply.
- Output: escaped Pug attributes/text; browser textContent only; no HTML/Markdown execution, no private-media URLs. Public assets contain only generated mascot artwork.
- Microphone: canonical mono PCM WAV, 16 kHz/16 bit, at most 60 seconds/1,920,044 bytes; header and byte-count validation before ASR. Memory only; no public audio files. Existing configured ASR host only, 60-second timeout, 1 MB response limit, no redirects, cancellation and no content debug logging for this path.
- TTS: optional browser speech synthesis placeholder, chosen device voice; no application audio upload/storage. Browser/OS voice services may process text remotely. Existing gateway TTS is deferred because its public file output and six-hour request timeout do not fit this private interactive PoC.
- Logs: actionable operational errors with category `chat5_miien` and error names, no message/audio/provider payloads. Retention/deletion: ordinary Chat5 conversation lifecycle; no separate message store. Browser audio is discarded on stop/leave; transcripts persist only when sent.
- Negative tests: anonymous/capability/foreign scope, malformed and oversized input, CSRF/origin, model allowlist, incompatible conversations, duplicate/concurrent sends, unsafe rendering, audio limits and failure fallback.
- Legacy boundary: scoped adapter around ConversationService and MessageService, existing PendingRequests/webhook/recovery execution. No new Socket.IO events, room joins, or gateway changes. Legacy Chat5 interfaces retain their existing contracts and are outside this feature's authorization perimeter; do not use both editors simultaneously.


## Shipped experience and URLs

- `/chat5/miien`: separate start page, available model selection, title, context prompt, recent-message window, reasoning effort, response detail, and tab-local speech preferences. The first catalog model is selected for new rooms; no model is invented when the catalog is empty.
- `/chat5/miien/:id`: character room, five generated expressions, prominent artwork with a translucent composer over its lower portion on desktop, a separate latest-reply panel, Ctrl/Command+Enter, microphone transcription, pending/error messages, transcript, replay/stop, voice choice, and manual expression preview. History is collapsed initially. On small screens the composer flows below the portrait; the face remains unobscured. Latest reply and history are keyboard-focusable scroll regions, with full text retained for long responses.
- `/chat5/miien/:id/settings`: edit the same saved conversation's controls; changes are blocked during a pending response.
- `/chat5/miien/:id/state`: authenticated, scoped polling of saved text and pending status. Polls every 2.5 seconds while pending, otherwise every 12 seconds. No legacy socket room is joined.
- POST `/chat5/miien`, `/:id/settings`, `/:id/messages`, `/:id/transcribe`: CSRF-protected operations. Read pages never create conversations or invoke an LLM.
- Navigation: Tools & navigation → Chat & knowledge → Chat5 tools → Miien character chat, plus a link on the Chat5 conversation list for accounts with the read capability.

All URLs above are relative to the existing site origin. No deployment is performed by this implementation.

## Architecture and persistence

`controllers/miienController.js` wires the existing database models, `ConversationService`, `MessageService`, model catalog and `AsrApiService` into `routes/miien.js`. The controller does not create a second message store. `services/miienChatService.js` owns validation, scoped loading, compatibility, settings and submission. `utils/miienAuthorizationPolicy.js`, `miienMood.js` and `miienAudio.js` isolate policy, expression rules and WAV validation.

Conversation metadata, category/tags, members, context and message IDs remain in `Conversation5Model`; text remains in `Chat5Model`. New rooms carry `chat5` and `miien` tags. History is visible through ordinary Chat5 too. Resume preserves the existing context and title: it does not silently inject the Miien persona. The Chat5 tone note and normal context selection still apply. Hidden reasoning remains provider context but is not rendered or spoken. Media, tool-enabled, shared, old-format and oversized conversations are deliberately excluded. Candidate resume links are checked again when opened.

Only the Miien adapter passes `authorizedMember` to the shared submission method. That opt-in path rechecks membership before touching messages and cannot migrate a foreign legacy conversation. It first saves the user turn, then submits generation. Failed generation leaves the saved user text in history. Retrying a network-interrupted request reuses its request ID; an accepted duplicate does not append or bill another turn. A provider failure needs a new follow-up message after reviewing history, rather than an automatic retry loop.

Optional `miienBusyUntil` and `miienRequestIds` fields on the existing conversation hold a 15-minute submission lease and at most 200 duplicate IDs. No migration/backfill is needed. PendingRequests and existing webhook/recovery workers replace hidden placeholders with final responses. One Miien submission per account and four per process may run at once; two already-pending Chat5 requests for an account block more Miien submissions. These admission limits are per process; the conversation lease is a database atomic guard. A process crash before queuing can leave a lease for up to 15 minutes. Existing Chat5 editors do not honor the new lease; simultaneous editing in different interfaces is unsupported.

Miien requests cap model output at 4,096 tokens (including OpenAI reasoning) without changing saved or ordinary Chat5 defaults. OpenAI submission has a 60-second timeout and no automatic retries. Local requests retain the existing bounded gateway job submission contract and use its runtime `max_tokens` option. High reasoning may consume the budget before visible text; use medium or low for this PoC. The provider may reject an oversized context for its own model limit. Model availability/deprecation comes from `chat5ModelCatalogService`; `DISABLE_LOCAL=TRUE` removes Local options here.

The private browser pages (`views/miien_*.pug`) use local scripts/styles only and import the shared Graphite theme directly. `public/js/miien.js` renders all conversational text with `textContent`; Markdown is displayed literally. `public/js/miien_voice.js` handles browser speech independently. `public/css/miien.css` supplies responsive layouts, visible keyboard focus and reduced-motion rules; phase 1 has no idle animation.

## Artwork and expressions

Actual artwork was generated using the built-in `image_gen.imagegen` tool, not a CLI, placeholder or downloaded image. The appearance is adapted from `README-Prompts.md` sections B/D: adult catgirl, twin tails, amber eyes, fully zipped futuristic Graphite hoodie, Ember accents and black nickel details. One neutral base was generated, then each expression was edited from that same base, keeping framing/outfit/background fixed. The initial implementation recorded visual inspection of generation results. During hardening, the committed neutral portrait was inspected against the mascot guidance; all five named original PNGs were found in the local generated-images directory and re-encoded byte-for-byte to the committed WebPs. All manifest SHA-256 digests and 768×1024 dimensions matched. No artwork was regenerated or replaced.

Deployment assets are committed under `public/i/miien/`: `neutral.webp`, `happy.webp`, `thoughtful.webp`, `concerned.webp`, `surprised.webp`. Each is 768×1024; the complete set is approximately 450 KB. Only resizing and WebP encoding (Sharp, quality 85) followed generation. `provenance.json` records the prompts, generated source filenames and final SHA-256 digests. To regenerate, use the built-in image tool for the base, inspect it, then supply that base as the reference/edit target for every variant. Export to the same dimensions after comparing ears, eyes, shoulders, crop and clothing. Do not replace the final files with prompts alone.

The client preloads the five images, waits for decoding before swapping, and keeps the current portrait if an expression fails. If the initial image is unavailable, a text fallback appears. Alternative text names the character/current expression. The manual selector previews any mood without modifying the conversation or LLM prompt.

### Context-aware expression scoring

`classifyMood(reply, recentRows)` in `utils/miienMood.js` is a deterministic advisory rule system. It chooses art; it neither assesses a person's feelings nor changes the assistant response, prompt, metadata or shared Chat5 behavior. It needs no network, model, embedding, random selection, persistence or dependency. Existing embedding facilities were considered: `embeddingApiService` provides provider-backed retrieval/search and queued stored embeddings, not a calibrated cached mood classifier. Adding query vectors or mood prototypes would add operational work without a validated phase-1 benefit.

The snapshot adapter reads only non-hidden text by the authenticated member or `bot`, extracts nonempty string `content.text`, and restores `conversation.messages` ID order (database query/timestamp order is not conversational order). Each assistant message receives `{ id, role, text, mood }`; user messages have neutral mood. Reasoning, system/tool roles, persona metadata, empty placeholders and future turns never enter scoring. The state envelope stays `{ id, title, model, messages, pending }`; queued requests and active submission leases independently keep `pending` true.

Scoring is bounded and transparent:

- Current reply: first 8,000 characters, weight **2**. Up to three preceding visible user/assistant rows: first 1,200 characters each, newest-to-oldest weights **1, 0.35, 0.15**. At most 11,600 input characters per reply; history remains limited to 200 saved messages. There is no recursive reuse of earlier mood labels.
- Each cue family contributes once per message; each mood is capped at six points before recency weighting. Concern/distress and celebration cues score four, supportive concern and surprise score three, warmth and two explanatory/uncertainty families score two each. Repetition cannot inflate a family score.
- The highest weighted score wins at a minimum score of two. Equal scores prefer concerned, surprised, happy, then thoughtful. Mixed tones therefore resolve meaningfully rather than becoming neutral automatically. Strong current celebration can supersede earlier concern; concern can outweigh a generic polite welcome or explanatory phrasing.
- Thoughtful includes ordinary explanation, questions, comparison, planning and uncertainty: “It means…”, “The reason…”, “walk me through…”, “まず…次に…”, “仕組み”, “どうすれば”. Support, achievements, enjoyment and surprise have broader English/Japanese phrase families too. Unrecognized language/content remains neutral; there is no forced change each turn.
- Fenced/inline code, blockquotes, common English/Japanese quotation marks and explicit mood/prompt directives are excluded. Nearby English pre-negation and Japanese negative endings suppress a cue. A mood explicitly negated in the current reply, with no positive cue for that mood, cannot be resurrected by older context. Contrast clauses are evaluated independently. Explicit uncertainty/surprise idioms retain their meaning.

Limitations: these are surface cues, not semantic understanding. Sarcasm, indirect/complex negation, indirect instructions, quoted material in unsupported notation, domain-specific words and languages beyond configured English/Japanese can be misclassified. Distant context decays quickly, and content beyond the bounds does not affect art. Neutral is a valid fallback. No private production conversations were used as test fixtures. The original production diagnosis supplied by the owner identified insufficient vocabulary and missing context, not broken image loading.

The browser uses only the latest assistant mood, preloads/decodes matching portraits, guards stale decodes, normalizes unknown moods to neutral and preserves the current image on decode failure. Manual preview (including explicit neutral) persists across replies; returning to Automatic immediately restores the latest contextual selection. Unchanged polling does not rebuild transcript nodes, reset the latest-reply scroll region or re-decode the same automatic selection. Scores are recomputed locally from bounded data on state reads; there is no cross-user text cache or additional provider call.

## Voice and microphone behavior

Browser speech is an explicitly labeled phase-1 placeholder, off by default. Its voice list is the actual device/browser catalog; preferences are stored only in sessionStorage for the current tab. Enable it to speak new assistant replies. History does not autoplay on opening a room, including replies already visible while pending. Seen reply IDs prevent repeat speech after polling or history removal/reordering. Newly observed replies wait until pending clears; background or user-ended snapshots never autoplay an older reply. Replay starts from a user gesture when autoplay is blocked; Stop cancels playback. Playback is capped at 3,000 characters and three minutes; the full response remains readable. Voice errors never block sending. Selecting a voice stops existing speech. Some OS/browser voices process text remotely; voice-clone/Gateway selection is deferred.

The existing `TtsService` was inspected: it writes to `public/mp3`, can select slower clone backends, and permits six-hour requests. No fast private streaming contract was available locally, so phase 1 does not call it or change Gateway configuration. A private bounded audio endpoint should precede gateway voice selection in phase 2.

Microphone input uses MediaRecorder on a secure origin and supported browser. The client stops at 59 seconds (server limit 60), enforces a 4 MB compressed capture limit, decodes only that recording, and exports mono 16 kHz PCM WAV through Web Audio. The server validates the canonical WAV header, format, duration-by-byte-count and length, then invokes the existing ASR `/transcribe` contract with `whisper-api`, auto language, and transcription task. The response text is appended to the current draft, preserving edits made during transcription. It is never automatically sent. If the draft plus transcript exceeds 4,000 characters, the transcript is rejected with an explanation rather than silently truncated.

ASR allows two active uploads per process and applies session/capability/membership/CSRF checks before reading audio. The configured service gets a 60-second request timeout, 1 MB response bound and no redirects. Its Miien-only private option suppresses transcript/payload debug logging. Audio stays in memory in this application and is discarded; the upstream ASR service's own retention policy still applies. Stop, leave, hiding the page, a new submitted turn or newly observed pending turn stops tracks/playback, aborts transcription, and invalidates stale callbacks. A late permission grant immediately closes its stream. Cancellation cannot guarantee that an upstream service stops work already received.

## Setup, privacy and operations

Use the normal app setup, existing MongoDB configuration, populated Chat5 AI model cards and provider credentials. No new packages, secrets, environment variables, gateway services or schedulers are required. ASR uses the existing server-only `ASR_API_BASE` configuration. HTTPS is required for microphone access except browser-supported localhost development. Text and browser speech can be reviewed without ASR availability. No production data or `.env` was inspected during implementation.

Admin receives the semantic capability bundle explicitly. Family/user require per-user or group grants through the existing shared permission system. To enable text, grant both `chat.conversation.read` and `chat.conversation.write`; microphone additionally needs `chat.audio.transcribe`. Read-only access may inspect owned compatible conversations but cannot submit/settings-write. There is no admin bypass for another member's data. Names are retained as member identifiers because that is the existing Chat5 contract; migrate the whole Chat5 identity contract to immutable IDs in a separate change.

Only artwork is public. Audio and transcripts are not written to public assets. Submitted text uses normal Chat5 persistence, embedding and response-recovery/audit retention; phase 1 is not an ephemeral/private-mode chat. Miien suppresses new ASR and LLM submission payload debug records, but the existing Chat5 response retrieval/audit pipeline still applies. Keep those database records protected by existing operational access. No credentials, account names or conversational text are logged by the new adapter's issue reports. Browser preferences store no transcript.

Cloudflare should not cache any `/chat5/miien` response; application no-store/auth/CSRF controls are effective without Cloudflare rules. No Access/WAF/Tunnel change or exemption is needed. Rollback can remove the new navigation and route mount while retaining saved conversations for ordinary Chat5. Optional lease/request-ID fields can remain unused. No destructive cleanup or migration is included.

## Verification and manual review

Automated coverage includes service contracts, real Express middleware/HTTP ordering, principal/capability scope, CSRF/Origin, malformed IDs/fields, durable duplicates and pending budgets, provider failure without false placeholders, bounded WAV, safe Pug/DOM rendering, network retries, voice errors and late microphone/page callbacks. The tests mock database/provider boundaries and never launch the configured application.

Manual checklist for phase-1 review:

1. Open the start page on desktop and mobile. Tab through settings, start a room, and send by button and Ctrl/Command+Enter. Check contrast, portrait framing, keyboard focus and scroll behavior with a long reply and reduced-motion enabled.
2. Confirm chosen model/context/title persist in Chat5 and resume with the same history. Check a tool/media/shared room is rejected with a helpful message. Do not edit the same room simultaneously in legacy Chat5.
3. Preview all five moods; block an image URL and verify text remains usable. Check a plain explanatory reply selects thoughtful, an acknowledgement after an English/Japanese achievement can select happy, and concern/negation behave sensibly. Select neutral manually, receive another reply, then restore Automatic. Check mixed cues resolve by score, not automatically neutral.
4. Enable speech; check real voices, browser autoplay denial, Replay, Stop, leaving and returning, and unsupported speech browsers. Nothing should speak on initial history load.
5. Allow and deny microphone permission, stop before permission resolves, record a short message, edit while transcribing, stop transcription, hide/leave the page, and reach the recording limit. Confirm no recording auto-sends and text remains usable on every failure.
6. Exercise one real configured LLM and ASR round trip. These were not invoked in development: no production inspection, provider billing or Gateway changes were needed. Confirm the existing webhook/recovery workers process the saved pending response.

During both initial implementation and this hardening review, the available Browser runtime reported `No browser is available`; its supported discovery returned `[]`. Consequently no connected-browser screenshots, visual responsive QA, actual microphone device capture, OS speech playback or live provider end-to-end result is claimed. Pug render checks and DOM interaction tests passed. These device/integration checks remain part of the user's phase-1 review.

## Phase 2: animation and speech synchronization

- Introduce a private, authenticated TTS streaming/short-lived delivery service with bounded latency, cancellation and no public recordings. Measure existing fast Piper/Voicevox voices before considering cloned Miien voices; do not change Gateway without concrete contract evidence.
- Add a small character state machine (idle/listening/thinking/speaking/error), subtle blink/breath motion, reduced-motion equivalents and background-tab suspension. Keep the current still-image path as a fallback.
- Use audio timing/phoneme or viseme data for lip sync; define a common clock for utterance, mouth and expression. Test stop/interrupt before adding body motion.
- Improve mood with language-aware structured output isolated to this tool or a small calibrated classifier. Add mixed-emotion/negation evaluation and transition hysteresis; avoid changing ordinary Chat5 prompts.

## Phase 3: full experience and performance

- Evaluate a rigged 2D/3D Miien only after timing and mobile GPU/memory budgets are measured. Add idle/body motion, eye focus and expression blending with graceful static fallback.
- Replace polling with a dedicated session-revalidated, capability/member-scoped realtime contract. Add persistent cross-process admission control and robust turn recovery/cancellation before scaling workers.
- Add paginated history, richer safely rendered content, compatible conversation imports and explicit shared-room policy. Migrate ownership to immutable IDs across Chat5 as a separate security project.
- Measure time-to-first-text/audio, ASR/TTS latency, memory, bandwidth and accessibility. Add device/browser coverage, privacy retention controls and a controlled rollout with rollback metrics.

### Initial implementation validation (3ab2c0a)

- Focused regression run: `volta run --node 24.20.0 npm test -- --runInBand --coverage=false tests/unit/miienMood.test.js tests/unit/miienChatService.test.js tests/unit/miienRoutes.test.js tests/unit/miienClient.test.js tests/unit/asrApiService.test.js tests/unit/conversationService.test.js tests/unit/messageService.test.js tests/unit/openaiApiConversion.test.js tests/unit/ollamaApiTools.test.js` — **9 suites, 151 tests passed**.
- Full final run on the repository's pinned Node: `volta run --node 24.20.0 npm test -- --runInBand` — **264 suites, 2,117 tests passed**. Coverage thresholds passed (67.35% statements, 43.72% branches for the configured critical-file set). No pre-existing failures encountered. Jest printed its existing experimental VM Modules warning.
- `volta run --node 24.20.0 npm run lint:openapi` — all four curated specs passed; no YAML changes were needed.
- Node 24.20.0 syntax checks passed for all 24 changed/new JavaScript files. All three concrete Miien Pug pages compiled and the settings/room/error renders were exercised. `git diff --check` passed.
- Sharp decoded every committed expression asset and verified 768×1024 dimensions. The five WebP files total 451,698 bytes; final hashes are in the provenance manifest.

There is no build script for these server-rendered pages. `npm start`/`setup.js` were not run because they mutate data and start integrations.

### Phase-1 hardening verification (2026-09-08)

- Focused command: `volta run --node 24.20.0 npm test -- --runInBand --coverage=false tests/unit/miienMood.test.js tests/unit/miienChatService.test.js tests/unit/miienRoutes.test.js tests/unit/miienClient.test.js tests/unit/asrApiService.test.js tests/unit/conversationService.test.js tests/unit/messageService.test.js tests/unit/openaiApiConversion.test.js tests/unit/ollamaApiTools.test.js` — 9 suites / 205 tests passed.
- Full suite: `volta run --node 24.20.0 npm test -- --runInBand` — **264 suites / 2,171 tests passed**, including coverage thresholds (67.35% statements / 43.72% branches in the configured critical-file set).
- After final directive-scanning efficiency and portrait-fit refinements, the four Miien suites were rerun: **141 tests passed**. `git diff --check` and syntax checks for the six changed JavaScript files passed. No OpenAPI files changed; the original validation remains applicable.
- Synthetic regressions cover natural English/Japanese wording without the old keywords, explanatory intent, bilingual context, mixed and negated moods, instruction/quotation/code exclusions, recent-context size/order/role boundaries, exact state/message contracts, pending leases, settings race guards, successive automatic portrait changes, manual neutral then Automatic restoration, stale/failed image decode, safe unknown/empty fallback, inert long text, keyboard/IME behavior, and speech deduplication across pending/history/background polling.
- Real Express route tests and shared Chat5/ASR/provider-conversion tests use mocked database/provider adapters. Neither the configured application nor production was started; no production writes, real model/ASR calls, service restart or device verification occurred.
- Browser discovery returned `No browser is available` and `[]`. DOM/Pug checks do not prove pixel layout, screen-reader behavior, microphone capture or audible speech. Desktop/mobile screenshots and the device checklist above remain for review.

Deployment/review handoff: deploy the finished branch revision through the normal reviewed application release process; no new environment variables, dependencies or migration are needed. Keep `/chat5/miien` private/no-store and refresh the browser to load updated JS/CSS. Open `/chat5/miien`, verify start/settings/resume and normal Chat5 access, then exercise the synthetic cue examples and manual/automatic switching. Check narrow/short viewports, long replies, keyboard navigation and reduced motion before accepting layout. In the chosen review environment only, test one provider reply and optional HTTPS microphone/ASR plus browser voice permissions/replay/stop. Deploying or executing those live checks is not part of this local hardening run.
