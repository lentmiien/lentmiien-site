# Pixal3D API via the AI Gateway

Base URL: `http://192.168.0.20:8080`

Pixal3D converts one reference image into a textured 3D model. The AI Gateway
exposes the service under `/3d/pixal3d` and coordinates its GPU work with the
other gateway services.

Generation is synchronous. Keep the request open while the model loads,
generates the geometry and texture, exports the GLB, and sends the file back.
There is no text prompt: the source image, estimated camera, and generation
parameters provide all conditioning.

## Quick start

Pixal3D is registered as a default-stopped managed container. Start it before
generation; a generation request does not start it automatically:

```bash
BASE_URL="http://192.168.0.20:8080"

curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/pixal3d/container/start" \
  -H "Content-Type: application/json" \
  --data '{"wait":true,"timeout_sec":120}'
```

Generate a practical 1024-resolution baseline:

```bash
curl --fail-with-body --show-error \
  --max-time 7500 \
  -X POST "$BASE_URL/3d/pixal3d/generate" \
  -F "image=@/absolute/path/to/object.png" \
  -F "seed=42" \
  -F "resolution=1024" \
  -F "texture_size=1024" \
  -F "decimation_target=100000" \
  -F "fov_degrees=0" \
  -D /tmp/pixal3d-headers.txt \
  -o /tmp/pixal3d-result.glb
```

The response body is the GLB file, not JSON. `fov_degrees=0` asks MoGe-2 to
estimate the source camera's horizontal field of view. The selected value is
returned in the response headers and persisted in the job metadata.

Validate the download:

```bash
file /tmp/pixal3d-result.glb
```

It should be reported as a glTF binary model, version 2.

