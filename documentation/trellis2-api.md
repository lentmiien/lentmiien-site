# TRELLIS.2 API via the AI Gateway

Base URL: http://192.168.0.20:8080

TRELLIS.2 converts one reference image into a textured 3D model. Its service
routes are exposed by the AI Gateway under `/3d/trellis2`.

Generation is synchronous: keep the HTTP request open until the model is ready,
generation and export finish, and the binary GLB response has been downloaded.

## Quick start

The TRELLIS.2 container is stopped by default and is not started automatically
by a generation request. Start it before using the model:

```bash
BASE_URL="http://192.168.0.20:8080"

curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/trellis2/container/start" \
  -H "Content-Type: application/json" \
  --data '{"wait":true,"timeout_sec":120}'
```

Then generate a 512-resolution GLB with the default sampler settings:

```bash
curl --fail-with-body --show-error \
  --max-time 7500 \
  -X POST "$BASE_URL/3d/trellis2/generate" \
  -F "image=@/absolute/path/to/object.png" \
  -F "seed=0" \
  -F "resolution=512" \
  -F "texture_size=2048" \
  -F "decimation_target=500000" \
  -D /tmp/trellis2-headers.txt \
  -o /tmp/trellis2-result.glb
```

The response body is the GLB file, not JSON. The response headers are saved in
`/tmp/trellis2-headers.txt`, including the job ID needed to retrieve the stored
copy later.

## Endpoint summary

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/3d/trellis2/container` | Report container state and service health. |
| `POST` | `/3d/trellis2/container/start` | Start the container and optionally wait for service health. |
| `POST` | `/3d/trellis2/container/stop` | Stop the container. |
| `POST` | `/3d/trellis2/container/restart` | Restart the container and optionally wait for service health. |
| `GET` | `/3d/trellis2/health` | Report service, model, GPU, busy, and last-job state. |
| `GET` | `/3d/trellis2/ready` | Return `200` only while the model is loaded. |
| `POST` | `/3d/trellis2/model/load` | Load the model into GPU memory. |
| `POST` | `/3d/trellis2/model/unload` | Release the model's CPU and GPU memory. |
| `POST` | `/3d/trellis2/generate` | Generate and return a binary GLB from an uploaded image. |
| `GET` | `/3d/trellis2/jobs/last` | Return metadata for the latest generation attempt in this process. |
| `GET` | `/3d/trellis2/outputs/{job_id}` | Download a persisted GLB by UUID job ID. |

Equivalent container controls are also available through
`/containers/trellis2`, `/containers/trellis2/start`,
`/containers/trellis2/stop`, and `/containers/trellis2/restart`.

## Generate a model

### Request

```http
POST /3d/trellis2/generate
Content-Type: multipart/form-data
```

Send the source image and all options as multipart form fields. Only `image` is
required.

| Form field | Type | Default | Accepted values and purpose |
| --- | --- | ---: | --- |
| `image` | file | required | PNG, JPEG, or another Pillow-readable image. A transparent PNG is recommended. |
| `seed` | integer | `0` | `0` to `2147483647`. Changes inferred hidden geometry and fine detail. |
| `resolution` | integer | `512` | `512`, `1024`, or `1536`. Start with 512; 1536 is the most demanding ROCm path. |
| `preprocess_image` | boolean | `true` | Removes a non-transparent background, crops the subject, and prepares the image for the pipeline. |
| `sparse_structure_steps` | integer | `12` | `1` to `50`. Coarse occupancy and silhouette sampling steps. |
| `sparse_structure_guidance` | number | `7.5` | `0` to `20`. Coarse-structure image guidance. |
| `shape_steps` | integer | `12` | `1` to `50`. Detailed geometry sampling steps. |
| `shape_guidance` | number | `7.5` | `0` to `20`. Detailed-shape image guidance. |
| `texture_steps` | integer | `12` | `1` to `50`. PBR attribute sampling steps. |
| `texture_guidance` | number | `1.0` | `0` to `20`. Texture-stage image guidance. |
| `decimation_target` | integer | `500000` | `100000` to `1000000`. Target export complexity; use 100000 for lighter previews. |
| `texture_size` | integer | `2048` | `1024`, `2048`, or `4096`. Exported texture-map size. |
| `remesh` | boolean | `true` | Rebuild and clean topology before UV unwrapping and texture baking. |

The gateway accepts a maximum complete request size of 32 MiB. The image itself
is limited to 30 MiB and 25,000,000 decoded pixels. Multipart encoding adds a
small amount of overhead, so keep the uploaded image below the 30 MiB service
limit.

For best results, use one complete, centered object in a three-quarter view.
Prefer a transparent PNG or a plain background, with the object unobstructed and
fully inside the frame.

### Successful response

```http
HTTP/1.1 200 OK
Content-Type: model/gltf-binary
Content-Disposition: attachment; filename="trellis2-<job-id>.glb"
X-Job-Id: <job-id>
X-Generation-Seconds: <seconds>
X-Export-Seconds: <seconds>
X-Peak-VRAM-MiB: <mebibytes>
```

Header names are case-insensitive. The response body contains the same GLB that
is persisted by the service for later retrieval.

Extract the job ID from the saved curl headers:

```bash
JOB_ID=$(awk 'BEGIN { IGNORECASE=1 } /^x-job-id:/ { gsub("\r", "", $2); print $2 }' \
  /tmp/trellis2-headers.txt | tail -n 1)

