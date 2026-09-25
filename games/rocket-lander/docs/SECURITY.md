# Ember Descent security contract

- Feature: standalone rocket landing game. Zone: fully-public.
- Interactive principals: anonymous, admin, family, user have identical public access. Machine principals: none.
- Data: public source/art; six anonymous numeric personal-best values in this browser only. No identity, account, session, cookie or private data access.
- Capabilities, object scope, admin override: none. No server operations or privileged objects.
- Browser mutations: in-memory simulation and optional localStorage only. No HTTP mutations; CSRF not applicable.
- Abuse/request limits: static GET assets only, fixed six levels, bounded particles, DPR, timestep, catch-up and collision work. Inputs are booleans; stage/mode enums are checked. Stored JSON is length bounded and numbers validated before use.
- Output: static HTML, DOM textContent, original geometry in WebGL, local canvas labels. No eval, external markup, user URLs, uploads or executable stored content.
- Private files: none. All module resources intentionally public. Outbound services: none; relative local assets only.
- Cache: public static caching allowed; no service worker. Local records persist until the in-game clear button or browser storage removal; no server retention.
- Logs/errors: generic on-screen local asset/WebGL/audio/storage notices; no server work, telemetry or production logs.
- Negative tests: invalid stages/modes/dt, corrupt/oversized/hostile/unavailable storage, no practice records, no remote dependencies, no false touchdown, input cancellation, load/context failure.
- Dependencies: unchanged local MIT Three.js 0.185.1 copied from Sky Harbor with license and hashes; local copy of shared theme. No new package dependency, secret, environment variable, migration, Cloudflare exception or shared-route modification.
- Delivery/rollback: normal static-folder deployment and next normal app startup discovers the folder; remove this folder on rollback. This task does not deploy or restart production.
