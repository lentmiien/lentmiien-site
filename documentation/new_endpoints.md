# AI Gateway - New Endpoints (Lentmiien LM)

This document describes the new Lentmiien LM-related endpoints added to the AI Gateway.

## Overview

These endpoints provide:
- TensorBoard proxying when `lentmiienlm-tensorboard` is running.
- Checkpoint discovery with `status.json` aggregation.
- Training monitor selection and current monitor state.

They are intended to help coordinate model training with GPU-heavy gateway workloads.

## Endpoints

### `GET /tensorboard` and `GET /tensorboard/{path}`

Proxy to TensorBoard when the `lentmiienlm-tensorboard` container is running.

- Upstream: `LENTMIIEN_TENSORBOARD_URL` (default `http://127.0.0.1:6006`).
- If the container is not running, returns `503`.

Example:

```
GET /tensorboard
GET /tensorboard/#scalars
GET /tensorboard/data/plugins_listing
```

Notes:
- All HTTP methods are forwarded (GET/POST/PUT/PATCH/DELETE/OPTIONS).
- Query strings are preserved.

---

### `GET /lentmiienlm/checkpoints`

Return all `status.json` files found under `LENTMIIEN_CHECKPOINTS_DIR` (default `lentmiien-lm/checkpoints` inside the gateway container).

Response: array of status objects, each with an extra `checkpoint` field. If parsing fails, an entry contains `checkpoint` and `error`.

Example response:

```
[
  {
    "checkpoint": "scale_test_300m",
    "state": "finished",
    "time": 1769600329.104426,
    "global_step": 100
  },
  {
    "checkpoint": "smoke_test",
    "state": "training",
    "time": 1769672107.3441024,
    "global_step": 110
  }
]
```

---

### `GET /lentmiienlm/monitor`

Return current monitoring state (selected checkpoint, last status, cooldown info, etc.).

Example response:

```
{
  "selected": "smoke_test",
  "monitoring": true,
  "last_status": {
    "state": "training",
    "time": 1769672107.3441024,
    "global_step": 110
  },
  "last_error": null,
  "last_read_ts": 1769672120.12,
  "last_time_seen_ts": 1769672120.12,
  "gpu_jobs_inflight": 0,
  "training_paused_by_gateway": false,
  "cooldown_remaining_sec": 0.0
}
```

---

### `POST /lentmiienlm/monitor`

Select (or clear) the checkpoint folder to monitor. This controls how the gateway supervises `lentmiienlm-train`.

- Requires `X-Admin-Token` if `LLM_ADMIN_TOKEN` is set.
- Body accepts `folder` (string) or `null` to disable monitoring.
- When monitoring is cleared, the gateway stops the training container (if running).

Examples:

```
POST /lentmiienlm/monitor
{
  "folder": "smoke_test"
}
```

```
POST /lentmiienlm/monitor
{
  "folder": null
}
```

Response is the same structure as `GET /lentmiienlm/monitor`.

## Monitoring Behavior Summary

- Default state is **monitoring none** (training container is stopped if running).
- If monitoring a folder:
  - If `state == "finished"`: training container is stopped and monitoring is cleared.
  - If `state == "training"` and `time` has not updated for more than `LENTMIIEN_FROZEN_TIMEOUT_SEC` (default 300s): the training container is restarted.
  - If `state == "training"` and `time` is updating: no action is taken.
- GPU-heavy gateway jobs (OCR, TTS, ASR, ComfyUI, Ollama LLM) will:
  - Stop the training container if it is running.
  - Run the job.
  - Start a cooldown timer (`LENTMIIEN_COOLDOWN_SEC`, default 600s).
  - If no further GPU jobs arrive during cooldown, the training container is restarted (only if it was paused by the gateway and monitoring is still active).

## Relevant Environment Variables

These can be set on the AI Gateway container:

- `LENTMIIEN_TRAIN_CONTAINER_NAME` (default `lentmiienlm-train`)
- `LENTMIIEN_TENSORBOARD_CONTAINER_NAME` (default `lentmiienlm-tensorboard`)
- `LENTMIIEN_TENSORBOARD_URL` (default `http://127.0.0.1:6006`)
- `LENTMIIEN_CHECKPOINTS_DIR` (default `lentmiien-lm/checkpoints` inside the container)
- `LENTMIIEN_MONITOR_POLL_SEC` (default `5`)
- `LENTMIIEN_FROZEN_TIMEOUT_SEC` (default `300`)
- `LENTMIIEN_COOLDOWN_SEC` (default `600`)
- `LENTMIIEN_TRAIN_STOP_TIMEOUT_SEC` (default `20`)

Ensure the gateway container has a read-only mount of the checkpoints directory and access to Docker socket for container control.
