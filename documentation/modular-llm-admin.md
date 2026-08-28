# Modular LLM admin tool

The authenticated admin tool at `/admin/ai-gateway/modular-llm` manages the web
application side of the AI Gateway's `/modular-llm` service.

## Current scope

- Poll service and container metadata without starting the GPU container.
- Display the live bundle, stage models, revisions, token limits, adapters, and
  intermediate schemas.
- Reconcile the live bundle into a MongoDB model catalog while preserving
  admin-managed display names, use-case tags, notes, and future-test selection.
- Run the complete Interpreter → CIR → Reasoner → AIR → Renderer pipeline.
- Retain every admin-initiated test, including failed Gateway responses.
- Inspect local test records and the Gateway's read-only run artifacts.

The current Gateway contract does not expose dataset, training-job, adapter
activation, or model-switching routes. The UI labels training and fine-tuning as
a future phase instead of presenting controls that cannot take effect.

## Collections

### `modular_llm_model_profiles`

One record is stored per service, bundle, and stage. Gateway-owned discovery
fields are refreshed by **Sync catalog**. Admin-owned fields are preserved:

- `displayName`
- `useCases`
- `notes`
- `enabledForTesting`

Historical bundle records remain in the collection with `available: false`, so
future bundle swaps do not discard their management metadata.

### `modular_llm_test_runs`

One record is created before an admin pipeline request begins and completed as
either `succeeded` or `failed`. The record includes the input hash, request
options, Gateway correlation ID, output, timing, failure information, and a
bounded raw response snapshot. Original test input is retained and must be
treated as sensitive admin data.

## Configuration

The tool uses the existing `AI_GATEWAY_BASE_URL`. These optional timeouts are
available in milliseconds:

```text
MODULAR_LLM_INFO_TIMEOUT_MS=10000
MODULAR_LLM_RUN_TIMEOUT_MS=630000
```

As with the existing Gateway dashboard, localhost Gateway URLs require
`AI_GATEWAY_ALLOW_LOCALHOST=true`; otherwise the configured LAN Gateway default
is used.

## Verification

The metadata monitor is safe to refresh while `modular_llm` is stopped. A
pipeline test is GPU-producing and starts the managed container on demand.
After a test:

1. Open its local run record and verify status, output or structured error, and
   stage diagnostics.
2. Follow the Gateway run ID when persistence was enabled.
3. Confirm the service returns to its stopped/suspended state on the dashboard.
4. Use the main AI Gateway dashboard for authoritative host VRAM and cleanup
   telemetry.
