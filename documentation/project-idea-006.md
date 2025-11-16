# Project Idea 006 – Harden `setup.js` and Startup Diagnostics

## Goal
Increase the resilience of the startup pipeline by adding robust error handling, diagnostics, and recovery paths to `setup.js`. The script should gracefully handle missing directories, transient network failures, and data cleanup issues, while emitting actionable logs.

## Scope Overview
- Audit each section of `setup.js` (cache prep, directory creation, usage sync, Dropbox backups) and wrap risky operations with try/catch blocks and retries.
- Introduce structured error reporting via `utils/logger` and optionally Mailgun/Slack alerts for critical failures.
- Add preflight checks (Mongo connectivity, disk space, env var presence) with clear output and exit codes.
- Update documentation to outline the startup diagnostics flow and how to interpret new logs.

## Key Code Touchpoints
- `setup.js`.
- `utils/logger.js`, `utils/` helper modules (create new `utils/startupChecks.js` for shared logic).
- `.env` validation utility (could reuse `dotenv` warnings).

## Implementation Notes
1. **Structured try/catch** – Wrap each major section (directory prep, cache warm, usage sync, Dropbox backup) and log context-rich errors. Provide fallback behaviour where safe.
2. **Preflight checks** – Implement functions to verify env variables, Mongo connection (`mongoose.connect` with timeout), and free disk space. Exit early if critical checks fail.
3. **Retry/backoff** – For network calls (OpenAI usage, Dropbox sync) add limited retries with exponential backoff and final failure logging.
4. **Reporting** – Emit summary output at the end of the script detailing successes/failures, optionally email the admin when severe errors occur.
5. **Tests** – Create Jest coverage that mocks filesystem/network layers to ensure error paths behave as expected (tie into Project Idea 007).

## Dependencies / Follow-ups
- Complements Project Idea 007 by adding unit tests for the new error handling.
- Consider combining with Project Idea 009 to let agents monitor startup reports.
