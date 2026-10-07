# Configurable TARIC test adapters

## Security contract

- Zone: logged in; private, explicitly admin-managed shared tool configuration.
- Interactive authority: `taric.tool.manage`, assigned to admin by default; family
  and user require an explicit capability grant. The existing management router
  enforces this authority. No new machine management operation is exposed.
- Object scope: the singleton TARIC configuration is admin-managed. Request and
  reprocessing ownership and execution-time authorization remain enforced.
- Mutations: existing `POST /admin/taric/config` with shared session CSRF, private
  no-store responses, 120 requests/minute and a 256 KiB JSON body bound.
- Validation: 1–20 unique adapter names, each 1–100 ASCII letters, digits, dots,
  underscores or hyphens, starting with a letter or digit. The default must be in
  that list. Unknown fields, paths, URLs and invalid types are rejected.
- Rendering: Pug escaping and DOM text/property assignment; no inline scripts,
  analytics, new files or public media. Settings persist until replaced; request
  and result retention follows the existing TARIC policy.
- Outbound: saving/listing names is local only. Execution uses the existing
  allowlisted Gateway, owned sessions, queue/time/token limits, and strict
  response adapter validation. Names do not select hosts or file paths.
- Logging: existing configuration audit and route/worker failure logging through
  `utils/logger`; no credentials, prompts or private output in added logs.
- Negative tests: capability/CSRF denial, invalid and excessive names, unknown
  default, unregistered benchmark adapter, caller override rejection, stale
  queued work after a default change, and normal release remaining closed.
- Migration: missing `testAdapters` retains the original adapter and default.
  Existing config clients may omit the field to preserve saved choices. No new
  environment variables or database migration. Deploy/restart Site and workers
  together; rolling back restores the old hard-coded test behavior.

## Usage

In `/admin/taric` → Configuration, enter one test adapter name per line, choose
the default, and save. For example, retain `taric-v1-20260917-2` and add
`taric-v1.1-20261007`. Names must already be available to the inference service;
this registers Site choices, not adapter files. Adapters must support the current
Qwen3 model, TARIC prompt and JSON output contract.

The saved default serves browser tests, API requests with literal `test: true`,
and history reprocessing. The benchmark adapter selector independently chooses
any saved test adapter for v0. Saving invalidates prior configuration fingerprints
and queued work; submit fresh work after changing the default. Completed results
retain their recorded adapter.

The optional config field is:

```json
"testAdapters": {
  "names": ["taric-v1-20260917-2", "taric-v1.1-20261007"],
  "default": "taric-v1.1-20261007"
}
```

Version 0 remains a training replay and cannot authorize release. Importing v1
creates a draft; publishing a reviewed independent v1+ makes it the current
release benchmark and invalidates earlier scores. Neither action changes the
test default or turns test requests into normal requests. The existing v1+ runner
requires an approved catalog and verified runtime identity; Gateway immutable
identity verification is currently unavailable. Configurable test adapters do not
remove that release prerequisite or add an unverified v1 evaluation mode.

## Validation

- Full Jest suite with disposable loopback MongoDB: 366 suites and 4,655 tests
  passed, 12 tests skipped by existing guards; coverage thresholds passed.
- `npm run lint:openapi -- taric-assisted.v1.yaml` passed.
- Chromium desktop (1280 px) and mobile (390 px): saved a new default, inspected
  the rendered controls, and verified no page errors or horizontal overflow.
- Tests used synthetic data and local provider fixtures; no live adapter/GPU
  inference or production configuration changes were performed.
