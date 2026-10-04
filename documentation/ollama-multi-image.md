# Chat5 Ollama multi-image release

## Scope and behavior

The existing Chat5 path (`chat5_chat.pug` → `chat5_5.js` →
`chat5_5handler.js` → `conversationService.postToConversationNew` →
`messageService.generateAIMessage` → `Ollama_API.submitChatJob`) sends local
model requests to `POST /llm/chat/jobs`. The adapter now preserves every
selected user image in original message and array order. The same policy
applies to `/llm/chat`, `chatWithThinkingAndTools`, and `chatGemma4`.
Gemma 4 no longer silently retains only the last image.

Selection still applies `startMessageId`, hidden-message filtering and
`maxMessages` before image validation. Assistant images, reasoning and tool
replay attachments are not image inputs. Text and image-only messages remain
in order. Tool continuation and compatibility retries retain the original
image history exactly once per outbound request, not an accumulating budget
across requests. Each round still incurs model processing cost.

`content.images` accepts bare standard base64 or base64 raster data URLs
(`image/png`, `jpeg`, `jpg`, `webp`, `gif`); the prefix is removed before sending.
This is transport normalization, not a guarantee that each model decodes every
format. Remote URLs and other data URL types are rejected and never fetched.
Existing `content.image` filenames still load JPEG bytes from `public/img` as
bare base64. Unreadable files fail with a safe error instead of silently losing
an attachment. No schema, upload, storage, UI, model DB or OpenAI change is
required. Normal uploads still convert to JPEG and shrink to short side ≤768
and long side ≤2048 pixels; this does not guarantee a particular byte size.

## Provider policy and compatibility

The existing `/llm/models` cache is reused after the existing model availability
check. Cached `models[].allow_images` overrides the Site card, including an
explicit `false`. Valid non-negative integer `limits.max_images` and
`limits.max_image_bytes` apply to the entire selected request. Oversized or
nonvision image requests fail before POST; attachments are never truncated to
fit. Byte preflight sums `floor(base64.length * 3 / 4)` per image, a conservative
decoded-size estimate that includes base64 padding overhead. Thus input within
a few bytes of the decoded budget can be rejected conservatively. Base64 wire
size is about one third larger, plus JSON overhead.

No new mandatory discovery request or per-request refresh is introduced. When
discovery omits image metadata, legacy Site `allow_images`/`in_modalities` and
the existing Gemma 4 vision fallback apply, with no invented count/byte quota.
The Gateway validates actual policy on every submission, including when the
cache is stale or incomplete. The cache has no TTL; restarting Site or calling
the existing `loadModelList()` refreshes it. Policy changes should precede the
Site restart. Cached declarations are configuration, not evidence of accuracy.

For `submitChatJob`, `chatWithThinkingAndTools`, and `chatGemma4`, explicit
`options.maxImages` is an additional non-negative integer cap; the smaller of
it and the provider cap wins. Omitted/`null` means no caller cap. **Behavior
change:** `0` rejects image-bearing requests rather than stripping images, `1`
rejects multiple images rather than keeping the last, and values above `1`
are now enforced. Invalid values fail safely. Text-only requests work with `0`.

The intended Gateway release is commit `7e83dc4` on
`codex/ollama-three-image-policy`, pushed but **not deployed** when this Site
work began. It sets **three images TOTAL INCLUDING HISTORY** and an aggregate
**6,000,000-byte estimated image budget** for these seven catalog entries:

- `gemma3:12b`
- `gemma4:e4b`, `gemma4:12b`, `gemma4:26b`, `gemma4:31b`
- `qwen3.6:27b`, `qwen3.8:27b`

Before that deployment the policy is one image request-wide, and this adapter
correctly rejects a second image if that policy is cached. The count of three
is conservative Gateway policy, not a universal native model maximum. Do not
enable images for `muse-glimmer:30b-kquant-17gb`: its Gateway declaration is
false and its installed artifact lacks vision, despite the Site card.

More images consume visual context, GPU memory and inference time. Resizing
and compression can obscure details; fitting the count/byte budget does not
guarantee sufficient context, resources or correct comparisons. Exclude older
image messages, advance the start message, reduce the message window, or start
a fresh conversation when the selected history would exceed policy.

## Evidence and automated validation

The supplied investigation inspected pinned Ollama 0.32.13 image-array handling
for installed gemma3/gemma4/qwen35 families. The native test evidence is limited:

- `gemma3:12b`: all eight cases passed — 1/2/3 chat images distributed in the
  tested same/separate-message arrangements, plus 1/2/3 generate images.
- `qwen3.8:27b-codex`: accepted two images (HTTP 200, `done_reason: stop`) but
  confused colors. Acceptance is not accurate visual comparison.
- `gemma4:e4b-codex`: only the single-image case ran; lime naming and duplicate
  output stopped the test. No native multi-image accuracy claim follows.
- Other exact tags and multi-image cases were not run. mllama has separate
  native restrictions and is not installed; this adapter adds no support claim.

Site regression tests mock all network calls; they perform no live inference:

```sh
npm test -- tests/unit/ollamaApiImages.test.js tests/unit/ollamaApiTools.test.js tests/unit/messageService.test.js tests/unit/conversationService.test.js tests/unit/chat5MessageSelection.test.js --coverage=false --runInBand
npm test -- --runInBand
```

Coverage includes single/2/3 images in order, separate/combined messages,
stored JPEGs, all four adapter entry points, Gateway one/three-image policy,
nonvision declarations, count/aggregate byte rejection, explicit caller caps,
message/role filters, cache fallback, tool continuation/retries and safe logs.

## Security scope

This is maintenance of the existing logged-in Chat5 integration, not a new
route, principal, capability, storage mechanism or authorization redesign.
Existing conversation access and background-job ownership remain legacy
dependencies under `security-framework.md`; this release does not claim to
migrate those controls or the legacy public JPEG storage. Private chat input
continues to go only to the configured Gateway origin
(`OLLAMA_BASE_URL`, then `AI_GATEWAY_BASE_URL`, default
`http://192.168.0.20:8080`). No new URL fetching is introduced.

Input normalization and policy violations have negative tests. New policy
warnings use category `ollama_image_policy` with reason/count/byte metadata;
file-read failures omit filenames and filesystem error details. Submission
debug records summarize roles/image counts and redact request text/tool
definitions; submission failures record HTTP status instead of provider bodies
that might echo images or prompts. Existing response logging/retention outside
these submission changes remains in place. No secrets or personal test data
are required.

## Production Site deployment (operator action)

No deployment, restart or live inference is performed by this implementation.
Use the separately supplied exact Gateway deployment instructions first.

1. Deploy Gateway `7e83dc4` and verify `/llm/models` on the configured origin:
   the intended vision entry must declare `allow_images: true`, `max_images: 3`
   and `max_image_bytes: 6000000`. Confirm Muse Glimmer still disallows images.
2. On Lennart's Windows Site host, open PowerShell in the production checkout:

   ```powershell
   Set-Location C:/Projects/lentmiien-site
   git status --short
   git rev-parse HEAD
   git fetch origin
   git log --oneline HEAD..origin/codex/chat5-ollama-multi-image
   git merge --ff-only origin/codex/chat5-ollama-multi-image
   ```

   Record the prior revision for rollback (the supplied clean production
   baseline was `e69775d9856234ab675e2b3cb4f59a0fa63a440c`). Preserve local
   changes; resolve any non-fast-forward situation through the normal release
   process rather than resetting the checkout. Review the fetched commit hash
   against the release report before updating. No dependency install, database
   migration, model-card edit or environment change is needed for this patch.
3. Restart Site once through its existing production launch/service procedure
   so the adapter and model cache reload. This repository does not establish a
   Windows service name. `npm start` runs mutating `prestart`/`setup.js` and is
   not a harmless smoke test; use the established operational procedure.
4. Confirm database readiness and Gateway connectivity, then use an authorized
   Chat5 test conversation with non-sensitive images. Verify one, two and
   three images, including across history; pending responses should resolve.
   Verify a fourth total image is rejected usefully without a partial request.
   Observe `ollama_image_policy`, `ollama_background_job` and `ollama_chat`
   failures, and assess answer accuracy separately from job acceptance.

Roll back this Site commit with a normal revert/release and restart if needed;
there is no data migration to undo. That restores Gemma 4's old last-image
truncation. The raised Gateway policy can remain during a Site rollback.
Rolling Gateway back to one image while retaining this Site version causes
multi-image requests to fail (possibly at Gateway until Site's cache refreshes);
it must never be treated as permission to silently discard images.
