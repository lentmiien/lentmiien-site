# Rex Run: The Amber Labyrinth

## Security contract

- Feature: Rex Maze client-side gameplay and roar recovery
- Security zone: fully public
- Interactive principals: anonymous, admin, family, and user; gameplay authority is identical for all
- Machine principals: none
- Data classification: public game assets plus non-personal, browser-local progress
- Capabilities: none; the game does not call an application API
- Object scope: none
- Admin override: no
- Browser mutations and CSRF control: gameplay mutates only in-memory state and same-browser `localStorage`; there are no server mutations
- Public/secret abuse controls: static asset serving and bounded maze/game calculations; no user-submitted work
- Request and upload limits: no request bodies or uploads
- Output/rendering contexts: fixed first-party HTML, canvas rendering, and `textContent` updates
- Private file/media storage and delivery: none
- Outbound hosts/services: none
- Cache policy: public static assets; progress remains in the browser
- Security-relevant logs: none; there are no server operations
- Retention/deletion behavior: level state lasts for the page session; saved score, renown, and sound preference remain until browser storage is cleared
- Required negative security tests: recovery calculations reject negative/non-finite timing inputs and remain capped at 100%; no authentication boundary applies
- Legacy dependency or migration plan: retain the existing static game route, local progress keys, scoring, and level lifecycle
