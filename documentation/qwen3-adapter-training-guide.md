# Qwen3 LoRA & QLoRA training guide

This guide is for the two adapter-training dashboards in this application. It focuses on the decisions that most affect the result: choosing the right base model, building useful supervised examples, selecting conservative hyperparameters, and measuring whether the adapter is actually better than the base model.

> The sample counts and parameter ranges below are starting points, not guarantees. Dataset quality, task difficulty, example length, and evaluation coverage matter more than row count alone. Keep a held-out test set and change one variable at a time.

## Quick start

If this is your first adapter:

1. Write down one observable behavior to change, such as “return valid JSON for these invoices” or “write support replies in this tone.”
2. Create the test set first. Keep at least 10–20% of the examples out of training and include difficult and negative cases.
3. Test both unadapted base models on that set. Start with **Qwen3 LoRA (4B)** unless the 32B base model has a clear, measured advantage that the smaller model cannot provide.
4. Upload UTF-8 CSV data and confirm that the preview, row count, detected columns, and `format_ready` value are correct.
5. Run a short smoke job before an expensive job. Use a new, versioned adapter name.
6. Compare the base model and adapter with identical held-out prompts. Use deterministic generation first; test sampled or thinking-mode behavior separately.
7. Improve the data before increasing adapter capacity. If a parameter change is needed, change only one and record the result.

Good first-pass settings are the values already shown by each tool:

| Tool | Epochs | Learning rate | Batch | Gradient accumulation | Max sequence | Rank / alpha | Dropout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Qwen3 LoRA | 3 | 0.0002 | 1 | 8 | 2,048 | 16 / 32 | 0.05 |
| Qwen3 QLoRA | 1 | 0.0002 | 1 | 16 | 512 | 16 / 32 | 0.05 |

Those are conservative general defaults, not a promise that they are best for every dataset. For a pipeline-only smoke test, reduce to one epoch and a short sequence length.

## Choose the tool

The two adapters are trained for different base checkpoints and cannot be moved between them.