## Endpoint summary

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/3d/pixal3d/container` | Report container state and service health. |
| `POST` | `/3d/pixal3d/container/start` | Start the container and optionally wait for health. |
| `POST` | `/3d/pixal3d/container/stop` | Stop the container. |
| `POST` | `/3d/pixal3d/container/restart` | Restart the container and optionally wait for health. |
| `GET` | `/3d/pixal3d/health` | Report service, model, GPU, operation, and last-job state. |
| `GET` | `/3d/pixal3d/ready` | Return `200` only while the model is loaded and idle. |
| `POST` | `/3d/pixal3d/model/load` | Load the model explicitly. |
| `POST` | `/3d/pixal3d/model/unload` | Unload the model explicitly. |
| `POST` | `/3d/pixal3d/generate` | Generate and return a binary GLB from an image. |
| `GET` | `/3d/pixal3d/jobs/last` | Return metadata for the latest generation attempt. |
| `GET` | `/3d/pixal3d/jobs/{job_id}` | Return persisted metadata for one job. |
| `GET` | `/3d/pixal3d/outputs/{job_id}` | Download a persisted GLB by UUID job ID. |

Equivalent lifecycle controls are available at `/containers/pixal3d`,
`/containers/pixal3d/start`, `/containers/pixal3d/stop`, and
`/containers/pixal3d/restart`.

## Choosing the input image

Input composition is especially important because Pixal3D has no text prompt
to correct or clarify what should become geometry.

- Use one complete object, centered and fully visible, with roughly 5–10%
  margin around it. Keep hands, stands, labels, and nearby objects out of frame
  unless they should become part of the mesh.
- Prefer a transparent PNG with a clean alpha edge. An RGB image or JPEG also
  works; leave `preprocess_image=true` so RMBG-2.0 removes its background and
  crops the subject.
- Use a square, sharp source image at 1024 px or larger when available. Even,
  neutral lighting and limited cast shadows make shape cues clearer.
- A three-quarter view usually reveals more useful geometry than a perfectly
  frontal view. Pixal3D must infer the hidden back and underside, so compare a
  few seeds if those regions matter.
- Avoid cropped extremities, heavy occlusion, motion blur, extreme wide-angle
  perspective, and complex backgrounds. Very glossy, transparent, reflective,
  or extremely thin objects are inherently more ambiguous from one view.
- Set `preprocess_image=false` only for an already prepared RGB subject crop.
  That mode converts the image to RGB and does not preserve an alpha mask.

Start with `fov_degrees=0`. If the result looks stretched or flattened and the
source camera is known, compare a manual horizontal FOV between 5 and 120
degrees. The upstream Pixal3D example value `0.2` is in radians, approximately
11.46 degrees; this API accepts degrees, so do not pass `0.2` expecting the same
camera.

## Generate a model

### Request

```http
POST /3d/pixal3d/generate
Content-Type: multipart/form-data
```

Only `image` is required. All controls are multipart form fields.

| Form field | Type | Default | Accepted values and purpose |
| --- | --- | ---: | --- |
| `image` | file | required | PNG, JPEG, or another Pillow-readable image. A transparent PNG is preferred. |
| `seed` | integer | `42` | `0` to `2147483647`. Changes inferred hidden geometry and fine details. |
| `resolution` | integer | `1024` | `1024` or `1536`. Start at 1024; 1536 is considerably heavier. |
| `preprocess_image` | boolean | `true` | Runs subject/background preparation. Use `false` only for a prepared RGB crop. |
| `fov_degrees` | number | `0` | `0` uses MoGe-2 auto-estimation; otherwise 5–120 horizontal degrees. |
| `mesh_scale` | number | `1.0` | `0.25` to `4.0`. Projection/camera scale used while conditioning the model. |
| `extend_pixel` | integer | `0` | `-128` to `128`. Camera-framing adjustment used when deriving distance. |
| `sparse_structure_steps` | integer | `12` | `1` to `50`. Coarse occupancy and silhouette sampling steps. |
| `sparse_structure_guidance` | number | `7.5` | `0` to `30`. Image guidance for coarse structure. |
| `sparse_structure_guidance_rescale` | number | `0.7` | `0` to `1`. Guidance-rescale strength for coarse structure. |
| `shape_steps` | integer | `12` | `1` to `50`. Detailed geometry sampling steps. |
| `shape_guidance` | number | `7.5` | `0` to `30`. Image guidance for detailed geometry. |
| `shape_guidance_rescale` | number | `0.5` | `0` to `1`. Guidance-rescale strength for shape. |
| `texture_steps` | integer | `12` | `1` to `50`. Texture/PBR attribute sampling steps. |
| `texture_guidance` | number | `1.0` | `0` to `30`. Image guidance for texture. |
| `texture_guidance_rescale` | number | `0.0` | `0` to `1`. Guidance-rescale strength for texture. |
| `max_num_tokens` | integer | `49152` | `8192` to `100000`. Maximum sparse tokens; higher values can retain complexity but use more memory. |
| `decimation_target` | integer | `300000` | `10000` to `1000000`. Approximate export triangle target. |
| `texture_size` | integer | `2048` | `1024`, `2048`, or `4096`. Exported texture-map size. |
| `dc_resolution` | integer | `256` | `128`, `192`, or `256`. Dual-contouring extraction resolution. |
| `smooth_iterations` | integer | `0` | `0` to `20`. Optional geometry smoothing before export. |
| `fill_holes` | boolean | `true` | Enables hole filling during mesh extraction. |

The gateway limits the complete request to 32 MiB. The service separately
limits the uploaded image to 30 MiB and 25,000,000 decoded pixels. Multipart
encoding adds overhead, so do not use a source file near the 32 MiB gateway
limit.

The trained 12-step sampler defaults are the best baseline. First vary the
image, seed, camera FOV, export polygon target, or texture size. Change sampler
guidance and step counts only after you have a repeatable baseline.

### Recommended test presets

Use these as comparison points while keeping the source image and seed fixed:

| Goal | Resolution | Texture | Decimation | Notes |
| --- | ---: | ---: | ---: | --- |
| Fast baseline | `1024` | `1024` | `100000` | Best first functional and composition test. |
| Quality baseline | `1024` | `2048` | `300000` | Service defaults; more export detail and a larger file. |
| Low-poly check | `1024` | `1024` | `25000` | Useful for silhouette and downstream-import testing. |
| High-resolution experiment | `1536` | `2048` | `300000` | Run only after the 1024 version succeeds; allow much more time and VRAM. |

`decimation_target` is approximate. Topology cleanup, UV seams, and export can
make final face and vertex counts differ from the requested target.

### Successful response

```http
HTTP/1.1 200 OK
Content-Type: model/gltf-binary
Content-Disposition: attachment; filename="pixal3d-<job-id>.glb"
X-Job-Id: <job-id>
X-Generation-Seconds: <seconds>
X-Export-Seconds: <seconds>
X-Peak-VRAM-MiB: <mebibytes>
X-Actual-Resolution: <1024-or-1536>
X-Camera-FOV-Degrees: <horizontal-fov>
X-Worker-Recycle: true
```

Header names are case-insensitive. The gateway preserves these upstream
headers. The response body is the same GLB persisted by the service.

Extract the job ID and retrieve the stored copy later:

```bash
JOB_ID=$(awk 'BEGIN { IGNORECASE=1 } /^x-job-id:/ { gsub("\r", "", $2); print $2 }' \
  /tmp/pixal3d-headers.txt | tail -n 1)

