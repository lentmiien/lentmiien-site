# Lumenwild security contract

- Feature: Lumenwild, a standalone browser maze adventure at `/lumenwild/`.
- Security zone: fully-public.
- Interactive principals: anonymous, admin, family, and user have the same public play access.
- Machine principals: none.
- Data classification: public code and artwork; non-sensitive game progress stored only in this browser.
- Capabilities: no privileged operations or account integrations.
- Object scope: none; no server-side game records. No admin override.
- Browser mutations and CSRF: gameplay changes browser memory and a namespaced localStorage entry only. No HTTP mutations, session APIs, or Socket.IO traffic.
- Public abuse controls and limits: twenty-three fixed region sizes plus one isolated hidden arena (at most 43 × 35 tiles), at most nine generated ordinary enemies and one guardian, guardian attack footprints capped at 121 tiles each with at most four strikes (current, next, and a queue of at most two), tier capped at three, simulation steps capped at 0.1 seconds with no offline catch-up, capped particles, and a 180,000-character save limit. Save data is schema-validated and numeric values clamped; unknown fields are discarded.
- Output contexts: static HTML, Canvas, and DOM textContent. No untrusted HTML, dynamic scripts, URL-driven resource loading, or code execution.
- Media: original, deliberately public game art in this folder. No uploads or private media.
- Outbound services: none at runtime; all resources are local. No telemetry or external fonts.
- Cache: public static assets may use the existing game server's caching. Saves are never transmitted or included in responses.
- Logs: no new server operations. Local storage errors produce a visible in-game notice without exposing browser data.
- Retention: local progress remains until the player resets it or clears browser storage. Reset affects only the game's namespaced entry.
- Negative tests: malformed, oversized, and out-of-range v1/v2/v3/v4/v5 saves; corrupt discovery plans and shortcuts; unsafe state values; inaccessible terrain; invalid actions; resource underflow; incompatible saves; invalid guardian states, arena coordinates, second-strike footprints, realms and retry kits; inconsistent vault keys and wishbed growth; replayed seal/rescue/trade/vault/harvest rewards.
- Legacy dependencies: existing public game static mount and shared color theme. No new dependencies, environment settings, database migrations, or background services. Remove this folder to roll back.

The expanded content, progression and backward-compatible migration are described in [Beyond the Fold](BEYOND-THE-FOLD.md).

The Waking Guardians preserves the frozen version-two generator as well as the original generator. Trial arenas and the new encounter types introduce no server operations. Guardian IDs, equipped charms, trade choices, region IDs, terrain changes, and all save fields are constrained to shipped definitions. Saved data cannot select media paths or inject markup. See [the guardian expansion design](WAKING-GUARDIANS.md).

The Unwritten Seasons retains version-three maps and daily routes for existing expeditions. New paired-key vaults and wishbeds are confined to the six new regions. A done vault requires both collected keys; wishbed growth is an integer from -1 (unplanted) through 24 (ready), and a harvested bed requires 24. Guardian previews have the same coordinate and size bounds as the current strike. See [the seasons expansion design](UNWRITTEN-SEASONS.md).

The Returning Light keeps the 21 previous maps and version-four daily routes intact. Its hidden mode requires every shipped memory, relic, art and collectible charm on launch and resume. Hidden rewards are excluded from that gate. The hidden encounter cannot be selected through ordinary trials, surveys or daily routes; fixed difficulty and a bounded supply kit are validated on restore. The remaining-strike queue is bounded and validated for coordinates, realms, count and current beat. Final story completion and mastery records bank once. See [the finale contract](FINALE.md).
