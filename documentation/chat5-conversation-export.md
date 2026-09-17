# Chat5 conversation source export

## Security contract

- Zone: logged-in. Interactive principals: admin, family, user with existing `chat5` access. Machine principals: none.
- Data: private/sensitive conversation source. Capabilities: `chat5` and `chat.conversation.export`. The semantic capability is bundled for admin/family/user; other roles need an explicit grant. Existing Chat5 access is still required. No permission migration or new default Chat5 grant.
- Scope: membership (`conversation5.members` contains the validated principal's name); legacy owner (`conversation4.user_id`). These existing schemas use account names, not account IDs. Admin override: none.
- Browser mutations: none; authenticated GET download only, no CSRF token needed. No database writes, migration, provider calls, attachment reads, public files, or persistent exports.
- Limits: 5,000 source references, 20,000 expanded legacy parts, 256 KiB per stored message, 16 MiB cumulative source records and download, 10-second database query timeouts within a 30-second read budget, two concurrent exports per process and one per principal, six requests per minute per principal. Exceeding limits rejects the whole export, never truncates text.
- Output: attachment JSON/JSONL, server-derived ID filename, nosniff, private/no-store, no-referrer. UI uses escaped Pug/textContent and local assets. No analytics added.
- Logging: shared logger, stable operational error/limit/change messages with counts or status only; no IDs, text, provider payloads, user objects or error messages.
- Retention: request memory and user's downloaded file only. Downloaded source remains private and needs user-managed storage/deletion.
- Tests: authentication/capability/membership including admin, malformed input, foreign references, bounds, missing/duplicate references, raw/type filtering, safe rendering/downloads, mutation-free legacy adapter, conservative grouping.
- Legacy dependency: read-only adapter for Chat4 records; no use of the unscoped legacy loaders. Existing Chat5 detail/socket authorization is outside this change.

## Format and operation

### UI and download

Open any authorized `/chat5/chat/<conversation-id>`, expand **Export conversation** below the header actions, select types and format, then **Download export**. Sent prompts and received text responses are selected by default. Hidden records require their type **and** the separate hidden checkbox. “Sent” means a non-`bot` author, including former members; it does not mean only the signed-in user's messages. Unknown/missing authors are review boundaries.

Both formats cover the entire stored reference list regardless of rendered pagination, `maxMessages` or `startMessageId`. Every reference remains represented as a source record or a missing/excluded diagnostic stub. Excluded records contain IDs, positions, type, status and grouping metadata, **no content or raw fields**. JSONL deliberately includes groups with no selected text, marked for review, so filtering cannot silently repair an incomplete history. Selecting an empty type set is rejected.

After download, the controls show reference/selection/diagnostic counts and an explicit list of ambiguous or review groups with zero-based positions. **Download prepared file again** retains that exact in-memory export until another request or leaving the page. It does not reread the database. The browser initiates a normal attachment download; error pages are never downloaded as source.

### Schema version `chat5-source-export/1`

UTF-8 JSON uses an `export_manifest` object containing:

- `schema_version`, `exporter_version`, `exported_at`: schema and implementation versions and export time.
- `conversation`: original ID, `source_collection` (`conversation5` or `conversation4`), source creation/update timestamps or null. Titles, summaries, members, current system context and model settings are deliberately omitted; current metadata would not establish historical effective instructions.
- `options`: canonical `format`, `types`, `include_hidden`, `include_raw`.
- `summary`: original `reference_count`, expanded `record_count`, selected/excluded counts, missing references, duplicate positions, unknown records, and counts of pair/ambiguous/review groups.
- `limitations`: explicit current-source, nontransactional, historical-context, raw/media, and non-training-ready caveats.
- `records`: all positions in original reference order, never timestamp sorted.
- `groups`: candidate/review groups referencing `records` without duplicating their content.

UTF-8 JSONL begins with the same manifest (without `records`/`groups`). Each subsequent line is one **whole** candidate/review group containing `schema_version`, `conversation_id`, and its ordered `records`. A literal newline inside source text is JSON escaped, never an extra JSONL record. JSONL ends with a newline. Keep its manifest with the rows; filters, versions, source timestamps and limitations apply to every row.

Each resolved record has `position` (zero-based original reference index), `message_id`, `source_collection`, `source_part`, `timestamp`, `role`, `content_type`, `hidden`, `selected`, `exclusion_reason`, `status`, `flags`, and available `response_id`, `output_id`, `output_index`, `call_id`, `tool_call_id` (otherwise null). Repeated IDs retain separate positions; later occurrences carry `duplicate_reference`. Missing IDs are minimal stubs with `missing_reference`.

Selected records have `content` with exact stored **string** fields: text for text/reasoning; text/toolOutput/arguments/output for tools/functions; text/transcript/revisedPrompt for media. No trimming, normalization, cleaning, answer concatenation, prompt rewriting or citation removal is performed. Unsupported structured values are identified by `structured_fields_omitted`; they are not stringified or silently treated as text. Media includes `attachment` omission flags. Filenames, local locations, bytes, TTS paths, arbitrary account/provider objects and encrypted reasoning are excluded.

With raw opt-in, `raw` is a **typed allowlist projection**, not a complete provider backup. `raw_policy: typed_allowlist_v1` identifies it. It preserves recognized typed message/text/refusal parts; reasoning/summary parts only for selected reasoning records; recognized tool/function IDs/status/name and string arguments/output; web-search action type/query/queries; and text URL-citation type, offsets, title and HTTP(S) URL without embedded credentials. Nested parts are limited to depth four and must match the selected record's type family. Arbitrary nested objects, unknown provider types/fields, file citations/locations, encrypted content and full envelopes are omitted; unrecognized raw roots are null. Ordinary string source content is not secret-scanned or redacted: anything the conversation author pasted remains exact source text. Store downloads privately.

Group fields:

- `record_type`: `pair_candidate`, `ambiguous_group`, or `review`; none is a verified causal or training pair.
- `group_id`, `position_start`, `position_end`; `prompt_refs` and `response_refs` contain source ID/position/part references.
- `response_groups` collect shared provider response IDs; `call_groups` collect call IDs (falling back to tool-call IDs). These link output parts, **not** prompts to answers.
- `causality: positional_unverified`, `review_status: unreviewed`, `context_sufficiency: unreviewed` on every group.
- `historical_context`: the preceding original-position range (`0` through but excluding `before_position`) and `effective_prompt_available: false`. This is a reference to surviving history, not a claim all of it was sent to the provider.
- `reasons`: e.g. `multiple_prompts`, `multiple_responses`, `unpaired`, `text_filtered_out`, `nontext_user_context`, `unlinked_assistant_part`, `response_crosses_turn_boundary`, or source error/missing/duplicate/unknown/pending/empty/noncompleted flags.

Grouping starts on the **full** sequence. Consecutive user turns followed by responses remain one group. Distinct responses remain alternatives requiring review; multipart text sharing a response ID remains distinct records in one response group. Hidden/tool records with a matching response ID may accompany its answer without becoming answer text. Missing, unknown and duplicate records break adjacency. A response ID crossing groups marks both groups for review. A blank reasoning record is not an empty text answer. The known `Pending response` placeholder, any stored error or noncompleted status, and empty text cannot qualify as an ordinary candidate. Unknown status is explicitly unknown, not evidence of success.

### Sanitized examples

These are schema excerpts using invented IDs and content; omitted fields follow the definitions above. A selected source record retains whitespace:

```json
{
  "position": 0,
  "message_id": "000000000000000000000001",
  "source_collection": "chat5",
  "source_part": null,
  "role": "user",
  "content_type": "text",
  "selected": true,
  "content": { "text": "Explain this example.\nKeep the original spacing.  " }
}
```

An ordinary group is only a positional candidate:

```json
{
  "record_type": "pair_candidate",
  "group_id": "group-0",
  "position_start": 0,
  "position_end": 1,
  "prompt_refs": [{ "position": 0, "message_id": "000000000000000000000001", "source_part": null }],
  "response_refs": [{ "position": 1, "message_id": "000000000000000000000002", "source_part": null }],
  "causality": "positional_unverified",
  "context_sufficiency": "unreviewed",
  "review_status": "unreviewed",
  "historical_context": { "conversation_position_start": 0, "before_position": 0, "effective_prompt_available": false }
}
```

For `user,user,assistant,assistant` at positions 36–39 the exporter writes **one** `ambiguous_group`, with two `prompt_refs`, two `response_refs`, and reasons `multiple_prompts`/`multiple_responses`. It never assigns responses FIFO or to the latest prompt. Source text stays in the ordered records.

### Legacy and reproducibility limits

Legacy Chat4 records expand in the same order as the supported Chat5 page: `images[index]`, optional `sound`, `prompt`, `response`. All parts retain the **original Chat4 ID and reference position**, distinguished by `source_part`; no generated Mongoose IDs, migration or database writes occur. Image “do not use” and legacy sound map to the page adapter's hidden flags. The `record_count` may therefore exceed `reference_count`. Legacy media context makes the group reviewable even if media is filtered out.

Membership, ordered references and conversation timestamps are read again before returning. A detected change aborts with 409; removal of access returns the same 404 as a missing/foreign conversation. This is not a transaction: message edits between batch reads, or changes reversed before the final read, can escape detection. Edits overwrite source content; shallow copies share IDs; deep copies have no durable ancestry; cleanup may have deleted hidden records; concurrent/regenerated outputs may append out of causal order. There is no reconstruction of historical effective prompts, runtime instructions, provider requests or full context snapshots. A response ID identifies outputs from a response, not its input prompt. Finish active generations before exporting and retain both download and manifest for downstream review.

### Deployment and manual checks

1. Deploy the committed revision through the normal release process and restart the Node web process. This task does **not** deploy. No dependencies, environment variables, database migrations, data imports, admin grant changes or background jobs are added. Admin/family/user bundles include the export capability, but an existing typed `chat5` group/user grant and object membership are still required. Custom roles require both `chat5` and `chat.conversation.export` in the role records managed by the existing role administration.
2. Use the pinned Node 24.20.0. Run `npm ci` only if the deployment procedure needs dependency installation. Do not use `npm start` as a casual validation command: `prestart` runs database maintenance and synchronization. Exercise a configured test environment only with its approved lifecycle. Ensure MongoDB is ready; the exporter requires aggregation with `$bsonSize` support (MongoDB 4.4+, within current driver requirements).
3. Keep Cloudflare/reverse-proxy caching disabled for `/chat5/chat/*/export`; preserve private/no-store and attachment headers. No new public or secret-public route, provider traffic, or firewall exception is needed. Process-local limits apply per web worker. Rollback is the previous application revision; there is no data migration to undo.
4. Sign in as Lennart and open `/chat5/chat/699db06614b109d7841a9f65`. Expand **Export conversation**, leave both text types selected and hidden/raw unchecked, select JSON, then download. If the source has not changed from the supplied read-only investigation, expect **179 references, 162 selected, 17 excluded, 0 missing, 0 duplicate positions, 79 pair candidates, 1 ambiguous group, 0 other review groups**. Inspect the visible review list: positions **36–39**, **2 prompts / 2 text responses**. These counts are expected observations, never hard-coded behavior.
5. Select JSONL and repeat. Confirm one manifest plus 80 group lines (79 candidates and the intact ambiguous group). If the source changed between downloads, compare timestamps/counts rather than assuming identical reads. All groups must remain `context_sufficiency: unreviewed`.
6. To include hidden reasoning/tools, select **Reasoning** and **Tools** and enable **Include hidden records**. For that unchanged source, expect 179 selected records. Enable raw only if typed provider parts/citations are needed. Text answers must remain separate from reasoning. Uncheck all types to check local validation; try a foreign conversation with another account to confirm 404; a signed-out download must return 401 and no source data. Check ordinary user access as well as admin access.
7. Check narrow/mobile layout, keyboard focus, the saved UTF-8 file, the retry link, and safe errors after logout or a simulated unavailable test database. Monitor `chat5_export` logger failures/diagnostic warnings. Never paste actual private downloads into test fixtures or a PR.

The implementation's tests use synthetic records only. Full visual browser verification depends on a connected browser; jsdom tests cover selection, errors, escaped rendering, counts, review lists and downloads without starting the configured application.

Cleanup, external database import, balancing, prompt variants, a living dataset, training-format conversion and Qwen3 LoRA/QLoRA training are intentionally future work.
