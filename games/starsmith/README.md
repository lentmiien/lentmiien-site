# ⚒ STARSMITH — Forged in the Void

A polished **roguelite arena-survival** game that runs entirely in your browser
(no build step, no assets, no network). You are a spark that refused to die,
holding the line against swarms of rust wraiths in a void-forged arena.

Survive as long as you can, forge ever-greaters, and merge abilities into
legendary **Forge Combos**. Every run is different, and permanent meta-upgrades
mean the game keeps getting deeper the more you play.

## ▶ Run it

Just open the file:

```
open index.html            # macOS
xdg-open index.html        # Linux
```

…or serve the folder (nicer for `file://` CORS/`localStorage` on some browsers):

```
python3 -m http.server 8000     # then visit http://localhost:8000
# or:  npx serve .
```

## 🎮 Controls

| Input        | Action                                  |
| ------------ | --------------------------------------- |
| `W A S D` / `← ↑ ↓ →` | Move                              |
| Mouse        | Aim (Nova Beam, etc.)                   |
| `P` / `Esc`  | Pause / Resume                          |
| `M`          | Mute / Unmute                           |
| `Enter`      | Start a run (from the menu)             |

Combat is **automatic** — just steer and aim.

## ⚙ How a run works

- **Wraiths** pour in from all edges. Your bolts auto-fire at the nearest foe.
- **Purple sparks** = XP (level up) · **Teal shards** = ore (score + Star Dust).
- On **level up** the game freezes and offers **3 forges** (upgrades).
- **Abilities** unlock new mechanics:
  - 🪐 **Orbiting Sparks** — orbs that orbit and scorch.
  - 📡 **Nova Beam** — a continuous lance along your aim.
  - ☀ **Molten Aura** — a searing, slowing field around you.
  - ☄ **Meteor Rain** — the sky rains burning rock.
  - ⚡ **Volt Chain** — lightning leaps between foes.
- **Forge Combos** — own two specific abilities and a golden **forged** combo
  appears that merges them into something bigger (e.g. 🪐+📡 → **Starforge Ring**).
- **Elites** and the **☠ Dreadforge** boss escalate the fight.

## ✧ Upgrade Foundry (meta-progression)

Star Dust (`✧`) is banked between runs and spent on **permanent** enhancements:
more HP, damage, speed, crit, magnetism, armor, luck, starting abilities, and
sharper forge intuition. Progression persists via `localStorage`.

- **12 meta upgrades** · **19 run upgrades** (14 stats + 5 abilities) · **5 forge combos**
- Local high score + longest run are tracked.

## 🧱 Architecture (ES modules, no dependencies)

```
index.html          UI shell: HUD + menu / level-up / pause / game-over / shop
css/style.css       Dark cosmic theme, cards, animations
js/util.js          Math, seeded RNG, formatting
js/config.js        All tunables + enemy/upgrade/combo/meta catalogs
js/build.js         Build: stats, upgrade rolls, forge combos, meta bonuses
js/meta.js          Permanent progression + persistence (localStorage)
js/audio.js         Procedural Web Audio SFX (no audio files)
js/particles.js     Sparks, bursts, rings, floating damage numbers
js/entities.js      Player, Enemy, Bullet, Pickup, Meteor
js/game.js          Main loop, spawning, combat, ability systems, rendering
js/main.js          UI controller + bootstrap (DOM wiring)
test/smoke.mjs      Headless logic/render smoke test  (node test/smoke.mjs)
```

Balance knobs live at the top of `js/config.js` (`CFG`, `ENEMIES`, `UPGRADES`,
`COMBOS`, `META_UPGRADES`) — tweak and reload.