curl --fail-with-body --show-error \
  "$BASE_URL/3d/pixal3d/outputs/$JOB_ID" \
  -o "/tmp/pixal3d-$JOB_ID.glb"
```

## Jobs and persisted outputs

Get the most recent job metadata:

```bash
curl --fail-with-body --silent --show-error \
  "$BASE_URL/3d/pixal3d/jobs/last"
```

Metadata includes the request parameters, input dimensions, current/final
phase, camera source and FOV, generation/export/total durations, source mesh
counts, peak allocated and reserved VRAM, output size, and output paths.

Fetch one known job directly:

```bash
curl --fail-with-body --silent --show-error \
  "$BASE_URL/3d/pixal3d/jobs/$JOB_ID"
```

Metadata is written throughout generation. If the worker exits or its watchdog
terminates a stuck native operation, an unfinished job is recovered as
`interrupted` or `timed_out` after restart. Outputs and metadata live on the
service's persistent host volume.

## Health and model lifecycle

Check service health through the gateway:

```bash
curl --fail-with-body --silent --show-error \
  "$BASE_URL/3d/pixal3d/health"
```

Important fields include:

| Field | Meaning |
| --- | --- |
| `status` | Process health; normally `ok`, or `degraded` for an overdue operation. |
| `model_state` | `unloaded`, `loading`, `ready`, `generating`, `unloading`, or `error`. |
| `model_loaded` | Whether the Pixal3D pipeline is currently loaded. |
| `busy` | Whether a load, unload, or generation owns the service operation lock. |
| `operation` | Active kind, phase, job, elapsed time, watchdog deadline, and overdue state. |
| `torch` | PyTorch, ROCm, GPU architecture, and available VRAM details. |
| `naf_shape_target_size` | NAF shape-conditioning grid configured for this worker. |
| `naf_texture_target_size` | NAF texture-conditioning grid configured for this worker. |
| `last_job` | Latest persisted generation metadata, if present. |

`/health` returns `200` when the API is alive even if the model is unloaded.
`/ready` returns `200` only while the model is loaded and idle; otherwise it
returns `503`.

The model loads lazily when generation begins, so explicit loading is optional:

```bash
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/pixal3d/model/load"

curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/pixal3d/model/unload"
```

Only one load, unload, or generation can run in the Pixal3D service at once. A
competing service operation returns HTTP `409`.

The tested ROCm deployment unloads the model and recycles its process after a
successful GLB response has been completely sent. This is intentional:
PyTorch's normal cache cleanup does not release every compiler and MIOpen HIP
allocation, while a short process restart reliably returns that VRAM to other
services. `X-Worker-Recycle: true` confirms this behavior. Docker restarts the
container automatically, and persisted jobs remain available. Health checks
may briefly fail during that restart window.

Gateway generation, load, and unload requests also acquire the shared
GPU-heavy slot and pause managed model training when necessary. The gateway
waits up to 300 seconds for the slot and returns HTTP `429` if it remains busy.
Requests sent directly to port 8892 bypass that coordination.

## Container controls

Inspect the managed container:

```bash
curl --fail-with-body --silent --show-error \
  "$BASE_URL/3d/pixal3d/container"
```

Start, stop, and restart accept optional JSON bodies:

```bash
# Start and wait for the API health check.
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/pixal3d/container/start" \
  -H "Content-Type: application/json" \
  --data '{"wait":true,"timeout_sec":120}'

# Stop cleanly.
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/pixal3d/container/stop" \
  -H "Content-Type: application/json" \
  --data '{"timeout_sec":30}'

# Restart and wait for health.
curl --fail-with-body --silent --show-error \
  -X POST "$BASE_URL/3d/pixal3d/container/restart" \
  -H "Content-Type: application/json" \
  --data '{"wait":true,"stop_timeout_sec":30,"start_timeout_sec":120}'
```

If `LLM_ADMIN_TOKEN` is configured on the gateway, add
`X-Admin-Token: <configured-token>` to start, stop, and restart requests.
Read-only status does not require the token. Startup waits for `/health`, not
`/ready`, so it does not preload the model.

## Gateway-wide status and limits

The main gateway health response reports Pixal3D under
`upstreams.pixal3d`, `containers.pixal3d`, and `pixal3d_inflight`:

```bash
curl --fail-with-body --silent --show-error "$BASE_URL/health"
```

The active upstream URL, container name, gateway prefix, timeouts, and request
limit are available under `three_d.pixal3d`:

```bash
curl --fail-with-body --silent --show-error "$BASE_URL/limits"
```

## Timeouts and errors

The gateway permits up to 7,200 seconds for the Pixal3D upstream response. Set
the calling client's timeout slightly above that, such as 7,500 seconds. The
service watchdog allows 3,600 seconds at resolution 1024 and 7,200 seconds at
1536. Do not immediately retry a client timeout without checking `/health` and
`/jobs/last`, because the original generation may still be running.

Error responses normally use `{"detail":"message"}`.

| Status | Meaning |
| ---: | --- |
| `400` | Empty, unreadable, or fully transparent input image. |
| `401` | Missing or invalid admin token for a protected container mutation. |
| `404` | No last job exists, or the requested job/output UUID was not found. |
| `409` | The model is loading or another Pixal3D operation is running. |
| `413` | The gateway request, image byte size, or decoded pixel count is too large. |
| `422` | A required field is missing or a parameter is outside its accepted range. |
| `429` | The shared GPU-heavy slot was unavailable for 300 seconds. |
| `500` | Model loading, generation, or export failed. Inspect health, job metadata, and logs. |
| `502` | The container appears to run, but the gateway cannot reach its API. |
| `503` | The container is stopped, startup failed, or `/ready` is not currently satisfied. |

## ROCm quality and memory notes

The tested shared-R9700 deployment uses conservative NAF conditioning grids:

```text
GPU_MEMORY_FRACTION=0.60
NAF_SHAPE_TARGET_SIZE=256
NAF_TEXTURE_TARGET_SIZE=256
NAF_BF16=1
SMART_VRAM=false
```

These settings affect the pixel-aligned NAF conditioning grid, not the final
requested 1024/1536 generation resolution. The upstream Pixal3D settings use a
512 shape grid and 1024 texture grid, which may preserve more fine conditioning
detail but require substantially more ROCm memory. On a mostly dedicated GPU,
increase one setting at a time and compare the same source, seed, FOV, sampler,
and export settings. Process recycling remains recommended after each completed
job so other gateway services regain the card's memory.
