# LocateAnything Gateway Usage Guide

Use the gateway base URL from the app:

```text
http://192.168.0.20:8080
```

LocateAnything jobs are synchronous. A `POST` request starts the model job, and
the HTTP response is the final result. There is no job ID or polling endpoint.
The first request can be slow because the model may need to load, and the service
unloads the model after each completed job.

## Endpoints

### JSON Image Request

Use this when the app already has an image URL or base64 image data.

```http
POST /image/locateanything
POST /image/locateanything/locate
```

Both routes do the same thing.

Request body:

```json
{
  "image_url": "https://example.com/screenshot.png",
  "task": "ground_gui",
  "query": "the save button",
  "output_type": "point",
  "generation_mode": "hybrid",
  "max_image_edge": 1280,
  "max_new_tokens": 256,
  "do_sample": false,
  "temperature": 0.0
}
```

Instead of `image_url`, the app can send `image_base64`. `image_base64` may be a
plain base64 string or a data URL such as `data:image/png;base64,...`.

### Multipart File Request

Use this when the app uploads a local image file.

```http
POST /image/locateanything/file
POST /image/locateanything/locate/file
```

Both routes do the same thing.

Example:

```bash
BASE_URL="http://192.168.0.20:8080"

curl -s -X POST "$BASE_URL/image/locateanything/file" \
  -F "file=@screenshot.png" \
  -F "task=ground_gui" \
  -F "query=the save button" \
  -F "output_type=point" \
  -F "generation_mode=hybrid" \
  -F "max_image_edge=1280" \
  -F "max_new_tokens=256" \
  -F "do_sample=false" \
  -F "temperature=0.0"
```

## Tasks

### `ground_gui`

Locate a UI control or UI region described by `query`.

Use `output_type=point` when the app needs a click target. Use
`output_type=box` when the app needs a rectangular region.

```bash
curl -s -X POST "$BASE_URL/image/locateanything/file" \
  -F "file=@screenshot.png" \
  -F "task=ground_gui" \
  -F "query=the settings gear" \
  -F "output_type=point" \
  -F "do_sample=false" \
  -F "temperature=0.0"
```

### `point`

Return a point for the target described by `query`.

```json
{
  "image_url": "https://example.com/screenshot.png",
  "task": "point",
  "query": "the button that saves the file",
  "generation_mode": "hybrid",
  "max_image_edge": 1280,
  "max_new_tokens": 256,
  "do_sample": false,
  "temperature": 0.0
}
```

### `ground_single`

Locate the best single instance matching `query`.

```json
{
  "image_url": "https://example.com/scene.jpg",
  "task": "ground_single",
  "query": "the leftmost bottle",
  "generation_mode": "hybrid",
  "max_image_edge": 1280,
  "max_new_tokens": 256,
  "do_sample": false,
  "temperature": 0.0
}
```

### `ground`

Locate all instances matching `query`.

```json
{
  "image_url": "https://example.com/scene.jpg",
  "task": "ground",
  "query": "all visible charging cables",
  "generation_mode": "hybrid",
  "max_image_edge": 1280,
  "max_new_tokens": 1024,
  "do_sample": false,
  "temperature": 0.0
}
```

### `detect`

Detect instances from a provided category list.

For JSON requests, send `categories` as an array:

```json
{
  "image_url": "https://example.com/desk.jpg",
  "task": "detect",
  "categories": ["mug", "keyboard", "phone", "cable", "monitor"],
  "generation_mode": "hybrid",
  "max_image_edge": 1280,
  "max_new_tokens": 1024,
  "do_sample": false,
  "temperature": 0.0
}
```

For multipart requests, send `categories` as a comma-separated form value:

```bash
curl -s -X POST "$BASE_URL/image/locateanything/file" \
  -F "file=@desk.jpg" \
  -F "task=detect" \
  -F "categories=mug,keyboard,phone,cable,monitor" \
  -F "generation_mode=hybrid" \
  -F "max_new_tokens=1024" \
  -F "do_sample=false" \
  -F "temperature=0.0"
```

### `ground_text`

Locate a visible text phrase or text-like region described by `query`. This is
for localization, not transcription.

```json
{
  "image_url": "https://example.com/page.png",
  "task": "ground_text",
  "query": "the error message",
  "generation_mode": "hybrid",
  "max_image_edge": 1280,
  "max_new_tokens": 256,
  "do_sample": false,
  "temperature": 0.0
}
```

### `detect_text`

Locate visible text regions. This is not a replacement for the OCR services when
the app needs accurate extracted text.

```json
{
  "image_url": "https://example.com/page.png",
  "task": "detect_text",
  "generation_mode": "hybrid",
  "max_image_edge": 1280,
  "max_new_tokens": 1024,
  "do_sample": false,
  "temperature": 0.0
}
```

## Request Fields

