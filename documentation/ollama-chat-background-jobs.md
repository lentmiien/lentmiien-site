# Ollama chat background jobs

Chat5 local models submit work to the AI Gateway with `POST /llm/chat/jobs`.
The initial request stores and broadcasts a `Pending response` message. The
Gateway later notifies `POST /webhook/ollama`; the app retrieves the canonical
job record from the Gateway, replaces the placeholder, and broadcasts the
persisted output to Chat5 conversation and member rooms.

## Production configuration

```dotenv
AI_GATEWAY_BASE_URL=http://192.168.0.20:8080
OLLAMA_WEBHOOK_BASE_URL=https://my.lentmiien.com/
OLLAMA_WEBHOOK_SECRET=<random value of at least 32 characters>
OLLAMA_MAX_TOOL_ROUNDS=4
```

`OLLAMA_WEBHOOK_SECRET` is recommended but not a new startup requirement. If
it is absent, the app derives the callback token from `SESSION_SECRET` and
emits an `ollama_webhook` warning. The configured base must use HTTPS unless it
targets loopback. The callback URL is built as
`https://my.lentmiien.com/webhook/ollama?token=...`.

Do not put the resulting callback URL in tickets or logs. The application
redacts its token from API debug records and normal logs, but the reverse proxy
and AI Gateway should also avoid logging query strings for this endpoint.

## Safety behavior

- Callback traffic is limited to 120 requests per minute per source IP. JSON is
  limited to 16 KB and must contain a UUID job ID plus a terminal status.
- The callback token is compared in constant time.
- Callback output and callback-provided URLs are ignored. Results are fetched
  only from `/llm/chat/jobs/{job_id}` on the configured Gateway.
- Unknown and duplicate job notifications are acknowledged without mutation.
- A database claim prevents simultaneous callback/recovery processing.
- Persisted outputs carry the Gateway job ID and output index so a retried
  completion reuses them instead of duplicating them.
- Function outputs are reused on retries, unselected tools cannot execute, and
  local tool loops stop after `OLLAMA_MAX_TOOL_ROUNDS` (maximum 20).
- The existing pending-response scheduler polls Ollama jobs when a callback is
  lost, rejected, or arrives before its pending database record is saved.

## First-deploy verification

1. Deploy the app and confirm its reverse proxy accepts public HTTPS POSTs to
   `/webhook/ollama` while preserving the query string.
2. Send one Chat5 message with a local model. The UI should receive a pending
   message as soon as the Gateway returns HTTP 202.
3. Follow JSON application logs for categories `ollama_background_job` and
   `ollama_webhook`. A normal run records job acceptance, callback acceptance,
   canonical retrieval, persistence, and broadcast.
4. Confirm the pending message is replaced on every connected client in the
   conversation room.
5. For recovery testing, temporarily prevent callback delivery for one job.
   Restore delivery without resubmitting the prompt; the pending-response
   scheduler should retrieve and broadcast the existing job result.

Do not automatically resubmit a job after an ambiguous submission timeout.
The Gateway may have accepted it even if the app did not receive the HTTP 202,
and a second submission could duplicate model or tool work.
