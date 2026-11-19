# November 19 production log follow-up

Workflow `9c7dbbb2-a8f2-4605-a843-70bd13f1fc93` covered November 12–19, 2026. The checks below distinguish the observations made in this checkout from the work that requires the deployed database or host.

## Embedding admission and backlog

A read-only request to the worker's Gateway base returned 41 containers. ComfyUI reported `state=exited` and `running=false`. The previous parser returned unknown because it walked descriptive fields throughout the catalog and exhausted its 1,000-node limit. The revised parser returned stopped on the same catalog shape. This reproduces a cause of deferral. The historical warnings did not retain enough information to classify each one.

Watch the `embedding_queue` category after deployment. A recovery names the specific probe that succeeded. A busy reservation can skip container inspection. Unknown state, unreadable JSON, failed HTTP responses and transport errors continue to defer upserts. Check the `reason` on a warning. The five-minute reconciliation summary includes `oldestPendingUpsertAgeMs`, with `null` when the pending upsert set is empty. Its `queued` field counts source intents visited in that pass.

For a rollout check, follow a single `embedding_queue_jobs` upsert by its ID to `completed`, then check its source metadata in `vector_embeddings` or `vector_embeddings_high_quality`. Inspect the oldest pending age across successive summaries while the GPU is available. A local MongoDB fixture exercised admission, a timed-out default request, successful high-quality indexing, a restart and eventual persistence of exactly one vector in each collection.

## Receipt intake, access and historical files

* New scans are sensitive, logged-in, owner-scoped records. The service re-encodes an upload as JPEG and commits the bytes and fields in one MongoDB insert. Normal receipt queries exclude the scan bytes. Deleting the record removes its scan. Include the receipts collection in private database backups.
* The existing `receipt` permission remains the outer route gate. Administrators have `finance.receipt.read` and `finance.receipt.write` by default. Other roles need explicit grants. Read access includes the historical shared ledger and the principal's own new receipts. New scans have no cross-owner administrator override. An authorized write requires both capabilities. Source images are served by receipt ID with private, no-store caching.
* Upload, edit, ledger submission and deletion use POST and the shared session CSRF token. Either receipt form or the OCR forwarding UI can submit a batch. The upload limit is ten files, 25 MiB per file and 64 MiB including multipart framing. Decode is limited to 40 megapixels. Two uploads can be processed concurrently per web process. Only the existing OpenAI extractor receives scan bytes and optional OCR text.
* For mixed results the response is HTTP 207. Each failure identifies the zero-based file index and the field requiring attention. Forms display one-based file numbers. Repeating identical file bytes for the same owner returns the saved receipt. For an unreadable date, submit that scan alone with its purchase date. Shared validation logs contain the field and kind.

Old public files require a deployment-side review. For a **saved** legacy receipt, confirm its exact ID, take a verified backup, and confirm its JPEG is exclusive to that receipt, including any chat or external references. Run the following from the release directory with the service's configured database. The first invocation checks eligibility. Run the second during a maintenance window with legacy writers and restore jobs stopped.

```sh
node --env-file=.env scripts/privatize-receipt-scan.js RECEIPT_ID
node --env-file=.env scripts/privatize-receipt-scan.js RECEIPT_ID --apply
```

Application verifies the saved private copy byte-for-byte before removing the identified public file. The same command can resume an interrupted migration. Verify the signed-in scan route and the absence of the old public URL, and purge any cached public copy. Dropbox setup can restore remote-only files into `public/img`. If that synchronization is enabled, move the confirmed file out of its synchronized remote folder under the deployment's private-backup policy before restarting synchronization, then recheck the public URL. Earlier failed uploads may have no receipt ID. The `UP-` filename prefix was shared with chat uploads. Identifying those files requires separate provenance evidence.

## Knowledge indexing

Create and edit save both pending modes on the entry. The worker uses a separate durable job for each entry and mode. Bulk re-index reports how many entries were queued. Jobs re-read the current entry before writing vectors.

The historical error predates those markers. On the deployment, obtain the specific knowledge ID from the restricted incident record and check the two vector collections for that source. For the affected legacy entry with missing vectors and no queue jobs, the following single-record repair requests indexing in both modes. Run it in the application database after deploying the worker.

```javascript
const id = ObjectId('REPLACE_WITH_CONFIRMED_KNOWLEDGE_ID');
db.chat4_knowledges.updateOne(
  { _id: id, pendingEmbeddingModes: { $exists: false } },
  { $set: { pendingEmbeddingModes: ['default', 'high_quality'] } }
);
```

Verify both jobs complete for `source.collectionName = knowledge` and `source.documentId` equal to the ID string. Check the vectors in each collection. Restrict access to pre-fix logs and handle them under the deployment's log-retention policy.

## Other deployment checks

* **JMA.** Both warning feeds were independently readable at 23:26 JST on November 19, after the report window. Both showed a 23:00:19 feed update, a 22:58:31 newest entry and a 23:00:36 Last-Modified time. These later observations cannot reconstruct the November 14 publication. At the next stale-to-fresh transition, compare those times and retrieval times from an independent client with the worker's warning and recovery diagnostics. The dashboard requires fresh feeds and valid local evidence to show current status.
* **Codex.** A reservation release and a retained batch activity concern different resources. The Linux process-group test confirms a surviving group member prevents termination proof. Reconcile the four reported activities only from the owning deployment after identifying the turn, fencing the old coordinator and proving the target process tree has exited. [Operator procedure](durable-local-ai.md#codex-ownership-and-explicit-reconciliation)
* **AmiAmi.** One item from the current official listing returned a successful detail response with the existing request. The report supplies no failed item codes for comparison. A subsequent failure records the allowlisted content type, Cloudflare mitigation and ray ID, and Retry-After when supplied. Compare the affected item with a listed control. Use the existing failed-placeholder retry for confirmed items. [Import recovery](amiami-upload.md)
* **GPT Image.** Run `node --env-file=.env scripts/check-gpt-image-model-cards.js` against the deployment. Each incompatible card now lists the individual contract mismatches. In model-card management, correct the identified fields on the two named records. The expected type is image, the inputs include text and image, and the outputs include image. Rerun the read-only check. A disposable two-card mismatch produced a failing check and the corrected fixture passed.
* **Document Vault.** The current revision includes the reply parser repair from `e2d44a1`. The vault integration suite exercised parsing and persistence with synthetic provider replies. The affected production page still needs its authorized retry and persisted classification checked in the vault.