curl --fail-with-body --show-error \
  "$BASE_URL/3d/trellis2/outputs/$JOB_ID" \
  -o "/tmp/trellis2-$JOB_ID.glb"
```

## Jobs and persisted outputs

Get metadata for the latest generation attempt since the current container
process started:

```bash
curl --fail-with-body --silent --show-error \
  "$BASE_URL/3d/trellis2/jobs/last"
```

The JSON includes the job ID, status, source image dimensions, request
parameters, generation and export durations, source mesh counts, peak VRAM,
output size, and internal output paths.

`GET /3d/trellis2/jobs/last` is process-local and returns `404` before the first
attempt or after a container restart. Generated files are stored on a persistent
volume and become available through `/outputs/{job_id}` again after the
container has restarted.

## Health and model lifecycle

### Service health

```bash
curl --fail-with-body --silent --show-error \
  "$BASE_URL/3d/trellis2/health"
```

Important response fields are:

| Field | Meaning |
| --- | --- |
| `status` | Service health; normally `ok`. |
| `model_state` | `unloaded`, `loading`, `ready`, `generating`, `unloading`, or `error`. |
| `model_loaded` | Whether the pipeline currently occupies model memory. |
| `busy` | Whether a load, unload, or generation operation owns the single-operation lock. |
| `model_error` | Most recent model load error, otherwise `null`. |
| `torch` | PyTorch, ROCm, GPU, and VRAM information. |
| `last_job` | Latest process-local generation metadata, otherwise `null`. |

Health and readiness are different. `/health` returns `200` when the service is
alive even if the model is unloaded. `/ready` returns `503` until the model is
loaded.

### Load or unload the model

The model loads lazily when generation begins, so explicit loading is optional:

```bash
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/trellis2/model/load"
```

Example response after a new load:

```json
{
  "state": "ready",
  "already_loaded": false,
  "load_seconds": 55.7
}
```

Release model memory manually with:

```bash
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/trellis2/model/unload"
```

This deployment unloads the pipeline after every generation so that other GPU
services can reclaim VRAM. The container remains running; stop it separately if
it is no longer needed.

Only one load, unload, or generation operation can run at a time. A competing
operation returns HTTP `409` instead of sharing GPU memory.

## Container controls

Check the container without calling the model service directly:

```bash
curl --fail-with-body --silent --show-error \
  "$BASE_URL/3d/trellis2/container"
```

Start, stop, and restart accept optional JSON bodies:

```bash
# Start and wait up to 120 seconds for the service health check.
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/trellis2/container/start" \
  -H "Content-Type: application/json" \
  --data '{"wait":true,"timeout_sec":120}'

# Stop, allowing up to 30 seconds for a clean shutdown.
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/trellis2/container/stop" \
  -H "Content-Type: application/json" \
  --data '{"timeout_sec":30}'

# Restart and wait for service health.
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/trellis2/container/restart" \
  -H "Content-Type: application/json" \
  --data '{"wait":true,"stop_timeout_sec":30,"start_timeout_sec":120}'
```

If the gateway is configured with `LLM_ADMIN_TOKEN`, add the following header to
each start, stop, or restart request:

```http
X-Admin-Token: <configured-token>
```

The read-only container status endpoint does not require that header.

Waiting for container startup checks `/health`, not `/ready`. It confirms that
the API is reachable without preloading the model.

## Gateway-wide status and limits

The gateway's main health response includes TRELLIS.2 upstream and container
state under `upstreams.trellis2` and `containers.trellis2`:

```bash
curl --fail-with-body --silent --show-error "$BASE_URL/health"
```

The active TRELLIS.2 upstream URL, gateway prefix, timeouts, and request-size
limit are reported under `three_d.trellis2` by:

```bash
curl --fail-with-body --silent --show-error "$BASE_URL/limits"
```

## Timeouts and errors

Cold model loading and generation can take several minutes. The gateway permits
up to 7,200 seconds for the upstream response; configure the calling app's read
timeout slightly above that value, such as 7,500 seconds. Do not retry a timed-out
generation immediately without checking `/health`, because the original job may
still be running.

Error responses normally use the JSON shape `{"detail":"message"}`.

| Status | Meaning |
| ---: | --- |
| `400` | Empty, unreadable, or fully transparent input image, or an invalid control value. |
| `401` | Missing or invalid `X-Admin-Token` on a container mutation when admin auth is enabled. |
| `404` | No process-local last job exists, or the requested output UUID was not found. |
| `409` | The model is loading or another model operation is running. Retry later. |
| `413` | The gateway request, image byte size, or decoded pixel count exceeds its limit. |
| `422` | A required form field is missing or a generation parameter is outside its accepted range. |
| `500` | Model loading, generation, or export failed. Inspect `/health` and service logs. |
| `502` | The container appears to be running, but the gateway cannot reach the upstream service. |
| `503` | The container is stopped, startup failed, or the model is not ready for `/ready`. |