| Field | Type | Notes |
| --- | --- | --- |
| `image_url` | string | JSON requests only. URL to download and process. |
| `image_base64` | string | JSON requests only. Plain base64 or data URL. |
| `file` | file | Multipart requests only. |
| `task` | string | One of `detect_text`, `detect`, `ground`, `ground_single`, `ground_text`, `ground_gui`, `point`. Default is `detect_text`. |
| `query` | string | Required for `ground`, `ground_single`, `ground_text`, `ground_gui`, and `point`. |
| `categories` | array or string | For `detect`. JSON uses an array. Multipart uses comma-separated text. |
| `output_type` | string | Mainly for `ground_gui`. Use `point` or `box`. Default is `box`. |
| `generation_mode` | string | One of `fast`, `hybrid`, or `slow`. Default is `hybrid`. |
| `max_new_tokens` | integer | Use `256` for single target tasks and `1024` for dense detection. Range is `1` to `8192`. |
| `temperature` | number | Use `0.0` with `do_sample=false` for deterministic app behavior. |
| `do_sample` | boolean | Use `false` for deterministic app behavior. |
| `top_p` | number | Default is `0.9`. Usually leave unchanged when `do_sample=false`. |
| `repetition_penalty` | number | Default is `1.1`. |
| `max_image_edge` | integer | Resizes images so the longest edge is at most this value. Use `1280` to start. `0` disables resizing. |

## Recommended Defaults For App Integration

Use these defaults unless a specific task needs more detail:

```json
{
  "generation_mode": "hybrid",
  "max_image_edge": 1280,
  "max_new_tokens": 256,
  "do_sample": false,
  "temperature": 0.0
}
```

For dense detection, raise `max_new_tokens` to `1024`.

If the model nearly works but misses small targets, try `max_image_edge=1600`.
Only use `max_image_edge=2500` or `generation_mode=slow` when the use case is
valuable enough to justify the extra latency and VRAM.

Set the client HTTP timeout high enough for cold starts and model generation.
`120` to `300` seconds is a reasonable starting range.

## Response Shape

Successful responses are JSON:

```json
{
  "model_id": "nvidia/LocateAnything-3B",
  "task": "ground_gui",
  "answer": "<ref>save button</ref><box><512><441></box>",
  "boxes": [],
  "points": [
    {
      "label": "save button",
      "x": 655.36,
      "y": 564.48
    }
  ],
  "image_size": {
    "width": 1280,
    "height": 960
  },
  "resize": {
    "scaled": true,
    "original": {
      "width": 2560,
      "height": 1920
    },
    "final": {
      "width": 1280,
      "height": 960
    },
    "max_image_edge": 1280
  },
  "stats": {
    "duration_sec": 18.42,
    "device": "cuda",
    "dtype": "bfloat16",
    "backend": "rocm",
    "attn_implementation": "sdpa",
    "generation_mode": "hybrid",
    "max_new_tokens": 256,
    "model_stats": null,
    "unload_after_job": true
  }
}
```

Use `points` for click targets. Each point has:

- `label`: model label, if supplied
- `x`: pixel x-coordinate
- `y`: pixel y-coordinate

Use `boxes` for region outputs. Each box has:

- `label`: model label, if supplied
- `x1`, `y1`: top-left pixel coordinate
- `x2`, `y2`: bottom-right pixel coordinate

`answer` is the raw model markup. Keep it for debugging, but app logic should
normally use `points` and `boxes`.

## Coordinate Handling

Coordinates are relative to `image_size`, which is the image size actually sent
to the model after any resize.

If `resize.scaled=false`, use the coordinates directly on the original image.

If `resize.scaled=true`, scale coordinates back to the original image before
using them on the original asset:

```text
scale_x = resize.original.width / resize.final.width
scale_y = resize.original.height / resize.final.height

original_x = x * scale_x
original_y = y * scale_y
```

For boxes, apply the same scaling to `x1`, `y1`, `x2`, and `y2`.

## Error Handling

Common status codes:

| Status | Meaning |
| --- | --- |
| `400` | Invalid request, missing image, missing query, missing categories, or unsupported task. |
| `413` | Uploaded or downloaded image is too large. |
| `422` | Request field validation failed. |
| `502` | Gateway could not get a valid response from the LocateAnything upstream service. |
| `503` | LocateAnything service is unavailable. |

For app code, treat `502` and `503` as retryable or user-visible service
availability errors. Treat `400`, `413`, and `422` as request construction
problems.

## Practical Use Cases

The best candidates are non-OCR localization tasks:

- `ground_gui` with `output_type=point` for UI click target discovery
- `ground_single` for resolving one object among several similar objects
- `ground` for finding all instances matching a natural-language description
- `detect` for open-set object or region detection without a fixed detector
- `ground_text` or `detect_text` only to find text regions before sending crops
  to a stronger OCR model

Do not use LocateAnything as the main OCR transcription model.