| | [Qwen3 LoRA](/admin/qwen3-lora) | [Qwen3 QLoRA](/admin/qwen3-qlora) |
| --- | --- | --- |
| Base model | [`Qwen/Qwen3-4B-Instruct-2507`](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507), a 4.0B-parameter, updated instruction model | [`Qwen/Qwen3-32B`](https://huggingface.co/Qwen/Qwen3-32B), a 32.8B-parameter dense model |
| Training method | Standard LoRA over a frozen 4B base | QLoRA over a frozen NF4/double-quantized 4-bit base, with BF16 compute and trainable LoRA matrices |
| Thinking mode | No. This 2507 instruct checkpoint is non-thinking only. | Yes. Thinking and non-thinking generation are available. |
| Current training sequence cap | 8,192 tokens | 4,096 tokens |
| Operational profile | Faster iteration, smaller adapters, lower inference cost, and easier repeated experiments | Much heavier and slower; the pinned 4-bit model is about 19.2 GB on disk and an empty cache takes at least about 58 minutes to download on this deployment |
| Best default use | Narrow, well-specified transformations and high-volume serving | Tasks whose inputs require stronger base reasoning, nuanced interpretation, or complex tool and language behavior |

### Where the 4B LoRA model excels

Prefer the 4B tool for tone and style, templated writing, schema-constrained output, simple extraction or classification, short support responses, routing, and narrow tool schemas. It is also the better place to discover whether the dataset works: iteration is cheaper, comparisons are faster, and a strong updated instruction model often needs only a modest behavioral correction.

The 4B model is also appropriate when latency, throughput, frequent adapter switching, or maintaining many task-specific adapters matters more than maximum general capability. Its official checkpoint supports long inference contexts, but this service's **training** cap is 8,192 tokens; the base-model context size does not override the service limit.

### Where the 32B QLoRA model excels

Prefer the 32B tool when the base task itself is difficult: ambiguous requests, multi-step reasoning, complicated tool selection, non-trivial code, nuanced multilingual work, longer multi-turn behavior, or cases that demand more world knowledge before applying the trained behavior. Its thinking mode can help on reasoning-heavy evaluation prompts.

The larger model is not automatically the better adapter. The 4B checkpoint is a newer instruction-focused release, the two models have different post-training, and a narrow deterministic task may leave little room for 32B capacity to help. Measure both base models on the real test set before paying the QLoRA cost.

### A practical decision rule

Use the smallest model that already has the underlying capability. Fine-tuning is best at teaching **how to respond**: format, tone, decisions, tool-call patterns, and task-specific transformations. It is a poor replacement for retrieval when facts change, and it cannot reliably install a large private knowledge base. Use retrieval or supplied context for changing facts, then fine-tune the response behavior if necessary.

Move from 4B to 32B when all three are true:

1. The held-out failures require capability or reasoning rather than more representative examples.
2. The unadapted 32B model is materially better on those failures.
3. The quality gain justifies slower training, slower generation, and exclusive GPU use.

## What LoRA and QLoRA change

LoRA freezes the pretrained model and trains small low-rank update matrices in selected layers. The resulting adapter is much smaller than a full model and can be loaded on top of the exact base checkpoint. Increasing rank or targeting more modules increases the adapter's capacity and size; it does not retrain every base-model weight.

QLoRA uses the same low-rank adaptation idea while keeping the frozen base weights quantized to 4-bit. This makes a 32B training target fit on the available GPU. Quantization reduces memory use; it does not make a 32B run as fast or light as the 4B service.

For both tools:

- An adapter is tied to its base checkpoint and architecture. A 4B LoRA adapter cannot be loaded by the 32B QLoRA service, or vice versa.
- Supervised fine-tuning makes desired answers more likely; it does not guarantee exact output, factual correctness, safety, or generalization.
- The examples teach correlations. Repeated boilerplate, accidental secrets, contradictory answers, and dataset imbalance can all become learned behavior.
- A higher-capacity adapter cannot repair missing, mislabeled, or unrepresentative data.

For background, see the original [LoRA paper](https://arxiv.org/abs/2106.09685), the [QLoRA paper](https://arxiv.org/abs/2305.14314), and the [PEFT LoRA parameter guide](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora).

## Design the evaluation first

Define success before collecting training rows. A useful goal is measurable:

- “At least 95% of held-out outputs parse against this JSON schema.”
- “At least 45 of 50 support replies follow the tone rubric without inventing a refund.”
- “Tool name and required arguments are correct on 90% of unseen cases, including cases where no tool should be called.”
- “The adapter wins a blinded preference test without reducing factual accuracy from the base model.”

Create three groups when there is enough data:

- **Training:** approximately 80% for fitting.
- **Validation:** approximately 10% for choosing epochs, learning rate, and other settings.
- **Final test:** approximately 10%, untouched until a candidate is selected.

With a small dataset, reserve 10–20% as one held-out set instead of creating two tiny sets. Split by customer, document, conversation, source, or topic—not merely by random rows—so paraphrases and adjacent turns do not leak across the boundary. Keep a fixed “challenge set” of rare, adversarial, and business-critical cases regardless of the split.

Record the base-model result before training. Without a baseline, a plausible adapter response can look like an improvement even when the base was already better.

## Prepare training data

### Supported CSV layouts

Both tools accept a UTF-8 `.csv` file and auto-detect these layouts.

**Prompt and response**, with an optional `system` column:

```csv
system,prompt,response
"You write concise support replies.","My invoice was charged twice.","Thanks for flagging this. We will review the duplicate charge."
```

Use this for single-turn chat tasks, direct transformations, classification, extraction, and most style adapters.

**Instruction and output**, with optional `input` and `system` columns:

```csv
instruction,input,output
"Rewrite professionally","send it now","Please send it at your earliest convenience."
```

Use this when the instruction is stable but the source material belongs in a separate input field.

**Messages**, where one CSV field contains a JSON message array:

```csv
messages
"[{""role"":""user"",""content"":""Say hi""},{""role"":""assistant"",""content"":""Hi.""}]"
```

Use this for multi-turn conversations and tool-call examples. One row may contain several turns, so count conversations and tokens as well as rows. Keep role ordering and tool schemas identical to the format that production inference will use.

After upload, verify the preview and `suggested_columns`. If `format_ready` is false, select the appropriate preset or provide a custom column mapping before starting the job. A successful upload only proves that the CSV can be stored; it does not prove that the examples are mapped correctly.

### Data quality rules

High-quality data is correct, representative, diverse, and consistent with production:

1. **Make every target answer worth copying.** Correct factual, formatting, grammar, policy, and tool-argument errors before training.
2. **Remove duplicates and near-duplicates.** Repetition gives a few examples disproportionate influence and makes held-out leakage likely.
3. **Cover input variation.** Vary phrasing, length, order, spelling, languages, optional fields, and realistic ambiguity instead of changing only names and numbers in a template.
4. **Include boundaries and negative cases.** Show when to refuse, ask a clarifying question, return “unknown,” omit an optional field, or avoid calling a tool.
5. **Match the production distribution.** Balance rare classes enough to learn them, but do not create a dataset whose class mix is unrelated to live traffic. Report per-class scores.
6. **Keep policy and persona consistent.** Contradictory system prompts or equally plausible but incompatible responses produce unstable behavior.
7. **Use the same prompt shape at train and test time.** If every row depends on one system message, use that message in production—or include examples that deliberately cover the other expected system messages.
8. **Keep private data out.** Remove secrets, credentials, unnecessary personal data, and text without appropriate permission or licensing. Adapters can memorize rare strings.
9. **Train final answers, not hidden reasoning transcripts.** Do not include private chain-of-thought. Teach concise explanations, verifiable steps, tool calls, or final answers that are suitable to show a user.
10. **Inspect lengths after chat templating.** The system message, roles, prompt, response, and tool definitions all consume the sequence budget.

### Choosing a sequence length

Measure token lengths after applying the Qwen chat format if possible. Choose a value that covers roughly the 95th percentile of useful examples, rounded to a practical bucket such as 512, 1,024, 2,048, or 4,096. Do not raise the length for one accidental outlier.

Higher sequence length sharply increases activation memory and training time. It is the first value to lower after an out-of-memory error, especially for QLoRA. If important examples exceed the service cap, shorten boilerplate or split documents into self-contained tasks. Do not split a conversation in a way that removes the context required for its answer.

The current deployed maximum is 8,192 training tokens for LoRA and 4,096 for QLoRA. These are service limits, even where the official model supports a longer inference context.

## Sample size guidance

These ranges count usable, deduplicated examples—not raw exported rows. “Proof of signal” is enough to check that the behavior can move, not enough to claim production reliability.

| Desired outcome | Proof of signal | Practical first dataset | Broader coverage | Data that matters most | Usually start with |
| --- | ---: | ---: | ---: | --- | --- |
| Tone, persona, short templates, or a rigid output format | 30–100 | 200–800 | 1,000–3,000 | Consistency plus varied topics and lengths | 4B LoRA |
| Classification, routing, extraction, or schema-constrained JSON | 100–300 | 500–3,000 | 3,000–20,000 | Per-class balance, confusing negatives, missing fields, malformed inputs | 4B LoRA; 32B for genuinely ambiguous inputs |
| Grounded Q&A or summarization from supplied context | 100–300 | 500–3,000 | 3,000–10,000 | Faithfulness, “not in context” cases, diverse document layouts | 4B for direct evidence; 32B for multi-step synthesis |
| Tool selection and argument construction | 200–500 | 1,000–5,000 | 5,000–20,000 | No-tool cases, similar tools, missing arguments, validation and recovery turns | 4B for a small rigid schema; 32B for planning and many tools |
| Multi-turn support, dialogue policy, or role behavior | 100–300 conversations | 500–3,000 conversations | 3,000–10,000 conversations | Full conversation arcs, escalation, correction, and edge cases | 4B for scripted flows; 32B for nuance and ambiguity |
| Complex code, multilingual behavior, or domain reasoning | 300–1,000 per important domain or language direction | 2,000–10,000 | 10,000+ | Executable tests, native-quality text, difficult counterexamples | Compare bases; often 32B QLoRA |
| Safety, refusal, or high-stakes policy behavior | 500–1,000 to prototype | 2,000–10,000 plus red-team tests | Coverage-driven, often 10,000+ | False-refusal cases, adversarial wording, every critical policy boundary | Do not rely on fine-tuning alone |

Interpret the ranges with these rules:

- Fifty excellent examples can teach a conspicuous style, but they cannot demonstrate robust generalization.
- Five hundred long multi-turn conversations may contain more training signal and cost than several thousand one-line classifications.
- A larger model may transfer a behavior from fewer examples, but it still needs coverage of every boundary the base model cannot infer.
- Synthetic examples are useful for coverage only after review. A large synthetic dataset from one template can amplify the generating model's mistakes and phrasing.
- If adding another 20% of diverse, corrected data keeps improving the held-out score, data is still the best lever. If the score plateaus, inspect label ambiguity and model capability before collecting more of the same.
- For changing facts, use retrieval. Increasing Q&A rows is not a dependable way to keep a knowledge base current.

The service currently caps either dataset at 200,000 rows. The effective upload cap is the smaller of the limit printed in the web tool and the Gateway's configured limit.

## Training parameter reference

The table describes the fields exposed by the web form. Defaults are the current values shown when each page opens.

| Form field | LoRA default | QLoRA default | What it controls | What to expect when changing it |
| --- | ---: | ---: | --- | --- |
| **Epochs** (`num_train_epochs`) | 3 | 1 | Complete passes over the training set | More epochs increase training time almost linearly and strengthen adaptation, but eventually memorize wording and damage generalization. Use 1–2 for large data and test 2–5 only for small, clean data. Fractional epochs are allowed by the form. |
| **Learning rate** (`learning_rate`) | 0.0002 | 0.0002 | Size of each optimizer update | Higher values learn faster but can overshoot, become brittle, or forget useful base behavior. Lower values are steadier but can underfit. Compare `0.0001` with `0.0002` before trying a more extreme value. |
| **Batch size** (`per_device_train_batch_size`) | 1 | 1 | Sequences processed together in one forward/backward microbatch | Raising it may improve throughput and smooth gradients but directly raises VRAM use. Keep QLoRA at 1 unless a measured test shows headroom. If changed, adjust accumulation to preserve the intended effective batch. |
| **Grad accum.** (`gradient_accumulation_steps`) | 8 | 16 | Microbatches accumulated before one optimizer update | Raising it creates a larger effective batch without the same VRAM jump, but produces fewer optimizer updates per epoch and waits longer between updates. Lowering it adds noisier, more frequent updates and can help a tiny dataset, at the cost of less averaging. |
| **Max seq.** (`max_seq_length`) | 2,048 | 512 | Maximum tokens in the formatted training sequence | Raising it preserves longer examples but has the largest activation-memory effect and slows training. Lower it first for OOMs. Pick from measured lengths, not the model's advertised context window. |
| **LoRA r** (`lora_r`) | 16 | 16 | Rank, and therefore capacity, trainable parameter count, adapter size, and some memory use | Higher rank can represent a more complex change but costs more and can overfit. Try 8–16 for narrow behavior and 32 only after good data still shows underfitting. Rank 4–8 is useful for a smoke test. |
| **LoRA alpha** (`lora_alpha`) | 32 | 32 | Scale applied to the low-rank update | With standard LoRA, effective scaling is approximately `alpha / r`. Raising alpha strengthens the adapter and can destabilize or overfit it; lowering alpha weakens it. For a controlled rank test, keep the ratio constant: 8/16, 16/32, or 32/64 for rank/alpha. |
| **LoRA dropout** (`lora_dropout`) | 0.05 | 0.05 | Regularization applied on the adapter path during training | A little dropout can reduce memorization on small or noisy data. Too much causes underfitting. `0`–`0.05` is a clean-data baseline; test `0.1` only when overfitting is visible. Dropout is inactive at generation time. |
| **Seed** (`seed`) | 42 | 42 | Random initialization, shuffle, and other stochastic choices | Keep it fixed for fair parameter comparisons. A winning setting should survive another seed before deployment. GPU kernels may prevent bit-for-bit repeatability. |
| **Target modules** (`target_modules`) | Service defaults | Service defaults | Which transformer projections receive adapters | Blank uses `q_proj`, `k_proj`, `v_proj`, `o_proj`, `gate_proj`, `up_proj`, and `down_proj`. A narrower list makes a smaller, less expressive adapter. Override only for a controlled architecture experiment. Enter comma-separated names. |

### Effective batch and update count

On this single-GPU service, a rough estimate is:

```text
effective batch = per-device batch size × gradient accumulation
optimizer updates per epoch ≈ training sequences ÷ effective batch
total updates ≈ updates per epoch × epochs
```

For 1,000 one-sequence rows, LoRA defaults give an effective batch of 8 and about 375 updates across three epochs. QLoRA defaults give an effective batch of 16 and about 63 updates in one epoch. Packing, filtering, variable lengths, and the final partial batch can change the exact number, so confirm `global_step` and `max_steps` in the job progress.

This interaction matters on tiny datasets. Raising accumulation without raising epochs reduces the number of optimizer updates. If a 200-row QLoRA job underfits, compare either fewer accumulation steps **or** another epoch; do not change both in the same experiment.

### Rank, alpha, and target modules

Treat rank as a capacity control, alpha as an update-strength control, and target modules as a coverage control. Changing all three together makes the result impossible to diagnose.

Start with the service's broad default target list and rank 16. If a clean dataset changes style but cannot learn a genuinely varied mapping, test rank 32 while keeping `alpha / r` constant. If the adapter is already strong but too aggressive, lower learning rate or epochs before redesigning the module list.

### Advanced Gateway fields not shown in the form

The Gateway request format also documents these fields. The web page currently leaves them at service defaults:

| Field | Documented default | Effect |
| --- | ---: | --- |
| `warmup_ratio` | 0.03 | Fraction of optimizer steps used to ramp up the learning rate. More warmup can stabilize a long or aggressive run, but a tiny job may have too few steps for it to matter. |
| `weight_decay` | 0 | Regularization on trained weights. Small values such as 0.01 are an advanced overfitting experiment, not the first response to weak data. |
| `logging_steps` | 5 | Progress-reporting frequency. It changes log detail, not the learned adapter. Very frequent logging can add overhead. |
| `save_steps` | 0 | Periodic checkpoint interval. Zero leaves normal successful-job artifact saving in place without requesting periodic checkpoints. |

Use the Gateway API directly only when an experiment requires these fields, and check the current Gateway manual and validation limits first.

### Job fields that are not hyperparameters

- **Columns** controls how CSV fields become system, user, assistant, or message data. A wrong mapping can produce a successful but useless job.
- **Adapter name** identifies the output. Use names such as `support-tone-v003-e2-lr1e4` that preserve purpose and experiment version.
- **Overwrite adapter** replaces an existing adapter directory. Leave it off for normal experiments; unique names make rollback and comparison safer.

## Starting recipes

Use these as experiment plans, not presets to copy blindly.

| Situation | Suggested first run | What to do next |
| --- | --- | --- |
| Pipeline smoke test | 20–100 reviewed rows; 1 epoch; LR 0.0002; batch 1; accumulation 1–4; sequence 128–512; rank 4–8; alpha twice the rank; dropout 0–0.05 | Confirm upload, progress, artifact creation, adapter loading, and one obvious behavior change. Do not judge production quality. |
| Narrow style or format, fewer than 500 rows | 4B LoRA; 3 epochs; LR 0.0001–0.0002; batch 1; accumulation 4–8; sequence at the measured 95th percentile; rank 8–16; dropout 0.05 | If it memorizes, reduce epochs or LR and add varied prompts. If it barely changes, verify data and mapping, then add an epoch. |
| Standard task, 500–5,000 rows | 4B LoRA defaults, with max sequence chosen from the data | Compare 2 vs 3 epochs or 0.0001 vs 0.0002. Move to 32B only if base-model capability is the limiting factor. |
| Large clean dataset, 5,000+ rows | 1 epoch first; LR 0.0001–0.0002; batch 1; accumulation 8–16; rank 16; sequence based on the length distribution | Add an epoch only if both validation and challenge-set scores are still improving. Watch total token count, not rows alone. |
| First useful 32B run | QLoRA defaults: 1 epoch, LR 0.0002, batch 1, accumulation 16, sequence 512, rank 16, alpha 32, dropout 0.05 | Increase sequence length only when important examples are being clipped. For a small dataset with very few optimizer steps, test lower accumulation or a second epoch separately. |
| Complex 32B tool, code, or reasoning behavior | Start from QLoRA defaults with diverse, executable or rubric-scored examples; thinking off for the first comparison | Fix data and tool schemas first. Then test longer sequence length; test rank 32 only if there is clear underfitting. Evaluate thinking mode as a separate operating mode. |

Do not launch a full QLoRA run merely because the smoke canary succeeded. The recorded two-row canary proves that conservative settings fit the host; it says nothing about a real dataset's duration or quality.

## Evaluate the adapter

Use the **Compare** panel to test the base and candidate adapter on exactly the same system message, prompt, token limit, and decoding settings.

1. Begin with temperature 0 and sampling off. This makes differences easier to attribute to the adapter.
2. For QLoRA, keep thinking mode off for that deterministic pass. Thinking mode requires sampling, so evaluate it in a separate pass with identical sampling settings and several repetitions.
3. Use only held-out prompts. Include ordinary cases, rare cases, malformed inputs, no-answer cases, and prompts unlike the training wording.
4. Score outputs with task-specific checks: exact match, JSON parsing and schema validation, tool and argument accuracy, executable tests, factuality against supplied context, refusal precision, or a written human rubric.
5. Check regressions as well as the target behavior. An adapter can improve tone while making answers less correct, longer, or more eager to guess.
6. Repeat sampled evaluations at least 3–5 times for important prompts. One lucky generation is not a stable result.
7. Keep an experiment record containing dataset ID, adapter name, parameters, job ID, test-set version, metrics, and representative failures.

Prefer a smaller change that passes every critical test over a dramatic style shift with new regressions. Before routing real traffic, run the candidate on shadow or low-risk traffic and retain the previous adapter for rollback.

### Reading common result patterns

- **Training score improves and held-out score improves:** continue until the held-out gain plateaus; stop before it reverses.
- **Training behavior improves but held-out behavior does not:** likely memorization, leakage, or insufficient diversity. More epochs will usually make it worse.
- **Both remain weak:** verify that the adapter was selected, inspect column mapping and examples, then test more exposure or model capacity.
- **Base 32B is good but its adapter is worse:** the data or hyperparameters are overriding useful base behavior. Reduce exposure and clean contradictions.
- **4B and 32B adapters tie:** use 4B unless another measured requirement justifies 32B.

## Operational notes

- Only one training or generation operation runs inside each service at a time, and GPU work also participates in the Gateway's shared queue.
- Accepted training is asynchronous. Closing the browser or stopping polling does not cancel it, and there is currently no public cancellation endpoint. Poll until `succeeded`, `failed`, `interrupted`, `cancelled`, or `canceled`.
- Use unique versioned adapter names. A collision returns 409 unless overwrite is enabled, and overwrite deliberately replaces the adapter.
- Dataset deletion is permanent. It removes the uploaded dataset directory but does not remove old job records or adapters that refer to it.
- Read-only dataset, job, and adapter lists normally work without loading the model. Refresh the dashboard after upload or training to inspect persisted metadata.
- The Gateway normally handles start, stop, and GPU lease ownership. QLoRA is stopped by default and has no manual lifecycle controls on this page.
- For several adjacent QLoRA comparisons, reserve the QLoRA GPU and release it when finished. A normal accepted training job retains its own background lease and does not need the browser to stay open.
- Prepare the 32B model cache before a planned QLoRA session. The first download is about 19.2 GB and is intentionally rate-limited; allow more than an hour from an empty cache.
- Long QLoRA jobs can occupy the shared GPU for hours. A tiny smoke run and a reviewed parameter record are cheap insurance.
- Deployment limits can change. Trust the values displayed by the tool and the current [LoRA Gateway manual](/admin/ai-gateway/documentation/qwen3-lora-gateway-usage.md) or [QLoRA Gateway manual](/admin/ai-gateway/documentation/qwen3-qlora-gateway-usage.md) over copied values in an old experiment note.

## Diagnosis and next actions

| Symptom | Likely causes | Next action |
| --- | --- | --- |
| Adapter output looks identical to base | Adapter not selected; too few optimizer updates; weak or inconsistent targets | Confirm the adapter name in Generate/Compare and job status. Inspect mapping and examples. Then test one more epoch or lower accumulation on a small dataset. |
| Training phrases appear verbatim on new prompts | Duplicates, low diversity, too many epochs, or LR too high | Deduplicate, add paraphrase and topic diversity, reduce epochs, compare LR 0.0001, and keep a leakage-safe test split. |
| Desired format works but accuracy falls | Targets contain errors; format examples dominate; update is too strong | Correct data, add varied accurate examples, reduce epochs or LR, and score correctness separately from format. |
| Rare class is ignored | Too few informative examples or severe imbalance | Add boundary cases, moderately rebalance training, and report per-class metrics. Do not blindly duplicate the same rows. |
| JSON or tool calls are almost correct | Inconsistent schemas, missing negative cases, or decoding variation | Canonicalize keys and argument types, add validation/recovery cases, evaluate at temperature 0, and validate outputs programmatically. |
| Good on familiar wording, poor on paraphrases | Template-like data or train/test leakage | Add genuinely different phrasings and sources, then group-split by origin. More epochs alone will deepen the problem. |
| Loss or output becomes unstable or nonsensical | LR too high, malformed rows, contradictory targets, or overly strong alpha | Inspect samples first, lower LR, restore the rank/alpha ratio, and rerun a small controlled job. |
| Out of memory | Sequence too long, microbatch too large, or rank unnecessarily high | Lower max sequence first, keep batch at 1, then lower rank. Use 4B LoRA if the task does not require 32B. |
| QLoRA job shows very few steps | Small dataset combined with accumulation 16 and one epoch | Check `max_steps`; test accumulation 4–8 or two epochs, one change at a time. |
| Thinking comparison is rejected | Thinking was enabled with greedy decoding | Enable sampling for thinking mode, or disable thinking for a deterministic comparison. |
| Training succeeds but production regresses | Prompt shape differs, test set is unrepresentative, or sampling settings changed | Reproduce production system messages and tool definitions, expand the challenge set, and compare with identical decoding settings. |

## Preflight checklist

Before pressing **Start job**, confirm:

- The desired behavior and acceptance metric are written down.
- A leakage-safe held-out set and critical challenge cases exist.
- The chosen base model already has the underlying capability.
- Every sampled target response is correct and safe to imitate.
- Duplicates, secrets, unnecessary personal data, and malformed message JSON are removed.
- CSV preview, row count, column mapping, and `format_ready` are correct.
- Max sequence length covers useful examples without being driven by outliers.
- Effective batch and approximate optimizer-step count make sense for the dataset size.
- The first run uses conservative defaults and changes no more than one experimental variable.
- The adapter name is unique, versioned, and overwrite is off.
- A short smoke run has completed before an expensive QLoRA run.
- There is enough time for the job to finish because accepted jobs cannot currently be cancelled through the public API.

After training, save the job parameters and compare base versus adapter on the untouched test set before using the adapter outside the tool.
