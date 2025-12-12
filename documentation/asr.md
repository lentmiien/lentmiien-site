# Whisper Transcription Service (faster‑whisper) – Integration Guide

## Overview

This service provides local speech‑to‑text (ASR) via **faster‑whisper** (Whisper large‑v3 on GPU, CPU fallback). It is intended for:

- Voice input (mic recordings → text)
- Transcribing saved audio files (meetings, notes, etc.)
- Feeding transcripts into the embedding/search pipeline (Tier A for “search all”, Tier B for curated “knowledge”)

The service exposes:

- `GET /health` – readiness
- `GET /diag` – runtime diagnostics (ctranslate2 CUDA availability)
- `POST /transcribe` – transcription endpoint (`multipart/form-data` upload)

Swagger UI is available at: `http://<host>:8010/docs`

---

## When to call ASR in the NodeJS app

### 1) Voice-to-text input for chat / commands
Use `/transcribe` when the user:

- presses a “hold to talk” button,
- uploads an audio clip,
- uses voice to search,
- dictates a note.

**Typical flow**
1. Record audio (web app or desktop app)
2. Upload to `/transcribe`
3. Receive `text`
4. Use the text as:
   - an LLM prompt (Ollama)
   - a query to Tier A embeddings (semantic search)
   - optionally: store the transcript + embed it into your databases

### 2) Ingestion pipeline for audio archives
Use `/transcribe` when you ingest a new audio file into your system.

**Typical flow**
1. New audio file stored in your data store
2. Call `/transcribe` and store:
   - full transcript
   - segments
   - detected language
3. Chunk transcript (paragraph-level / time-based) and embed:
   - Tier A: always
   - Tier B: only if you mark it as curated / trusted / knowledge-grade

### 3) Workflow safety policy
Per your rule: **Tier B or higher must be used for automated workflows** (to avoid random junk contaminating workflows).

Applied to ASR:
- You can always transcribe anything.
- But “automation that acts” (e.g., auto tasks, auto summaries, auto decisions) should:
  - either use **Tier B retrieval** on curated sources, or
  - store ASR outputs in “untrusted” Tier A index until reviewed.

---

## API: `POST /transcribe`

### Request
`multipart/form-data`

Fields:

- `file` (required): audio file (mp3, wav, m4a, flac, ogg, webm, etc.)
- `language` (optional): `"auto"` (default), or `"en" | "ja" | "sv" | ...`
- `task` (optional): `"transcribe"` (default) or `"translate"`
- `vad_filter` (optional): boolean (default `true` in the service)
  - If `true`, uses Silero VAD (requires `onnxruntime` installed in container).
- `beam_size` (optional): integer (default `5`)
- `temperature` (optional): float
- `word_timestamps` (optional): boolean (default `false`)

### Response
JSON:

```json
{
  "text": "…",
  "language": "en",
  "duration": 12.34,
  "segments": [
    { "id": 0, "start": 0.0, "end": 2.5, "text": "Hello…" }
  ]
}
```

---

## Recommended defaults (important)

### Temperature default: set to `1.0` in the Node client (recommended)

You observed that sometimes the transcript ends with a repeating phrase or “mushed” ending, and that **setting `temperature=1` fixes it**.

That can happen because Whisper decoding is sensitive to:
- repetition loops at the end,
- overly deterministic decoding behavior,
- and small acoustic ambiguity.

Even though temperature is usually thought of as “more randomness”, in practice it can break a bad deterministic loop in decoding. Since your tests show `temperature=1` improves reliability and doesn’t cause obvious degradation, it’s a reasonable default **for interactive voice input**.

**Suggested Node defaults**
- `temperature = 1.0`
- `beam_size = 5`
- `vad_filter = true` (for recordings with silences)
- `language = auto` for general use, or explicit language for known context

### When to use `vad_filter=false`
Use `vad_filter=false` when:
- the clip is extremely short and VAD may crop it too aggressively
- you suspect VAD is cutting off quiet endings
- you’re transcribing continuous speech with no long silences (e.g. a read sentence)

---

## NodeJS integration example

### Minimal helper: `asrClient.js`

