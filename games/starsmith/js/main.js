// main.js — UI controller + bootstrap
import { Game } from "./game.js";
import { Meta } from "./meta.js";
import { Audio } from "./audio.js";
import { CFG, UPGRADE_MAP, META_UPGRADES, UPGRADES } from "./config.js";
import { fmt, timeFmt } from "./util.js";

const $ = (s) => document.querySelector(s);
const canvas = $("#game");

const meta = new Meta();
const game = new Game(canvas);
game.setMeta(meta);

// ---------------- UI controller ----------------
const ui = {
  hud(game) {
    const b = game.build, p = game.player;
    if (!b || !p) return;
    $("#time").textContent = timeFmt(game.time);
    $("#level-num").textContent = game.level;
    $("#score").textContent = fmt(game.score);
    $("#stardust").textContent = fmt(CFG.dustFromTime(game.time) + CFG.dustFromScore(game.score));
    const hpk = Math.max(0, p.hp / b.s.maxHp);
    $("#hp-bar-fill").style.width = (hpk * 100).toFixed(1) + "%";
    $("#hp-text").textContent = `${Math.ceil(Math.max(0, p.hp))} / ${Math.round(b.s.maxHp)}`;
    const xpk = Math.max(0, Math.min(1, game.xp / game.xpNext));
    $("#xp-bar-fill").style.width = (xpk * 100).toFixed(1) + "%";
    $("#xp-text").textContent = `${fmt(game.xp)} / ${fmt(game.xpNext)}`;
    // boss timer
    const bt = $("#boss-timer"), btxt = $("#boss-text");
    if (game.bossActive()) { bt.classList.remove("hidden"); btxt.textContent = "Dreadforge rages — end it!"; }
    else if (game.bossTimer < 32) { bt.classList.remove("hidden"); btxt.textContent = `Dreadforge in ${timeFmt(game.bossTimer)}`; }
    else bt.classList.add("hidden");
  },

  updateAbilities(game) {
    const el = $("#abilities"); el.innerHTML = "";
    for (const u of UPGRADES) {
      if (u.ability && game.build.level(u.id) > 0) {
        const d = document.createElement("div"); d.className = "abil"; d.title = `${u.name} (Lv ${game.build.level(u.id)})`;
        d.innerHTML = `${u.icon}<span class="lv">${game.build.level(u.id)}</span>`; el.appendChild(d);
      }
    }
    for (const c of Object.values(COMBO_REF)) {
      if (game.build.combosForged.has(c.id)) {
        const d = document.createElement("div"); d.className = "abil combo"; d.title = c.name;
        d.innerHTML = `${c.icon}`; el.appendChild(d);
      }
    }
  },

  levelup(choices) {
    const box = $("#levelup-cards"); box.innerHTML = "";
    const isCombo = (c) => !!c.requires;
    choices.forEach((c) => {
      const combo = isCombo(c);
      const upg = UPGRADE_MAP[c.id];
      const owned = game.build.level(c.id);
      const max = upg ? upg.maxStacks : 1;
      const badge = combo ? "NEW FORGE" : (owned > 0 ? `${owned}/${max}` : "NEW");
      const tag = combo ? "FORGED COMBO" : (upg && upg.ability ? "ABILITY" : "FORGE");
      const card = document.createElement("div");
      card.className = "card" + (combo ? " combo" : (upg && upg.tier === 2 ? " rare" : ""));
      card.innerHTML =
        `<div class="icon">${c.icon}</div>` +
        `<div class="name">${c.name}</div>` +
        `<div class="desc">${c.desc}</div>` +
        `<div class="stack">${badge}</div>` +
        `<div class="tag">${tag}</div>`;
      card.addEventListener("click", () => game.choose(c));
      box.appendChild(card);
    });
    $("#levelup").classList.remove("hidden");
  },
  hideLevelup() { $("#levelup").classList.add("hidden"); },

  showPause() { $("#pause").classList.remove("hidden"); },
  hidePause() { $("#pause").classList.add("hidden"); },

  lastOver: null,
  showGameOver(data) {
    ui.lastOver = data;
    $("#over-reason").textContent = data.reason;
    $("#over-time").textContent = timeFmt(data.time);
    $("#over-level").textContent = data.level;
    $("#over-kills").textContent = fmt(data.kills);
    $("#over-score").textContent = fmt(data.score);
    $("#over-dust").textContent = "+✧ " + fmt(data.dust);
    $("#hud").classList.add("hidden");
    $("#gameover").classList.remove("hidden");
  },

  showMenu() {
    $("#menu-best").textContent = fmt(meta.best.score);
    $("#menu-best-time").textContent = timeFmt(meta.best.time);
    $("#menu-stardust").textContent = "✧ " + fmt(meta.stardust);
    $("#hud").classList.add("hidden");
    $("#menu").classList.remove("hidden");
  },

  shopReturn: "menu",
  renderShop() {
    $("#shop-balance").textContent = fmt(meta.stardust);
    const box = $("#shop-items"); box.innerHTML = "";
    for (const m of META_UPGRADES) {
      const lvl = meta.level(m.id);
      const maxed = meta.maxed(m.id);
      const cost = meta.cost(m.id);
      const can = meta.canBuy(m.id);
      const item = document.createElement("div");
      item.className = "shop-item" + (maxed ? " maxed" : "");
      item.innerHTML =
        `<div class="si-top"><div class="si-icon">${m.icon}</div><div><div class="si-name">${m.name}</div><div class="si-lv">${maxed ? "MAXED" : `Lv ${lvl} / ${m.maxLevel}`}</div></div></div>` +
        `<div class="si-desc">${m.desc}</div>`;
      const buy = document.createElement("button");
      buy.className = "buy" + (maxed ? " maxed" : (can ? "" : " cant"));
      buy.innerHTML = maxed ? "MAXED" : `✧ ${fmt(cost)}`;
      if (!maxed) buy.addEventListener("click", () => {
        if (meta.buy(m.id)) { Audio.sfx("buy"); ui.renderShop(); }
        else { Audio.sfx("deny"); }
      });
      item.appendChild(buy);
      box.appendChild(item);
    }
  },
  openShop() {
    ui.shopReturn = game.state === "gameover" ? "gameover" : "menu";
    ui.renderShop();
    $("#shop").classList.remove("hidden");
    Audio.sfx("ui");
  },
  closeShop() {
    $("#shop").classList.add("hidden");
    Audio.sfx("ui");
    if (ui.shopReturn === "gameover" && ui.lastOver) ui.showGameOver(ui.lastOver);
    else ui.showMenu();
  },

  toggleMute() {
    const m = !Audio.isMuted();
    Audio.setMuted(m);
    $("#btn-mute").textContent = m ? "🔇" : "🔊";
    if (!m) Audio.sfx("ui");
  },

  toastTimer: null,
  toast(html) {
    const t = $("#toast");
    t.innerHTML = html;
    t.classList.remove("hidden");
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => t.classList.add("hidden"), 2800);
  },
};
// combo reference for abilities HUD
import { COMBOS } from "./config.js";
const COMBO_REF = Object.fromEntries(COMBOS.map(c => [c.id, c]));

