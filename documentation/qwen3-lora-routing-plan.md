# Qwen3 LoRA Routing Plan

This document describes the planned next step for the Qwen3 LoRA workflow: route a new prompt to the most suitable released LoRA adapter by comparing the prompt embedding against embeddings generated from training prompts.

This is planning-only groundwork. The current implementation should keep training groups, CSV export, dataset upload, and direct adapter testing behavior unchanged until the router is intentionally built.

## Goal

Train multiple LoRA adapters for common task families, then add a routing layer that:

1. Accepts a user prompt and optional system prompt.
2. Generates an embedding for the user prompt.
3. Finds the closest matching training-prompt embedding from released LoRA adapters.
4. Selects the adapter linked to that nearest match.
5. Uses the matching adapter to generate the final output.

The router should only consider release adapters. Test adapters and in-progress experiments must not be eligible for automatic routing.

## Current Baseline

The current training data flow already provides the key source data:

- Chat5 conversation entries can be added to training groups.
- Each training entry records a conversation id, prompt message ids, and one output message id.
- CSV export produces `system,prompt,response` rows for Qwen3 LoRA datasets.
- The `system` value is pulled from `conversation.metadata.contextPrompt`.
- The `prompt` value is built from selected `content.text` prompt messages.
- The `response` value is the selected output message `content.text`.
- Qwen3 LoRA admin can upload a training group as a dataset.

The routing layer should build on this instead of introducing a separate data-capture path.

## Release-Only Adapter Registry

Add a release registry before enabling automatic routing. A future collection could store records like:

```js
{
  adapterName: 'support-reply-tone-v3',
  displayName: 'Support reply tone',
  status: 'release', // draft | test | release | archived
  baseModel: 'qwen3',
  trainingGroupId: 'support-reply-tone',
  datasetId: '...',
  trainingJobId: '...',
  defaultSystemPrompt: '...',
  description: 'Short description of the task family.',
  createdBy: '...',
  releasedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

Routing must filter on `status: 'release'`. This keeps early experiments, failed adapters, and short test runs out of production prompt routing.

## Embedding Index

When a LoRA is promoted or trained as a release adapter, create embeddings for the exported training prompts and link each embedding to the release adapter.

A future collection could store:

```js
{
  adapterName: 'support-reply-tone-v3',
  trainingGroupId: 'support-reply-tone',
  trainingEntryId: '...',
  conversationId: '...',
  promptMessageIds: ['...'],
  outputMessageId: '...',
  promptText: 'The exact prompt text used for embedding.',
  promptHash: 'sha256...',
  embeddingModel: 'text-embedding-3-small',
  embedding: [/* vector */],
  defaultSystemPrompt: '...',
  createdAt: Date
}
```

Store the system prompt with the embedding record or resolve it through the release registry. The registry should hold the adapter-level default system prompt; embedding rows may keep a copy for auditability.

## Default System Prompt Rule

The future router should accept an optional system prompt.

- If a system prompt is provided by the caller, use it for generation.
- If no system prompt is provided, use the selected adapter release `defaultSystemPrompt`.
- The default should initially come from the training conversation `metadata.contextPrompt`, preferably from the most representative or explicitly selected training entry.

Later, the group management page can expose a field for a curated default system prompt so it is not accidentally tied to one conversation.

## Training-Time Workflow

The future release workflow should be:

1. Create or update a training group from Chat5 examples.
2. Export/upload the group as a Qwen3 LoRA dataset.
3. Train the LoRA adapter.
4. Evaluate the adapter manually in the current admin tool.
5. Promote the adapter to `release`.
6. On promotion, generate embeddings for each prompt row in the release dataset.
7. Store embedding records linked to the release adapter.
8. Store or confirm the adapter default system prompt.

Embedding generation should happen on promotion or release refresh, not during every small test training run. This avoids filling the routing index with experimental adapters.

## Runtime Routing Workflow

Future request shape:

```js
{
  prompt: 'User task prompt',
  system: 'Optional system prompt',
  max_new_tokens: 512,
  temperature: 0
}
```

Routing steps:

1. Validate the prompt.
2. Generate an embedding for the prompt.
3. Search only embedding records linked to `release` adapters.
4. Rank candidates by cosine similarity.
5. Pick the best candidate if it passes a configurable threshold.
6. Load the matching adapter name and default system prompt.
7. Generate with Qwen3 LoRA using:
   - `adapter_name`: selected released adapter
   - `system`: caller-provided system prompt, or adapter default
   - `prompt`: caller prompt
8. Return the generated response plus routing metadata for inspection.

Suggested response metadata:

```js
{
  adapter_name: 'support-reply-tone-v3',
  route: {
    matched_training_entry_id: '...',
    matched_training_group_id: 'support-reply-tone',
    similarity: 0.87,
    embedding_model: 'text-embedding-3-small',
    fallback_used: false
  }
}
```

## Fallback Behavior

The router needs explicit fallback rules:

- If no release adapters exist, generate with the base model.
- If embedding generation fails, either return an error or fall back to base model based on route configuration.
- If best similarity is below threshold, fall back to base model or a configured default adapter.
- If the selected adapter is unavailable in the Qwen3 LoRA service, fall back or fail clearly.

The first implementation should prefer visible, conservative behavior over silent routing. A route-debug panel will make it much easier to tune thresholds and training coverage.

## Admin UI Additions

Planned admin surfaces:

- Release adapter list:
  - adapter name
  - status
  - training group
  - dataset id
  - embedding count
  - default system prompt preview
- Promote to release action from an evaluated adapter.
- Rebuild embeddings action for a release adapter.
- Routing test panel:
  - input prompt
  - optional system prompt
  - top matching embeddings
  - selected adapter
  - generated response

The existing Qwen3 LoRA admin page is the natural place for the routing test panel. The training group page is the natural place for default system prompt curation.

## Data Quality Notes

The quality of routing depends more on prompt coverage than output quality.

Good routing examples should have:

- prompt text that represents the real task trigger
- enough variation to cover common phrasing
- clean separation between prompt and target output
- representative system prompts
- release adapters only after manual output checks

If a LoRA handles a broad task family, use multiple training entries with varied prompts. If two adapters are close in prompt space but require different behavior, add more examples that make the distinction explicit.

## Future Implementation Phases

### Phase 1: Release Metadata

- Add adapter release registry collection.
- Add admin controls for marking adapters as draft/test/release/archived.
- Add default system prompt field.
- Keep routing disabled.

### Phase 2: Embedding Index

- Add prompt embedding collection.
- Generate embeddings from release training group prompts.
- Add rebuild action and stats.
- Keep routing disabled except for inspection/testing.

### Phase 3: Route Preview

- Add a route-preview endpoint.
- Show top matches and similarity scores.
- Tune similarity threshold manually.
- Do not generate with the selected LoRA yet unless explicitly requested.

### Phase 4: Routed Generation

- Add routed generation endpoint/tool.
- Use selected released adapter automatically.
- Include route metadata in responses.
- Add fallback controls.

### Phase 5: Chat Tool

- Add a chat-style UI for the base+LoRA system.
- Accept prompt plus optional system prompt.
- Route to the best release adapter.
- Generate and display output with selected adapter metadata.

## Open Decisions

- Which embedding model should be standard for the routing index?
- Should embeddings be generated per training entry or per prompt chunk when multiple prompt messages are selected?
- Should release adapters have one curated default system prompt or inherit from the closest matched training entry?
- What similarity threshold is high enough to route automatically?
- Should the router support multiple candidate adapters with a manual override?
- Should the fallback be base Qwen3, a default release adapter, or an explicit error?

## Non-Goals For Now

- No automatic routing for test adapters.
- No changes to existing Qwen3 LoRA generation behavior.
- No automatic retraining or promotion.
- No embedding generation during small experimental training runs.
- No chat UI until release metadata and route preview are reliable.
