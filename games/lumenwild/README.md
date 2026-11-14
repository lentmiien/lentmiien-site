# Lumenwild · The Folded Garden

A standalone, original maze adventure about a small fox bringing a forgotten botanical world back to life.

**Play at `/lumenwild/`.** The existing game directory discovery also adds **Lumenwild** to `/games`. The application mounts game directories at startup; restart the application normally if it was already running when this folder was added. No app-route changes, database migration, environment variables, package installation, or build step are required.

## The adventure

Recover three heartseeds in each of three gardens, then bring them to the waygate where you arrived. Restore all three gardens to awaken the world-tree. A full journey is intended to take roughly 10–20 minutes when exploring, with no timer. Save and return to camp at any time.

- **Two intertwined worlds.** Bloom opens sun-marked passages; Echo opens moon-marked passages. Some seeds only exist in one realm. Shifting also interrupts enemy attacks and dazes nearby creatures.
- **Readable, tactical combat.** Enemies act only when you do. Thorn beetles, wisps, and garden sentinels announce their next attack with marked tiles. Sweep your lantern to interrupt and free them, dash away, or use a seedbomb. Damage has a grace period; multiple foes cannot pile damage onto one turn.
- **Exploration with rewards.** Find starlight, heartseeds, treasure caches, healing springs, medicines, bombs, guiding threads, and nine persistent journal memories. Optional rune shrines split a three-note clue across both worlds.
- **Build your keeper.** Choose a blessing after each restored garden: stronger or wider attacks, healing on defeat, longer dashes, shields, extra supplies, greater sight, or more hearts. Spend banked starlight on nine permanent camp upgrade levels.
- **A reason to return.** Fresh generated mazes and different blessing choices on each expedition. Daily expeditions use a UTC date seed and a standard kit, ignoring camp and gentle-mode bonuses. There is no online leaderboard. Daily best is a local personal record across dates.
- **A gentler path.** Optional gentle journeys grant three extra hearts and two extra tonics, and reduce sentinel damage. Failed runs retain earned starlight and memories.
- **Original art.** Fifty-three local WebP assets: one title illustration, eight directional fox frames, twelve creature frames, sixteen props, and sixteen terrain tiles. All artwork together is approximately 1.5 MB. Fog, lighting, camera motion, particles, footsteps, and realm transitions are rendered in Canvas 2D. Optional procedural audio needs no downloads.

## Controls

| Input | Action |
| --- | --- |
| WASD / arrow keys | Move; hold to continue walking |
| Space | Unlimited lantern sweep; interrupts attacks |
| Q | Fold between Bloom and Echo |
| Shift | Mothstep dash in the direction you face |
| E | Open caches, drink at springs, inspect shrines, restore waygates |
| 1 | Moonberry tonic: heal five hearts |
| 2 | Seedbomb: four damage within four tiles, blocked by walls |
| 3 | Guiding thread: follow the route to the next heartseed or home |
| M / J | Atlas / journal |
| Period | Wait one turn |
| Escape | Pause |
| Touch | Direction pad, swipes across the garden, and ability buttons |

A blue ring on a guiding trail means shift worlds on that tile. You must step off a folded passage before shifting if it would close under your feet. A wall bump, blocked ability, or full-health tonic does not cost a turn or supply. Reading dialogs pauses input; losing focus pauses the game. Device reduced-motion preferences disable bobbing, particles, and motion transitions.

## Saves and privacy

One namespaced localStorage entry (`lumenwild.garden.v1`) stores the camp and current expedition. Actions autosave with a short debounce; leaving the page or returning to camp flushes immediately. Maps regenerate from their seed and validated state restores discoveries, combat, inventory, and unfinished rune sequences. Memories are retained as they are found. Starlight is banked when a run ends, win or lose; replacing an unfinished expedition discards its unbanked starlight after an in-game confirmation.

Progress is local to this browser, not an account or device sync. If storage is unavailable, the game remains playable and displays a notice. Settings has an explicit reset confirmation. No runtime external services, tracking, database, session APIs, or network writes are used. See [the security contract](docs/SECURITY.md).

## Development and verification

- `js/core.js`: deterministic generation, rules, progression, pathfinding, and save validation; CommonJS-compatible for tests.
- `js/render.js`: generated artwork, world rendering, effects, camera, and atlas.
- `js/game.js`: input, UI, accessible dialogs, local saves, and optional Web Audio.
- `assets/GENERATED-ASSETS.md`: exact image prompts and packaging provenance.
- `docs/VALIDATION.md`: verification results and limitations.

Use the Node version pinned in the root package.json (26.13.0). A focused test run:

```sh
npm test -- tests/unit/lumenwildGame.test.js --coverage=false
```

Optional browser QA uses an existing Playwright installation; it is not a runtime dependency and is not added to package.json. The script starts and closes its own localhost-only static fixture, and drives a complete expedition using keyboard inputs:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome node tests/browser/lumenwild.smoke.cjs
```

Screenshots and browser results go to `/tmp/lumenwild-review` by default; set `LUMENWILD_REVIEW_OUTPUT` to change that location.

For a manual static preview from the repository root, without app.js, prestart, database access, or background services:

```sh
node -e "const express = require('express'); const app = express(); app.use('/css', express.static('public/css')); app.use('/lumenwild', express.static('games/lumenwild')); app.listen(8098, '127.0.0.1');"
```

Then open `http://127.0.0.1:8098/lumenwild/`. Stop the preview with Ctrl+C.
