# OCR model testing

The OCR workspace discovers model parameters and warnings from the configured
`OCR_API_BASE_URL` at `GET /ocr/models`, cached for one minute. Canonical selectors
are `hunyuanocr`, `teleocr`, `lightonocr-2`, and `unlimited-ocr`. Discovery failure
uses the last known catalog, or Hunyuan alone on a cold start, and reports a warning.

The local Gateway checked on October 10, 2026 returns 404 for `/ocr/models` and
does not advertise that path in `/openapi.json`. Its `/ocr` operation remains
available. This is a Gateway contract/deployment gap; do not guess another path
or enable unsupported models from static definitions. Deploy a Gateway exposing
`GET /ocr/models` with a `models` object keyed by supported canonical selectors,
each with its `parameters` definitions and optional `warning`. Include Hunyuan.
Confirm catalog discovery before offering the alternative model choices.

The site retains the one-minute retry/cache interval and visible fallback warning.
It logs `CATALOG_ENDPOINT_MISSING` once per failure transition, including the
fixed endpoint and HTTP status; recovery logs a notice. Repeated identical 404s
do not generate new warnings every minute. No OCR processing defaults change.

Hunyuan remains the default with the existing coordinate prompt and 2048-token
request. Existing records without a model remain Hunyuan jobs. Alternative models
use native prompts when blank, and accept only their own documented settings.
The live catalog supplies defaults and bounds; documented backend limits also
cap the accepted inputs. TeleOCR layout tasks require at least 1073296 pixels.
LightOn's gateway quarantine warning is displayed without starting the model.

Alternative results save the entire successful JSON object in `files.result.rawResponse`,
including native markup, boxes, statistics, and truncation indicators. The UI shows
escaped text and expandable/copyable JSON. They do not enter the layout editor,
receipt forwarding, or embedding pipelines. Requests have a 1 MiB response limit;
oversized responses fail instead of being partially saved. Alternative request
timeouts allow 2800 seconds including gateway queueing. No automatic retries run.

## Security contract

- Feature: alternative OCR model tests, added to the existing OCR workspace.
- Zone/principals: logged-in users; no machine principals. Existing `ocr` page
  permission still applies. New `ocr.jobs.test_models` capability is bundled for
  admin; family/user have no default grant and can receive explicit role/user grants.
- Data: private images, prompts, and model responses. Alternative jobs are
  owner-scoped using the validated account ID, including history, reads, deletion,
  direct pages and previews. There is no admin override for another owner's tests.
- Browser mutations: POST/PATCH/DELETE with shared session CSRF; fetch supplies
  the token header before multipart parsing. Anonymous and missing capability
  requests are denied. Alternative workers recheck account capability before each file.
- Limits: at most five files per job, two concurrent uploads, five queued/active/preparing
  jobs, ten submissions per minute per account, twelve fields, 16 KiB per field;
  alternative images at most 10 MiB each with 24-million-pixel decoding limit.
  Prompt limit is 4096 characters. Inference remains sequential.
- Output: escaped Pug, shared safe inline JSON, text-only model output and JSON;
  never active model HTML. Private/no-store responses, analytics disabled.
- Storage: new alternative previews in `private_data/ocr/`, JPEG re-encoded;
  authenticated, capability-checked owner delivery. Responses stay in MongoDB.
  Preview paths are server-derived; symlink files are rejected on delivery.
- Outbound: only configured OCR gateway, fixed discovery/inference paths, no redirects,
  bounded timeouts and response sizes. Application credentials are not forwarded.
- Logs: discovery, gateway, persistence, and preview failures use `utils/logger`,
  with opaque IDs/status/error codes; no alternative prompts or response payloads.
- Retention: jobs/results persist until deleted through the workspace; deletion also
  removes previews. Original input buffers exist only during queued/running work.
- Legacy boundary: Hunyuan records, public previews and existing cross-user history
  remain grandfathered. All alternative records are filtered by owner and capability.
  No backfill or DB migration is required; schema fields are additive.
- Negative tests: capability/owner isolation, CSRF, invalid model/options/bounds,
  inappropriate Hunyuan actions, inert model text/JSON, and catalog failure.

Deployment uses the existing gateway configuration and private-data backup policy.
No new secrets or dependencies are required. Do not edge-cache `/ocr` responses.
Rollback must retain private previews and new job fields; older code does not know
how to display alternative jobs safely, so disable OCR access before rolling back.
