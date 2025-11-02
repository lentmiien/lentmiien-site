# API Debug Database

This database captures raw request and response payloads for outbound API activity so that issues can be diagnosed without reproducing calls manually. It currently powers the OpenAI utility logging pipeline and is intended to be reused whenever other third‑party APIs need traceable auditing.

## Collection schema

Documents are stored in the `api_debug_logs` collection with the following fields:

- `requestUrl` (`String`, required): Wrapper path or absolute URL that identifies the call.
- `requestHeaders` (`Mixed`, nullable): Known HTTP request headers. Use `null` when headers are unavailable.
- `requestBody` (`Mixed`, nullable): Raw body payload. For `GET` requests store `null`.
- `responseHeaders` (`Mixed`, nullable): Raw HTTP response headers when available.
- `responseBody` (`Mixed`, nullable): Raw response body or error payload.
- `jsFileName` (`String`, required): Source file that initiated the request.
- `functionName` (`String`, required): Function that initiated the request.
- `createdAt` (`Date`): Timestamp automatically assigned by Mongoose.

The model is defined in `models/api_debug_log.js` and registered through `database.js` as `ApiDebugLog`.

## Retention policy

Log entries are temporary by design. `setup.js` removes documents older than five days every time the setup script runs. If longer retention is needed, adjust the cleanup window and ensure storage requirements are understood before widening it.

## Viewing logs

An admin dashboard is available at `/admin/api-debug-logs`. The page offers filters for `jsFileName` and `functionName`, surfaces the most recent 200 entries, and renders headers/bodies exactly as they were stored so you can diff requests across time.

## Adding new logging

When instrumenting a module:

1. Capture the raw request parameters **before** invoking the SDK so they can be reused in success and error paths.
2. Call `ApiDebugLog.create` (or reuse the helper in `utils/OpenAI_API.js`) with the data listed above. Always include the originating file and function names to make the admin filters useful.
3. Provide best-effort header information. If headers are not exposed by the SDK, store `null`.
4. For `GET` requests, explicitly save `null` as the request body to distinguish them from missing data.
5. Guard the logging call with `try/catch` so that failures in diagnostics never block the production code path.

Following these steps keeps the logging lightweight while ensuring every outbound request has sufficient context for debugging.
