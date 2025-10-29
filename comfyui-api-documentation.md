# ComfyUI Helper API – HTTP Interface Handbook

This document describes the HTTP API implemented by `server.mjs`. It is intended for any client application that needs to talk to one or more ComfyUI instances through this helper service.

---

## 1. High-Level Overview

The helper API acts as a router/proxy in front of one or more ComfyUI deployments. It consolidates prompt submission, job tracking, and media retrieval behind a single authenticated HTTP interface. Key highlights:

- Multiple upstream ComfyUI nodes are defined in `instances.json`.
- Every API request (except `/health`) must include `x-api-key`.
- Each request that interacts with ComfyUI must target a specific `instance_id`.
- Generated jobs are tracked locally; outputs are fetched lazily via HTTP proxying.
- Local instances expose their file system (input/output/video) while remote-only instances provide uploads via ComfyUI’s `/upload/image` endpoint.

---

## 2. Authentication & Rate Limiting

- **API Key**: All protected routes require an `x-api-key` header with the key value configured through `API_KEY` (defaults to `change-me`).
- **Rate Limit**: A global limit of 600 requests per minute is enforced per server process. Exceeding it returns HTTP 429.

---

## 3. Instance Configuration (`instances.json`)

Instances are defined in `instances.json` (path overrideable via `COMFY_INSTANCES_FILE`). Example scaffold:

```json
{
  "defaultInstanceId": "local",
  "instances": [
    {
      "id": "local",
      "name": "Local ComfyUI",
      "baseUrl": "http://127.0.0.1:8188",
      "clientId": "comfy-local-broker",
      "storage": {
        "mode": "local",
        "root": "ComfyUI"
      },
      "workflows": ["txt2img_qwen_image", "..."]
    },
    {
      "id": "remote-sample",
      "name": "Remote Sample",
      "baseUrl": "https://remote.example",
      "clientId": "comfy-remote-sample",
      "storage": { "mode": "remote" },
      "headers": { "Authorization": "Bearer <token>" },
      "wsPath": "/ws",
      "workflows": ["txt2img_qwen_image", "img2img_qwen_image_edit"]
    }
  ]
}
```

Important fields:

- `id` *(string)*: Unique handle used as `instance_id`.
- `baseUrl` *(string)*: Base HTTP(S) endpoint for the ComfyUI API.
- `clientId` *(string)*: Sent with `/prompt` requests and WebSocket subscriptions.
- `storage.mode` *(string)*: `"local"` to enable direct disk access, `"remote"` to disable it.
- Optional overrides:
  - `storage.inputDir`, `storage.outputDir`, `storage.videoDir`.
  - `headers` (object) and `wsHeaders` for per-request header injection.
  - `wsPath` if the ComfyUI WebSocket is not `/ws`.
- `workflows` *(array)*: Allowed workflow keys. Empty or missing list means “all known workflows”.
- `defaultInstanceId` or `default: true` on an instance chooses the fallback `instance_id`.

On boot, the helper validates each instance, removes unknown workflow keys, and logs the set of available targets.

---

## 4. Instance Selection Rules

Many routes accept the target instance in multiple places; the service uses the first non-empty value in this order:

1. `instance_id` query parameter.
2. `instance_id` path parameter (only for future nested routes; not currently used).
3. `instance_id` field in the JSON body or multipart form fields.
4. Default instance from configuration.

If the resolved `instance_id` is absent or unknown, the server returns an error (`400` or `404`).

---

