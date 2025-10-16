# ComfyUI Server Changes - Video Output Support

This document summarizes the backend changes required for handling video-generating workflows and the additional API surface that accompanies them. Share these details with the client-side team so they can update their application logic and UI.

---

## 1. New Video Workflows

- **`img2vid_wan2_2_14b`**  
  - Uses the Wan 2.2 i2v workflow accelerated by the Lightning LoRA.  
  - Faster renders with slightly less motion range.  
- **`img2vid_wan2_2_14b_regular`**  
  - Wan 2.2 i2v workflow without the Lightning speed-up.  
  - Slower renders but produces more dynamic motion.

Both workflows:
- Accept the same input schema as other image-based entries (`prompt`, `negative`, `image`, size/length/fps, `seed`).  
- Produce `.mp4` files saved under `ComfyUI/output/video`.  
- Are tagged with an `outputType` of `"video"` (see section 2).

Update client workflow pickers to surface the two options with their revised descriptions above.

---

## 2. Workflow Metadata (`/v1/workflows`)

Every workflow definition now carries an `outputType` property:
- Existing image workflows explicitly return `"image"`.
- The new Wan video workflows return `"video"`.

API response example:
```json
{
  "workflows": [
    {
      "key": "img2vid_wan2_2_14b",
      "name": "Image-to-Video (Wan 2.2 Video Lightning)",
      "description": "...",
      "outputType": "video",
      "inputs": [ /* unchanged */ ]
    }
  ]
}
```

**Client impact:** differentiate assets by type for UI copy, validation, or post-processing.

---

## 3. Job Status (`/v1/jobs/:id`)

- Job file entries now include:
  - `media_type` - `"image"` or `"video"` based on filename.
  - `download_url` - normalized to `/v1/jobs/:id/files/:index` (old `/images/` alias still works for backward compatibility).
- The backend collects both `images[]` and `videos[]` from ComfyUI history, so video outputs appear alongside images in the job payload.

**Client impact:** switch to the new `download_url` when available and handle `media_type === "video"` for display or playback.

---

## 4. Job File Download (`/v1/jobs/:id/files/:index`)

- New unified download route streams either images or videos with the correct `Content-Type`.
- Legacy `/v1/jobs/:id/images/:index` endpoint now delegates to the unified logic (safe to keep but consider migrating).

**Client impact:** adjust download/preview code to use `/files/` to support both media types seamlessly.

---

## 5. File Buckets (`/v1/files/...`)

- The bucket validator now allows three options: `"input"`, `"output"`, and `"video"`.
- Backed by a shared `FILE_BUCKETS` map that defines directory + extension filters.
- Listing (`GET /v1/files/:bucket`) for the video bucket scans `ComfyUI/output/video` and includes `.mp4` files.
- Direct download (`GET /v1/files/:bucket/:filename`) now works for videos as well.

**Client impact:** add the `"video"` option to any bucket selectors or file explorers so users can browse completed videos.

---

## 6. Filesystem Preparation

The server bootstrap now ensures the `ComfyUI/output/video` directory exists. No client action required, but note the new folder when managing storage or backups.

---

## 7. MIME & Media Detection Helpers

Internal helper changes worth noting for completeness:
- `detectMediaType` and `detectMimeType` align response metadata and HTTP headers to the file extension.
- `collectOutputsFromHistory` aggregates both `images`, `videos`, and `gifs` arrays returned by ComfyUI.

These are server-side only but explain why clients now see richer metadata.

---

## Action Items for Client App

1. Update workflow listings to read and display the new `outputType`.
2. Highlight the difference between the two Wan video workflows (fast Lightning vs. slower, more dynamic regular).
3. Handle `media_type === "video"` when showing job files (e.g., render a video player, show video-specific icons/text).
4. Change download links to `/v1/jobs/:id/files/:index` wherever possible.
5. Extend file browser UI to include the `"video"` bucket for listing and downloading `.mp4` outputs.

Once these adjustments are made, the user-facing app will be fully aware of video-generating workflows and the associated media assets.