game.ui = ui;

// ---------------- Button wiring ----------------
const hideAll = () => ["#menu", "#levelup", "#pause", "#gameover", "#shop"].forEach(s => $(s).classList.add("hidden"));

function beginRun() {
  Audio.unlock();
  hideAll();
  $("#hud").classList.remove("hidden");
  game.startRun();
}

$("#btn-start").addEventListener("click", beginRun);
$("#btn-restart").addEventListener("click", beginRun);
$("#btn-pause").addEventListener("click", () => game.togglePause());
$("#btn-mute").addEventListener("click", () => ui.toggleMute());
$("#btn-resume").addEventListener("click", () => game.resume());
$("#btn-quit").addEventListener("click", () => game.toMenu());
$("#btn-shop").addEventListener("click", () => ui.openShop());
$("#btn-shop-from-over").addEventListener("click", () => ui.openShop());
$("#btn-shop-close").addEventListener("click", () => ui.closeShop());

// Allow Enter/Space on menu to start
window.addEventListener("keydown", (e) => {
  if (game.state === "menu" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); beginRun(); }
});

// ---------------- boot ----------------
ui.showMenu();

// dev/test handle (harmless in the browser)
if (typeof window !== "undefined") window.__starsmithDebug = { game, ui, meta, audio: Audio };