## 5. Endpoint Reference

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/health` | No | Service status + instance summary. |
| GET | `/v1/instances` | Yes | Lists configured instances and workflow availability. |
| GET | `/v1/workflows` | Yes | Lists workflows enabled for a specific instance. |
| POST | `/v1/generate` | Yes | Enqueues a workflow on a ComfyUI instance. |
| GET | `/v1/jobs/:id` | Yes | Retrieves the state and outputs for a submitted job. |
| GET | `/v1/jobs/:id/files/:index`<br>GET `/v1/jobs/:id/images/:index` | Yes | Streams a generated asset (image/video). |
| POST | `/v1/files/input` | Yes | Uploads an asset to the instance input folder (local write or remote proxy). |
| GET | `/v1/files/:bucket` | Yes | Lists files in a bucket (`input`, `output`, `video`) for local instances. |
| GET | `/v1/files/:bucket/:filename` | Yes | Sends a raw file from a local bucket. |

Detailed descriptions follow.

---

### 5.1 GET `/health`

- **Auth**: None.
- **Response** `200`:

  ```json
  {
    "ok": true,
    "default_instance_id": "local",
    "instances": [
      { "id": "local", "name": "Local ComfyUI", "base_url": "http://127.0.0.1:8188", "storage": "local" },
      { "id": "remote-sample", "name": "Remote Sample", "base_url": "https://remote.example", "storage": "remote" }
    ]
  }
  ```

Use this for quick health checks or monitoring.

---

### 5.2 GET `/v1/instances`

- **Auth**: `x-api-key`.
- **Query**: optional `instance_id` ignored; the endpoint always lists all instances.
- **Response** `200`:

  ```json
  {
    "default_instance_id": "local",
    "instances": [
      {
        "id": "local",
        "name": "Local ComfyUI",
        "base_url": "http://127.0.0.1:8188",
        "client_id": "comfy-local-broker",
        "storage": "local",
        "has_local_io": true,
        "workflows": ["txt2img_qwen_image", "..."]
      },
      {
        "id": "remote-sample",
        "name": "Remote Sample",
        "base_url": "https://remote.example",
        "client_id": "comfy-remote-sample",
        "storage": "remote",
        "has_local_io": false,
        "workflows": ["txt2img_qwen_image", "img2img_qwen_image_edit"]
      }
    ]
  }
  ```

---

### 5.3 GET `/v1/workflows`

- **Auth**: `x-api-key`.
- **Query Parameters**:
  - `instance_id` *(optional)*: Overrides default instance.
- **Response** `200`:

  ```json
  {
    "instance_id": "local",
    "workflows": [
      {
        "key": "txt2img_qwen_image",
        "name": "Text-to-Image (Qwen Image 2 Turbo)",
        "description": "...",
        "outputType": "image",
        "inputs": [
          { "key": "prompt", "type": "string", "required": true, "note": "Positive prompt (node 111 prompt)" },
          { "key": "seed", "type": "number", "required": false, "default": -1, "note": "Use -1 for random (node 3 seed)" },
          ...
        ]
      }
    ]
  }
  ```

Workflows and input metadata are defined in `workflows.mjs`.

**Errors**:

- `400`: missing/unknown `instance_id`.
- `500`: Template failed to load (should be rare; indicates missing JSON workflow file).

---

### 5.4 POST `/v1/generate`

- **Auth**: `x-api-key`.
- **Content Type**: `application/json`.
- **Body**:

  ```json
  {
    "instance_id": "local",
    "workflow": "txt2img_qwen_image",
    "inputs": {
      "prompt": "A cinematic portrait",
      "seed": -1,
      "width": 1024,
      "height": 1024,
      "filename_prefix": "user123"
    }
  }
  ```

  - `instance_id`: optional if default should be used.
  - `workflow`: must be enabled for that instance.
  - `inputs`: validated against the workflow’s Zod schema. Required vs optional fields are exposed by `/v1/workflows`.

- **Response** `200`:

  ```json
  {
    "job_id": "f9a5d9e3-a5f8-4f77-9c3d-0a5c5dce493e",
    "status": "queued",
    "prompt_id": "0f5cd1e0-5c4f-41a7-bd2c-1af559a63a5a",
    "instance_id": "local"
  }
  ```

**Error Responses**:

- `400`: Missing workflow, unknown workflow, or invalid inputs. Invalid inputs include a `details` array from Zod.
- `403`: Workflow not enabled for the selected instance.
- `500`: Template missing/failed to load.
- `502`: Upstream `/prompt` failure (ComfyUI 5xx or network).

---

### 5.5 GET `/v1/jobs/:id`

- **Auth**: `x-api-key`.
- **Path Parameters**:
  - `id`: Local job UUID.

- **Response** `200` (when still in progress):

  ```json
  {
    "job_id": "f9a5d9e3-a5f8-4f77-9c3d-0a5c5dce493e",
    "instance_id": "local",
    "status": "running",            // "queued" | "running" | "completed" | "failed"
    "prompt_id": "0f5cd1e0-5c4f-41a7-bd2c-1af559a63a5a",
    "files": [],
    "error": null,
    "created_at": "2025-10-16T00:10:23.123Z",
    "finished_at": null
  }
  ```

- **Response** `200` (when completed):

  ```json
  {
    "job_id": "...",
    "instance_id": "local",
    "status": "completed",
    "prompt_id": "...",
    "files": [
      {
        "index": 0,
        "filename": "ComfyUI_00001_.png",
        "subfolder": "",
        "type": "output",
        "media_type": "image",
        "download_url": "/v1/jobs/f9a5.../files/0"
      }
    ],
    "error": null,
    "created_at": "...",
    "finished_at": "..."
  }
  ```

While the job is `queued` or `running`, the server may poll ComfyUI’s `/history` endpoint as a fallback in case WebSocket notifications were missed. Failed jobs populate `status: "failed"` and a human readable `error`.

**Errors**:

- `404`: Job not found.
- `410`: Job refers to an instance that is no longer configured.

---

### 5.6 GET `/v1/jobs/:id/files/:index` and `/v1/jobs/:id/images/:index`

- **Auth**: `x-api-key`.
- **Purpose**: Streams a single generated asset; both endpoints are equivalent aliases.
- **Path Parameters**:
  - `id`: Job UUID.
  - `index`: Integer index in the `files` array returned by `/v1/jobs/:id`.

- **Response**: Binary stream with inferred `Content-Type` header (PNG, JPEG, WEBP, MP4, etc).

**Errors**:

- `404`: Job or file index not found.
- `410`: Instance removed from config.
- `502`: Failed to fetch asset from upstream `/view`.

---

### 5.7 POST `/v1/files/input`

- **Auth**: `x-api-key`.
- **Content Type**: `multipart/form-data`.
- **Form Fields**:
  - `instance_id` *(optional)*: Hidden field when multiple instances are available.
  - `image` *(file, required)*: File to stage. Other fields are ignored.

- **Response** `200`:

  ```json
  {
    "ok": true,
    "instance_id": "local",
    "filename": "upload_1731105000000.png",
    "location": "local"              // "local" or "remote"
  }
  ```

Behavior depends on the instance:

- **Local storage**: file is written to the configured `input` directory.
- **Remote storage**: file is forwarded to the upstream `/upload/image` endpoint via `FormData`. The response payload is returned in `payload` (omitted above) when present.

**Errors**:

- `400`: Missing field `image`.
- `502`: Any upload failure (filesystem or upstream).

---

### 5.8 GET `/v1/files/:bucket`

- **Auth**: `x-api-key`.
- **Path Parameter**:
  - `bucket`: One of `input`, `output`, `video`.
- **Query Parameters**:
  - `instance_id` *(optional)*.

- **Response** `200` (local instances only):

  ```json
  {
    "instance_id": "local",
    "bucket": "output",
    "files": ["ComfyUI_00001.png", "ComfyUI_00002.png"],
    "dir": "C:\\Users\\...\\ComfyUI\\output"
  }
  ```

**Errors**:

- `400`: Invalid bucket.
- `501`: Bucket unavailable (remote storage does not expose local filesystem).

---

### 5.9 GET `/v1/files/:bucket/:filename`

- **Auth**: `x-api-key`.
- **Path Parameters**:
  - `bucket`: `input`, `output`, or `video`.
  - `filename`: Name of the file (sanitized internally via `safeBasename`).
- **Query Parameters**:
  - `instance_id` *(optional)*.

- **Response**: Binary download served with Express `sendFile`.

**Errors**:

- `400`: Invalid bucket.
- `404`: File not found.
- `501`: Bucket unavailable for remote storage instances.

---

## 6. Workflow Definitions (`workflows.mjs`)

- Each workflow entry contains:
  - `file`: JSON workflow template filename located in `workflows/`.
  - `inputs`: Metadata used for UI construction.
  - `validate`: Zod schema executed server-side.
  - `patch`: Function applying user inputs onto the template before submission.
- Clients should rely on `/v1/workflows` output instead of hardcoding forms so future updates remain compatible.

---

## 7. Job Lifecycle

1. Client calls `/v1/generate`.
2. Helper queues a prompt via `POST /prompt` on ComfyUI with a unique client ID.
3. WebSocket notifications advance the job from `queued` → `running` → `completed`. If a notification is missed, the next `/v1/jobs/:id` request re-fetches `/history` to fill in outputs.
4. Completed jobs expose an ordered `files` array. The helper never copies the outputs locally; it streams them on demand from the upstream `/view` endpoint.
5. Once a job is `completed` or `failed`, the corresponding prompt key is removed from the internal prompt map.

Jobs are stored in memory only; restarting the API clears job history.

---

## 8. Typical Client Workflow

1. **Discover instances**: `GET /v1/instances` to populate a picker and show which workflows are allowed. Cache `default_instance_id`.
2. **Fetch workflow metadata**: `GET /v1/workflows?instance_id=...` to build/validate the UI form.
3. **Upload assets** *(if required)*:
   - For workflows needing images/videos, call `POST /v1/files/input` with `instance_id`.
   - Capture the returned `filename` and reference it in workflow inputs.
4. **Submit generation**: `POST /v1/generate` with `instance_id`, `workflow`, and validated `inputs`.
5. **Poll job status**: `GET /v1/jobs/{job_id}` until the status becomes `completed` or `failed`. Consider exponential backoff to respect the rate limit.
6. **Download outputs**:
   - Use `download_url` from the job response to call `GET /v1/jobs/{job_id}/files/{index}`.
   - Optionally enumerate the output bucket (`/v1/files/output`) for local instances.
7. **Handle errors**: Display meaningful messages surfaced in the `error` field or HTTP error responses.

---

## 9. Error Model & Conventions

- Errors are returned as JSON where possible:

  ```json
  { "error": "description", "details": "...", "instance_id": "remote-sample" }
  ```

- Missing or forbidden data returns 4xx. Upstream ComfyUI failures return 502. Internal misconfiguration during boot stops the process with a logged error.
- Filenames are sanitized by `safeBasename`, stripping path traversal and unsafe characters.

---

## 10. Notes for UI Developers

- Always send `x-api-key`.
- Encourage users to pick an instance before showing available workflows or file pickers.
- When working with remote instances (`storage.mode === "remote"`), disable file browsing features – uploads work, but listing/downloading buckets will return HTTP 501.
- Use `media_type` in job file descriptors to branch rendering (images vs videos).
- `seed: -1` is treated as “random seed” on the server side; the actual seed is substituted before queueing.
- The API currently tracks jobs in memory only. Long-lived frontends should consider handling `404`/`410` on `/v1/jobs/:id` gracefully (e.g., prompt expired after restart).

---

This documentation should provide enough detail for integrating the UI app with the helper API. Reach out to the backend team if additional metadata or endpoints are required.***