```js
import fs from "node:fs";
import path from "node:path";

const ASR_API_BASE = process.env.ASR_API_BASE || "http://localhost:8010";

/**
 * Transcribe an audio file using the Whisper API.
 *
 * @param {string} filePath
 * @param {object} options
 * @returns {Promise<object>} { text, language, duration, segments }
 */
export async function transcribeFile(filePath, options = {}) {
  const form = new FormData();

  // Node 18+ FormData supports Blob; simplest is to use a ReadStream for file
  const stream = fs.createReadStream(filePath);

  // If you want to provide a filename (recommended):
  form.append("file", stream, path.basename(filePath));

  // Recommended defaults (tuned based on local tests)
  form.append("language", options.language ?? "auto");
  form.append("task", options.task ?? "transcribe");
  form.append("vad_filter", String(options.vadFilter ?? true));
  form.append("beam_size", String(options.beamSize ?? 5));
  form.append("temperature", String(options.temperature ?? 1.0)); // important default
  form.append("word_timestamps", String(options.wordTimestamps ?? false));

  const res = await fetch(`${ASR_API_BASE}/transcribe`, {
    method: "POST",
    body: form,
    // IMPORTANT: do NOT manually set Content-Type for multipart
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ASR error: ${res.status} ${res.statusText} - ${text}`);
  }

  return await res.json();
}
```

### Usage example: voice input → chat

```js
import { transcribeFile } from "./asrClient.js";

async function voiceToChat(audioPath, ollamaClient) {
  const asr = await transcribeFile(audioPath, {
    language: "auto",
    temperature: 1.0,
    vadFilter: true,
  });

  const userText = asr.text.trim();
  if (!userText) return { text: "", reason: "empty_transcript" };

  // send to LLM
  const answer = await ollamaClient.chat({
    prompt: userText,
    // ...
  });

  return { transcript: asr, answer };
}
```

### Usage example: ingest audio → store transcript → embed

```js
import { transcribeFile } from "./asrClient.js";
import { embedTexts as embedTierA } from "./tierAClient.js";

async function ingestAudioRecording({ audioPath, recordingId }, db) {
  const asr = await transcribeFile(audioPath, {
    language: "auto",
    temperature: 1.0,
    vadFilter: true,
  });

  // Store transcript
  await db.collection("recordings").updateOne(
    { _id: recordingId },
    {
      $set: {
        transcript: asr.text,
        transcriptLanguage: asr.language,
        transcriptSegments: asr.segments,
        transcriptDuration: asr.duration,
        transcriptUpdatedAt: new Date(),
      },
    }
  );

  // Tier A embedding for search-all
  const embedResp = await embedTierA([asr.text], {
    autoChunk: true,
    includeText: true,
  });

  // Insert vectors into embeddings_tierA with metadata
  // (similar to your OCR pipeline)
  const records = embedResp.vectors.map((vec, i) => {
    const ch = embedResp.chunks[i];
    return {
      embedding: vec,
      dim: embedResp.dim,
      source: {
        collection: "recordings",
        id: recordingId,
        contentType: "asr_transcript",
      },
      chunk: {
        index: ch.chunk_index,
        startToken: ch.start_token,
        endToken: ch.end_token,
      },
      preview: ch.text,
      createdAt: new Date(),
    };
  });

  await db.collection("embeddings_tierA").insertMany(records);
}
```

---

## Operational notes

### On-demand GPU behavior
The container is run with:

- `-e USE_ON_DEMAND_GPU=true`

This means:
- CPU model stays loaded for availability.
- GPU model is created per request and released after.
- This keeps VRAM impact low while still giving GPU speed when available.

### Restart policy
Container is started with:

- `--restart unless-stopped`

So it will survive reboots and keep running unless you explicitly stop it.

---

## Troubleshooting quick checklist

- `GET /health` works → API reachable
- `GET /diag` shows `ctranslate2_cuda_device_count >= 1` → GPU usable
- If `vad_filter=true` fails → ensure container includes CPU-only `onnxruntime`
- If you see weird repetition at the end:
  - keep `temperature=1.0` (recommended default)
  - optionally try:
    - `beam_size=3`
    - `vad_filter=false` for very short clips

---

## Why `temperature=1.0` might reduce end-of-transcript repetition (short explanation)

Whisper decoding can sometimes “lock” into a repetitive hypothesis at the end when decoding is very deterministic. A higher temperature introduces mild stochasticity that helps it avoid that pathological loop and choose a more plausible ending. Since your tests show it improves output without obvious downsides, it’s a good pragmatic default for interactive transcription.

---

If you want, I can also give you a tiny “ASR router” function that:
- uses explicit language when your UI knows it (e.g. “Japanese mode”),
- falls back to auto,
- and optionally retries with `vad_filter=false` or different temperature if the transcript ends with repeated phrases (simple heuristic).