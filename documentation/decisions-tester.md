# AI Gateway decision tester

Open `/admin/decisions` from the AI Gateway dashboard or Tool Manager. Discovery
uses `GET /decisions/models`; submitting uses `POST /decisions`. The model menu
comes from the Gateway, including whether OpenAI credentials are configured.
The tester supports mixed batches of predicate, choice and score questions with
shared text and one optional PNG, JPEG or WebP. Choice values preserve the
difference between booleans and strings. Scores use zero-based level indices.
Individual refusals and the raw response (including usage) are displayed.

Forms and the latest result live in `sessionStorage`, scoped to the signed-in
account and browser tab. They survive reloads; a fresh tab session starts empty.
Browser session restoration may restore tab storage. Clear session removes them
immediately. Images remain in memory and must be selected again after reload.
No application database, server session or file stores test input or output.
The Gateway/provider has its own processing and retention policy.

Tool Manager seeds five enabled tools on normal database-ready startup:
`decision_models`, `decision_predicate`, `decision_choice`, `decision_score`,
and `decision_batch`. Existing tool customizations are preserved by missing-only
seeding. The inference tools accept shared `input` text, `model`, and optional
inline `image_data_url`; the single-question tools accept question fields directly.
The batch tool accepts `questions`. This is a deliberate text-and-image subset
of the Gateway's richer message input contract. Tool results follow the caller's
normal chat retention, independently of the browser tester.

Configuration reuses `AI_GATEWAY_BASE_URL` (default
`http://192.168.0.20:8080`). No new credentials or migrations are required.
There are no automatic inference retries; local queueing can take up to 20 minutes.
The Tool Manager's manual JSON test endpoint accepts up to 8 MiB, parsed after
its admin and CSRF checks, to accommodate the same inline image limit.

Validation: run `npm test -- tests/unit/decisionsService.test.js
tests/unit/decisionsRoutes.test.js tests/unit/decisionsTools.test.js
tests/unit/decisionsBrowser.test.js --coverage=false` (one shell command).
The optional `tests/browser/decisions.cjs` uses a synthetic loopback fixture for
desktop/mobile, image submission, refresh and fresh-tab checks; its header lists
the Playwright and Bootstrap CSS prerequisites. It does not start the app or
contact the real Gateway.

## Security contract

- Zone: logged-in. Interactive principals: admin by default; family/user only
  with an explicit `ai_gateway.decisions.run` grant. Machine principals: none.
- Data: private evidence, images and answers. Capability:
  `ai_gateway.decisions.run` on discovery and inference, including tool handlers.
  Tools reload the authenticated account; arguments cannot supply identity.
- Object scope: none; no stored objects or uploaded-file identifiers. No admin override.
- Browser mutation: POST with shared session CSRF token and origin checks.
- Limits: 8 MiB request, 6,000 UTF-8 textual bytes including keys, 32 questions,
  2,000 characters per instruction, 2–255 unique typed choices, 2–10 score levels;
  one inline image, 5 MiB, 4 million pixels, 4,096 pixels per edge, single frame.
  Image content is decoded under a pixel/time bound before forwarding.
  Six submissions/minute per principal, one active submission per principal,
  two globally per application process; Gateway limits apply across processes.
- Output: escaped Pug and DOM textContent; no HTML rendering of answers.
  Analytics disabled. No private file storage or remote-image fetching.
- Outbound: fixed configured Gateway origin, fixed paths, no redirects,
  20-minute inference deadline, 10-second catalog deadline, 1 MiB response cap.
  Disconnect cancels upstream work. Session/account authority is rechecked during
  long browser requests and before returning results.
- Cache: private/no-store. Logs: bounded status codes for operational failures;
  never input, output, image contents, provider error bodies or credentials.
- Retention: browser tab session only for tester; no server persistence.
- Negative tests: authentication/capability/CSRF denial, revoked session,
  unknown fields/models, malformed/remote/oversized images, typed duplicate
  choices, text/question limits, provider failure redaction and cancellation.
- Legacy dependency: existing session, capability and tool-principal helpers;
  dedicated route parser bypasses the legacy global body parser.

Source: Gateway `documentation/decisions-gateway-usage.md`, fetched 2026-11-10,
and live `/decisions/models` discovery.
