# ACE-Step 1.5 (Music) Gateway Endpoints

This gateway proxies the ACE-Step 1.5 container and serializes heavy GPU work.
Base URL examples assume the AI Gateway is reachable at http://192.168.0.20:8080.

## Core endpoints

### Health/state

- `GET /music/acestep15/health`
- `GET /music/acestep15/state`

Use these to verify the ACE-Step service is reachable and to inspect model state.

### Generate (auto load/unload)

`POST /music/acestep15/generate`

The gateway **always calls** `/load` before generation and `/unload` afterwards.
If the GPU is busy, this returns HTTP 429.

Minimal payload:

```json
{
  "caption": "Ambient techno with soft pads"
}
```

Optional `load` block (forwarded to `/load`):

```json
{
  "caption": "Ambient techno with soft pads",
  "load": {
    "load_llm": false,
    "llm_backend": "vllm"
  },
  "timeout_sec": 7200
}
```

On success, the response includes URLs you can use to list or download outputs:

```json
{
  "ok": true,
  "job_id": "job-123",
  "gateway_outputs_url": "/music/acestep15/outputs?job_id=job-123",
  "gateway_output_url": "/music/acestep15/output?path=",
  "result": { "...": "..." }
}
```

### Manual load/unload (optional)

- `POST /music/acestep15/load`
- `POST /music/acestep15/unload`

These proxy the upstream API directly. For normal usage, prefer `POST /music/acestep15/generate`
so the gateway guarantees load/unload ordering.

## Output browsing

### List outputs (newest first)

`GET /music/acestep15/outputs`

Query params:
- `page` (default 1)
- `limit` (default 20, max 200)
- `job_id` (optional, filter to a single generation folder)

Example:

```
GET /music/acestep15/outputs?job_id=job-123&limit=50
```

Response:

```json
{
  "ok": true,
  "root": "/acestep15-outputs/job-123",
  "job_id": "job-123",
  "items": [
    {
      "path": "job-123/audio_0.flac",
      "name": "audio_0.flac",
      "size_bytes": 123456,
      "modified_ts": 1769672125.12,
      "view_url": "/music/acestep15/output?path=job-123/audio_0.flac"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50,
  "pages": 1
}
```

### Download a file

`GET /music/acestep15/output?path=job-123/audio_0.flac`

## Notes

- All ACE-Step calls share the gateway's heavy-GPU slot. If another GPU-heavy job is running, you will get HTTP 429.
- The gateway mounts `acestep15-gw/data/outputs` read-only so it can serve generated audio files.
