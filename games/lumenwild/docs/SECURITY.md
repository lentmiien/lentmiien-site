# Lumenwild security contract

- Feature: Lumenwild, a standalone browser maze adventure at `/lumenwild/`.
- Security zone: fully-public.
- Interactive principals: anonymous, admin, family, and user have the same public play access.
- Machine principals: none.
- Data classification: public code and artwork; non-sensitive game progress stored only in this browser.
- Capabilities: no privileged operations or account integrations.
- Object scope: none; no server-side game records. No admin override.
- Browser mutations and CSRF: gameplay changes browser memory and a namespaced localStorage entry only. No HTTP mutations, session APIs, or Socket.IO traffic.
- Public abuse controls and limits: fixed map sizes, bounded simulation steps, capped particle counts and save size. Save data is schema-validated and numeric values clamped; unknown fields are discarded.
- Output contexts: static HTML, Canvas, and DOM textContent. No untrusted HTML, dynamic scripts, URL-driven resource loading, or code execution.
- Media: original, deliberately public game art in this folder. No uploads or private media.
- Outbound services: none at runtime; all resources are local. No telemetry or external fonts.
- Cache: public static assets may use the existing game server's caching. Saves are never transmitted or included in responses.
- Logs: no new server operations. Local storage errors produce a visible in-game notice without exposing browser data.
- Retention: local progress remains until the player resets it or clears browser storage. Reset affects only the game's namespaced entry.
- Negative tests: malformed, oversized, and out-of-range saves; unsafe state values; inaccessible terrain; invalid actions; resource underflow; incompatible saves.
- Legacy dependencies: existing public game static mount and shared color theme. No new dependencies, environment settings, database migrations, or background services. Remove this folder to roll back.
