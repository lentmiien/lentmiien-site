# ComfyUI Gateway Endpoints

This gateway proxies ComfyUI and adds async job tracking to avoid client timeouts.
Base URL examples below assume the AI Gateway is reachable at http://localhost:8080.

## Recommended async flow (avoid 502 timeouts)

1) Submit a job

POST /comfy/submit

Payload supports either a workflow file or a full prompt:
- {"workflow_id": "txt2img_api.json"}
- {"prompt": { ... }}

Optional:
- "timeout_sec": how long the gateway waits before marking the job as timeout

Example:

```json
{
  "workflow_id": "txt2img_api.json",
  "timeout_sec": 7200
}
```

Response (example):

```json
{
  "prompt_id": "2f2f7f1d-7b7d-4a8b-8f42-8c7a0ff8c79c",
  "queue_number": 3,
  "workflow_id": "txt2img_api.json",
  "status": "pending",
  "status_url": "/comfy/status/2f2f7f1d-7b7d-4a8b-8f42-8c7a0ff8c79c",
  "queue_wait_sec": 0.02
}
```

If the gateway is busy, this can return HTTP 429.

2) Poll job status

GET /comfy/status/{prompt_id}

Example pending response:

```json
{
  "prompt_id": "2f2f7f1d-7b7d-4a8b-8f42-8c7a0ff8c79c",
  "status": "pending",
  "workflow_id": "txt2img_api.json",
  "queue_number": 3,
  "queue_wait_sec": 0.02,
  "submitted_at": 1768447000.12,
  "completed_at": null
}
```

Example completed response:

```json
{
  "prompt_id": "2f2f7f1d-7b7d-4a8b-8f42-8c7a0ff8c79c",
  "status": "completed",
  "workflow_id": "txt2img_api.json",
  "queue_number": 3,
  "queue_wait_sec": 0.02,
  "submitted_at": 1768447000.12,
  "completed_at": 1768447012.34,
  "outputs": [
    {
      "node_id": "9",
      "kind": "images",
      "filename": "ComfyUI_00001_.png",
      "subfolder": "",
      "type": "output",
      "gateway_view_url": "/comfy/view?filename=ComfyUI_00001_.png&type=output&subfolder="
    }
  ]
}
```

3) Fetch output files

Use the gateway_view_url from the status response:

GET /comfy/view?filename=...&type=output&subfolder=...

## Sync flow (blocking)

POST /comfy/run

- wait=true (default) blocks until completion and may hit proxy/client timeouts on long jobs.
- wait=false returns immediately and behaves like /comfy/submit.

## Other gateway endpoints

- GET /comfy/workflows
- GET /comfy/workflows/{name}
- GET /comfy/system_stats
- GET /comfy/view

## Notes

- The async status endpoint uses ComfyUI /history internally. If the gateway restarts,
  completed jobs can still be returned if ComfyUI still has history for that prompt_id.
- timeout_sec only controls how long the gateway tracks a job before marking it as
  "timeout"; it does not cancel the job in ComfyUI.
