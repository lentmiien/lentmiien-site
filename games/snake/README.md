# Ember Snake

## Security contract

- Feature: Ember Snake client-side presets, custom rules, and gameplay
- Security zone: fully public
- Interactive principals: anonymous, admin, family, and user; gameplay authority is identical for all
- Machine principals: none
- Data classification: public game assets plus non-personal, browser-local settings and best score
- Capabilities: none; the game does not call an application API
- Object scope: none
- Admin override: no
- Browser mutations and CSRF control: gameplay mutates only in-memory state and same-browser `localStorage`; there are no server mutations
- Public/secret abuse controls: static asset serving and bounded board calculations on a 14–30 cell grid; no user-submitted work
- Request and upload limits: no request bodies or uploads
- Output/rendering contexts: fixed first-party HTML, canvas rendering, and `textContent` updates
- Private file/media storage and delivery: none
- Outbound hosts/services: none
- Cache policy: public static assets; settings and best score remain in the browser
- Security-relevant logs: none; there are no server operations
- Retention/deletion behavior: run state lasts for the page session; saved settings and best score remain until browser storage is cleared
- Required negative security tests: settings normalization rejects unsupported collision modes and bounds numeric work; gameplay tests cover loss and board-full behavior without an authentication boundary
- Legacy dependency or migration plan: retain the existing static `/snake` route and version-two browser-storage keys; older saved settings continue to normalize safely
