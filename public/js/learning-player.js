(() => {
  const bootstrapEl = document.getElementById('learning-bootstrap');
  const app = document.getElementById('learning-app');
  const confetti = document.getElementById('learning-confetti');
  const srLive = document.getElementById('learning-sr');

  if (!bootstrapEl || !app) {
    return;
  }

  const bootstrap = JSON.parse(bootstrapEl.textContent || '{}');
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const uid = (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

  const state = {
    topic: bootstrap.topic || {},
    subtopic: bootstrap.subtopic || {},
    theme: bootstrap.theme || {},
    builtinArtMap: bootstrap.builtinArtMap || {},
    items: Array.isArray(bootstrap.items) ? bootstrap.items : [],
    paths: bootstrap.paths || {},
    progress: bootstrap.progress || {},
    currentIndex: Number.isFinite(bootstrap.progress?.currentItemIndex) ? bootstrap.progress.currentItemIndex : 0,
    pendingProgress: null,
    pendingAdvanceIndex: null,
    justCompleted: false,
    requesting: false,
    soundEnabled: loadSoundPreference(),
  };

  const cleanupFns = [];
  let audioCtx = null;

  function onCleanup(fn) {
    cleanupFns.push(fn);
  }

  function cleanupAll() {
    while (cleanupFns.length) {
      const fn = cleanupFns.pop();
      try {
        fn();
      } catch (error) {
      }
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function announce(message) {
    if (srLive) {
      srLive.textContent = message;
    }
  }

  function loadSoundPreference() {
    try {
      const raw = window.localStorage.getItem('learningLab_sound');
      if (raw === 'off') {
        return false;
      }
      if (raw === 'on') {
        return true;
      }
    } catch (error) {
    }
    return true;
  }

  function persistSoundPreference() {
    try {
      window.localStorage.setItem('learningLab_sound', state.soundEnabled ? 'on' : 'off');
    } catch (error) {
    }
  }

  function getAudioCtx() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('No audio context available.');
      }
      audioCtx = new AudioContextClass();
    }
    return audioCtx;
  }

  function beep(freq, ms, type = 'sine', gain = 0.05) {
    if (!state.soundEnabled) {
      return;
    }

    let ctx;
    try {
      ctx = getAudioCtx();
    } catch (error) {
      return;
    }

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.value = gain;
    osc.connect(amp);
    amp.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
    osc.stop(now + ms / 1000);
  }

  function soundGood() {
    beep(880, 110, 'triangle', 0.05);
    window.setTimeout(() => beep(1175, 130, 'triangle', 0.05), 130);
  }

  function soundBad() {
    beep(220, 180, 'sawtooth', 0.04);
  }

  function soundTap() {
    beep(520, 40, 'square', 0.03);
  }

  function confettiBurst(intensity = 28) {
    if (!confetti) {
      return;
    }

    const colors = ['#ffb703', '#38bdf8', '#a78bfa', '#22c55e', '#fb7185', '#f97316'];
    for (let index = 0; index < intensity; index += 1) {
      const piece = document.createElement('div');
      piece.className = 'confettiPiece';
      const size = 8 + Math.random() * 10;
      piece.style.width = `${size}px`;
      piece.style.height = `${Math.max(10, size * 1.1)}px`;
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.transform = `translateY(-10vh) rotate(${Math.random() * 360}deg)`;
      piece.style.animationDuration = `${700 + Math.random() * 700}ms`;
      piece.style.animationDelay = `${Math.random() * 60}ms`;
      confetti.appendChild(piece);
      window.setTimeout(() => piece.remove(), 1600);
    }
  }

  function svgStar(filled) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <polygon points="12,2 15,9 22,9 16.5,13.5 18.8,21 12,16.8 5.2,21 7.5,13.5 2,9 9,9" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></polygon>
      </svg>
    `;
  }

  function svgSunIcon() {
    return `
      <svg class="btnIco" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.9"></circle>
        <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="2.5" x2="12" y2="5.2"></line>
          <line x1="12" y1="18.8" x2="12" y2="21.5"></line>
          <line x1="2.5" y1="12" x2="5.2" y2="12"></line>
          <line x1="18.8" y1="12" x2="21.5" y2="12"></line>
          <line x1="4.3" y1="4.3" x2="6.3" y2="6.3"></line>
          <line x1="17.7" y1="17.7" x2="19.7" y2="19.7"></line>
          <line x1="17.7" y1="6.3" x2="19.7" y2="4.3"></line>
          <line x1="4.3" y1="19.7" x2="6.3" y2="17.7"></line>
        </g>
      </svg>
    `;
  }

  function svgSnowIcon() {
    return `
      <svg class="btnIco" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="2.5" x2="12" y2="21.5"></line>
          <line x1="4.5" y1="7" x2="19.5" y2="17"></line>
          <line x1="19.5" y1="7" x2="4.5" y2="17"></line>
          <line x1="9.5" y1="4.5" x2="12" y2="7"></line>
          <line x1="14.5" y1="4.5" x2="12" y2="7"></line>
          <line x1="9.5" y1="19.5" x2="12" y2="17"></line>
          <line x1="14.5" y1="19.5" x2="12" y2="17"></line>
        </g>
      </svg>
    `;
  }

  function svgMascot() {
    return `
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <polygon points="18,22 10,8 28,14" fill="#0f172a"></polygon>
        <polygon points="46,22 54,8 36,14" fill="#0f172a"></polygon>
        <circle cx="32" cy="36" r="22" fill="#111827"></circle>
        <path d="M16 34 Q32 22 48 34" fill="none" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"></path>
        <circle cx="24" cy="34" r="9" fill="#e2e8f0" stroke="#94a3b8" stroke-width="3"></circle>
        <circle cx="40" cy="34" r="9" fill="#e2e8f0" stroke="#94a3b8" stroke-width="3"></circle>
        <rect x="31" y="32" width="2" height="6" fill="#94a3b8"></rect>
        <polygon points="32,40 28,44 36,44" fill="#fb7185"></polygon>
        <path d="M22 46 Q32 52 42 46" fill="none" stroke="#e2e8f0" stroke-width="3" stroke-linecap="round"></path>
        <circle cx="20" cy="36" r="2.2" fill="#0ea5e9"></circle>
        <circle cx="44" cy="36" r="2.2" fill="#0ea5e9"></circle>
      </svg>
    `;
  }

  function svgIconAtom() {
    return `
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <ellipse cx="32" cy="32" rx="20" ry="10"></ellipse>
          <ellipse cx="32" cy="32" rx="10" ry="20" transform="rotate(60 32 32)"></ellipse>
          <ellipse cx="32" cy="32" rx="10" ry="20" transform="rotate(-60 32 32)"></ellipse>
        </g>
        <circle cx="32" cy="32" r="6" fill="currentColor" opacity="0.9"></circle>
        <circle cx="52" cy="32" r="3" fill="currentColor"></circle>
        <circle cx="17" cy="23" r="3" fill="currentColor"></circle>
        <circle cx="20" cy="46" r="3" fill="currentColor"></circle>
      </svg>
    `;
  }

  function svgIconMolecule() {
    return `
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <line x1="22" y1="34" x2="32" y2="26" stroke="currentColor" stroke-width="4" stroke-linecap="round"></line>
        <line x1="42" y1="34" x2="32" y2="26" stroke="currentColor" stroke-width="4" stroke-linecap="round"></line>
        <circle cx="22" cy="34" r="9" fill="none" stroke="currentColor" stroke-width="4"></circle>
        <circle cx="42" cy="34" r="9" fill="none" stroke="currentColor" stroke-width="4"></circle>
        <circle cx="32" cy="26" r="9" fill="currentColor" opacity="0.9"></circle>
      </svg>
    `;
  }

  function svgIconMixture() {
    return `
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <circle cx="20" cy="30" r="10" fill="none" stroke="currentColor" stroke-width="4"></circle>
        <circle cx="44" cy="36" r="10" fill="none" stroke="currentColor" stroke-width="4" opacity="0.7"></circle>
        <rect x="26" y="16" width="18" height="18" rx="7" fill="currentColor" opacity="0.25"></rect>
        <path d="M18 50h28" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity="0.6"></path>
      </svg>
    `;
  }

  function svgIconStates() {
    return `
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <g fill="none" stroke="currentColor" stroke-width="3">
          <rect x="6" y="16" width="16" height="24" rx="4"></rect>
          <rect x="24" y="16" width="16" height="24" rx="4"></rect>
          <rect x="42" y="16" width="16" height="24" rx="4"></rect>
        </g>
        <g fill="currentColor" opacity="0.9">
          <circle cx="14" cy="24" r="2.5"></circle><circle cx="14" cy="32" r="2.5"></circle><circle cx="14" cy="28" r="2.5"></circle>
          <circle cx="32" cy="32" r="2.5"></circle><circle cx="30" cy="28" r="2.5"></circle><circle cx="36" cy="30" r="2.5"></circle>
          <circle cx="50" cy="22" r="2.5"></circle><circle cx="54" cy="30" r="2.5"></circle><circle cx="48" cy="34" r="2.5"></circle>
        </g>
      </svg>
    `;
  }

  function atomColor(symbol) {
    const map = {
      H: '#93c5fd',
      O: '#fb7185',
      C: '#34d399',
      N: '#a78bfa',
    };
    return map[symbol] || '#e2e8f0';
  }

  function svgAtomBall(symbol, size = 64) {
    return `
      <svg viewBox="0 0 60 60" width="${size}" height="${size}" aria-hidden="true" focusable="false">
        <circle cx="30" cy="30" r="24" fill="${atomColor(symbol)}" stroke="rgba(2,6,23,0.22)" stroke-width="4"></circle>
        <text x="30" y="38" text-anchor="middle" font-size="22" font-weight="950" fill="rgba(2,6,23,0.78)">${escapeHtml(symbol)}</text>
      </svg>
    `;
  }

  function svgParticleBoxIcon(kind) {
    const dots = kind === 'solid'
      ? [[16, 18], [24, 18], [32, 18], [16, 26], [24, 26], [32, 26], [16, 34], [24, 34], [32, 34]]
      : kind === 'liquid'
        ? [[18, 34], [26, 36], [34, 34], [22, 28], [30, 30], [38, 28], [28, 40], [40, 38]]
        : [[16, 18], [34, 16], [46, 24], [20, 32], [40, 34], [26, 44], [50, 42]];

    return `
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect x="10" y="12" width="44" height="40" rx="10" fill="none" stroke="currentColor" stroke-width="4"></rect>
        ${dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4" fill="currentColor" opacity="0.9"></circle>`).join('')}
      </svg>
    `;
  }

  function svgStickerBase(innerSvg, accent) {
    return `
      <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
        <defs>
          <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="rgba(0,0,0,0.22)"></feDropShadow>
          </filter>
        </defs>
        <circle cx="80" cy="80" r="70" fill="rgba(255,255,255,0.95)" stroke="${accent}" stroke-width="8" filter="url(#shadow)"></circle>
        <circle cx="80" cy="80" r="56" fill="rgba(2,6,23,0.03)" stroke="rgba(2,6,23,0.08)" stroke-width="3" stroke-dasharray="6 6"></circle>
        ${innerSvg}
      </svg>
    `;
  }

  function stickerAtom(accent) {
    return svgStickerBase(`
      <g transform="translate(80 80) scale(1.1)">
        <g fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round">
          <ellipse cx="0" cy="0" rx="44" ry="22"></ellipse>
          <ellipse cx="0" cy="0" rx="22" ry="44" transform="rotate(60)"></ellipse>
          <ellipse cx="0" cy="0" rx="22" ry="44" transform="rotate(-60)"></ellipse>
        </g>
        <circle cx="0" cy="0" r="12" fill="${accent}" opacity="0.95"></circle>
        <circle cx="44" cy="0" r="7" fill="${accent}"></circle>
        <circle cx="-28" cy="-18" r="7" fill="${accent}" opacity="0.85"></circle>
        <circle cx="-20" cy="32" r="7" fill="${accent}" opacity="0.85"></circle>
      </g>
    `, accent);
  }

  function stickerWater(accent) {
    return svgStickerBase(`
      <path d="M80 28 C64 54 52 68 52 88 C52 110 64 126 80 126 C96 126 108 110 108 88 C108 68 96 54 80 28 Z" fill="rgba(56,189,248,0.25)" stroke="${accent}" stroke-width="7"></path>
      <text x="80" y="96" text-anchor="middle" font-size="26" font-weight="950" fill="rgba(2,6,23,0.75)">H₂O</text>
      <circle cx="64" cy="78" r="6" fill="${accent}" opacity="0.9"></circle>
      <circle cx="98" cy="74" r="5" fill="${accent}" opacity="0.7"></circle>
    `, accent);
  }

  function stickerStates(accent) {
    return svgStickerBase(`
      <g>
        <rect x="32" y="54" width="28" height="52" rx="10" fill="rgba(2,6,23,0.03)" stroke="${accent}" stroke-width="6"></rect>
        <rect x="66" y="54" width="28" height="52" rx="10" fill="rgba(2,6,23,0.03)" stroke="${accent}" stroke-width="6" opacity="0.9"></rect>
        <rect x="100" y="54" width="28" height="52" rx="10" fill="rgba(2,6,23,0.03)" stroke="${accent}" stroke-width="6" opacity="0.8"></rect>
        <g fill="${accent}">
          <circle cx="46" cy="72" r="4"></circle><circle cx="46" cy="84" r="4"></circle><circle cx="46" cy="96" r="4"></circle>
          <circle cx="80" cy="88" r="4"></circle><circle cx="74" cy="78" r="4"></circle><circle cx="86" cy="78" r="4"></circle>
          <circle cx="112" cy="70" r="4"></circle><circle cx="118" cy="84" r="4"></circle><circle cx="108" cy="96" r="4"></circle>
        </g>
      </g>
    `, accent);
  }

  function starRow(filled, total) {
    let out = `<div class="starRow" title="${filled}/${total} stars">`;
    for (let index = 0; index < total; index += 1) {
      out += svgStar(index < filled);
    }
    out += '</div>';
    return out;
  }

  function moleculeSvg(slots3) {
    const pos = [
      { x: 90, y: 32 },
      { x: 160, y: 32 },
      { x: 230, y: 32 },
    ];
    const atoms = slots3.map((symbol, index) => ({ symbol, ...pos[index] })).filter((atom) => atom.symbol && atom.symbol !== '_');
    const lines = [];
    if (slots3[0] && slots3[0] !== '_' && slots3[1] && slots3[1] !== '_') {
      lines.push([0, 1]);
    }
    if (slots3[1] && slots3[1] !== '_' && slots3[2] && slots3[2] !== '_') {
      lines.push([1, 2]);
    }

    return `
      <svg viewBox="0 0 320 64" aria-hidden="true" focusable="false">
        <rect x="10" y="8" width="300" height="48" rx="18" fill="rgba(255,255,255,0.55)" stroke="rgba(2,6,23,0.12)" stroke-width="3"></rect>
        ${lines.map(([fromIndex, toIndex]) => `<line x1="${pos[fromIndex].x}" y1="${pos[fromIndex].y}" x2="${pos[toIndex].x}" y2="${pos[toIndex].y}" stroke="rgba(2,6,23,0.35)" stroke-width="6" stroke-linecap="round"></line>`).join('')}
        ${atoms.map((atom) => `
          <circle cx="${atom.x}" cy="${atom.y}" r="16" fill="${atomColor(atom.symbol)}" stroke="rgba(2,6,23,0.22)" stroke-width="4"></circle>
          <text x="${atom.x}" y="${atom.y + 6}" text-anchor="middle" font-size="16" font-weight="950" fill="rgba(2,6,23,0.78)">${escapeHtml(atom.symbol)}</text>
        `).join('')}
      </svg>
    `;
  }

  function renderBuiltinArt(name, variant = 'option') {
    if (state.builtinArtMap && state.builtinArtMap[name]) {
      return state.builtinArtMap[name];
    }

    switch (name) {
      case 'mascot':
      case 'chemistry':
        return svgMascot();
      case 'atom':
        return variant === 'sticker' ? stickerAtom('#ffb703') : svgIconAtom();
      case 'molecule':
        return svgIconMolecule();
      case 'mixture':
        return svgIconMixture();
      case 'states':
        return variant === 'sticker' ? stickerStates('#a78bfa') : svgIconStates();
      case 'water':
        return variant === 'sticker' ? stickerWater('#38bdf8') : moleculeSvg(['H', 'O', 'H']);
      case 'solid':
      case 'solid-box':
        return svgParticleBoxIcon('solid');
      case 'liquid':
      case 'liquid-box':
        return svgParticleBoxIcon('liquid');
      case 'gas':
      case 'gas-box':
        return svgParticleBoxIcon('gas');
      case 'molecule-h2o':
        return moleculeSvg(['H', 'O', 'H']);
      case 'molecule-co2':
        return moleculeSvg(['O', 'C', 'O']);
      case 'molecule-o2':
        return moleculeSvg(['O', 'O', '_']);
      default:
        return `<div class="emojiArt">✨</div>`;
    }
  }

  function renderArt(art, variant = 'option') {
    if (!art || !art.value) {
      return '<div class="emojiArt">✨</div>';
    }

    if (art.kind === 'emoji') {
      return `<div class="emojiArt">${escapeHtml(art.value)}</div>`;
    }

    if (art.kind === 'image') {
      return `<img src="${escapeHtml(art.value)}" alt="" loading="lazy">`;
    }

    return renderBuiltinArt(art.value, variant);
  }

  function renderRewardArt() {
    const label = (state.subtopic.rewardLabel || '').toLowerCase();
    if (label.includes('atom')) {
      return stickerAtom(state.theme.accentColor || '#ffb703');
    }
    if (label.includes('particle') || label.includes('state')) {
      return stickerStates(state.theme.accentColor || '#a78bfa');
    }
    return stickerWater(state.theme.accentColor || '#38bdf8');
  }

  function mountAtomWidget(mount, { accent = '#ffb703', count = 0, max = 8 } = {}) {
    const id = uid('atom');
    mount.innerHTML = `
      <div class="atomWidgetWrap">
        <svg class="atomSvg" viewBox="0 0 320 220" aria-label="Atom picture">
          <g class="orbitSpin">
            <ellipse cx="160" cy="110" rx="105" ry="60" fill="none" stroke="rgba(2,6,23,0.22)" stroke-width="4"></ellipse>
            <ellipse cx="160" cy="110" rx="60" ry="105" fill="none" stroke="rgba(2,6,23,0.18)" stroke-width="4" transform="rotate(60 160 110)"></ellipse>
            <ellipse cx="160" cy="110" rx="60" ry="105" fill="none" stroke="rgba(2,6,23,0.18)" stroke-width="4" transform="rotate(-60 160 110)"></ellipse>
            <g id="${id}_electrons"></g>
          </g>
          <circle cx="160" cy="110" r="36" fill="${accent}" stroke="rgba(2,6,23,0.22)" stroke-width="6"></circle>
          <text x="160" y="117" text-anchor="middle" font-size="16" font-weight="950" fill="rgba(2,6,23,0.74)">NUCLEUS</text>
        </svg>
      </div>
    `;

    const electronGroup = mount.querySelector(`#${id}_electrons`);
    let current = clamp(count, 0, max);
    const slotCount = 10;

    const electronPos = (index) => {
      const angle = (index / slotCount) * Math.PI * 2;
      const rx = 105;
      const ry = 60;
      return { x: 160 + rx * Math.cos(angle), y: 110 + ry * Math.sin(angle) };
    };

    const redraw = () => {
      electronGroup.innerHTML = '';
      for (let index = 0; index < current; index += 1) {
        const { x, y } = electronPos(index);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x.toFixed(1));
        circle.setAttribute('cy', y.toFixed(1));
        circle.setAttribute('r', 8);
        circle.setAttribute('fill', 'rgba(56,189,248,0.95)');
        circle.setAttribute('stroke', 'rgba(2,6,23,0.22)');
        circle.setAttribute('stroke-width', 4);
        electronGroup.appendChild(circle);
      }
    };

    redraw();

    return {
      getCount: () => current,
      setCount: (next) => {
        current = clamp(next, 0, max);
        redraw();
      },
      add: () => {
        current = clamp(current + 1, 0, max);
        redraw();
      },
      remove: () => {
        current = clamp(current - 1, 0, max);
        redraw();
      },
      clear: () => {
        current = 0;
        redraw();
      },
    };
  }

  function mountTapBuilder(mount, { pieces = ['H', 'H', 'O'], slots = 3, accent = '#ffb703', onChange } = {}) {
    mount.style.setProperty('--accent', accent);

    const pieceObjects = pieces.map((symbol, index) => ({ symbol, index, used: false }));
    const slotToPiece = Array.from({ length: slots }, () => null);
    let selectedPieceIndex = null;

    mount.innerHTML = `
      <div class="builder">
        <div class="builderPieces" id="pieces"></div>
        <div class="builderSlots" id="slots"></div>
        <div class="builderPreview">
          <svg viewBox="0 0 320 120" id="previewSvg" aria-label="Molecule preview"></svg>
        </div>
      </div>
    `;

    const piecesEl = $('#pieces', mount);
    const slotsEl = $('#slots', mount);
    const previewSvg = $('#previewSvg', mount);

    piecesEl.innerHTML = pieceObjects.map((piece) => `
      <button class="pieceBtn" data-piece="${piece.index}" aria-label="Atom ${escapeHtml(piece.symbol)}">
        ${svgAtomBall(piece.symbol, 52)}
        <div class="pieceLbl">${escapeHtml(piece.symbol)}</div>
      </button>
    `).join('');

    slotsEl.innerHTML = Array.from({ length: slots }).map((_, index) => `
      <button class="slotBtn" data-slot="${index}" aria-label="Empty slot ${index + 1}">
        <div style="font-weight:950;color:rgba(2,6,23,0.35);">?</div>
      </button>
    `).join('');

    const pieceButtons = $$('button.pieceBtn', mount);
    const slotButtons = $$('button.slotBtn', mount);

    const getSlots = () => slotToPiece.map((pieceIndex) => (pieceIndex == null ? null : pieceObjects[pieceIndex].symbol));

    const redrawPreview = () => {
      const symbols = getSlots();
      const positions = [
        { x: 80, y: 60 },
        { x: 160, y: 60 },
        { x: 240, y: 60 },
      ];
      const lines = [];
      if (symbols[0] && symbols[1]) {
        lines.push([0, 1]);
      }
      if (symbols[1] && symbols[2]) {
        lines.push([1, 2]);
      }

      previewSvg.innerHTML = `
        <rect x="10" y="10" width="300" height="100" rx="20" fill="rgba(255,255,255,0.55)" stroke="rgba(2,6,23,0.10)" stroke-width="3"></rect>
        ${lines.map(([fromIndex, toIndex]) => `<line x1="${positions[fromIndex].x}" y1="${positions[fromIndex].y}" x2="${positions[toIndex].x}" y2="${positions[toIndex].y}" stroke="rgba(2,6,23,0.35)" stroke-width="8" stroke-linecap="round"></line>`).join('')}
        ${symbols.map((symbol, index) => {
          if (!symbol) {
            return '';
          }
          return `
            <circle cx="${positions[index].x}" cy="${positions[index].y}" r="22" fill="${atomColor(symbol)}" stroke="rgba(2,6,23,0.22)" stroke-width="5"></circle>
            <text x="${positions[index].x}" y="${positions[index].y + 8}" text-anchor="middle" font-size="22" font-weight="950" fill="rgba(2,6,23,0.75)">${escapeHtml(symbol)}</text>
          `;
        }).join('')}
      `;
    };

    const redrawUI = () => {
      pieceButtons.forEach((button) => {
        const pieceIndex = Number(button.dataset.piece);
        const piece = pieceObjects[pieceIndex];
        button.classList.toggle('used', piece.used);
        button.classList.toggle('selected', selectedPieceIndex === pieceIndex);
        button.disabled = piece.used;
      });

      slotButtons.forEach((button) => {
        const slotIndex = Number(button.dataset.slot);
        const pieceIndex = slotToPiece[slotIndex];
        const filled = pieceIndex != null;
        button.classList.toggle('filled', filled);
        button.innerHTML = filled
          ? svgAtomBall(pieceObjects[pieceIndex].symbol, 64)
          : '<div style="font-weight:950;color:rgba(2,6,23,0.35);">?</div>';
      });

      redrawPreview();
      if (typeof onChange === 'function') {
        onChange(getSlots());
      }
    };

    pieceButtons.forEach((button) => {
      button.addEventListener('click', () => {
        soundTap();
        const pieceIndex = Number(button.dataset.piece);
        if (pieceObjects[pieceIndex].used) {
          return;
        }
        selectedPieceIndex = selectedPieceIndex === pieceIndex ? null : pieceIndex;
        redrawUI();
      });
    });

    slotButtons.forEach((button) => {
      button.addEventListener('click', () => {
        soundTap();
        const slotIndex = Number(button.dataset.slot);

        if (slotToPiece[slotIndex] != null) {
          const pieceIndex = slotToPiece[slotIndex];
          slotToPiece[slotIndex] = null;
          pieceObjects[pieceIndex].used = false;
          selectedPieceIndex = null;
          redrawUI();
          return;
        }

        if (selectedPieceIndex != null) {
          slotToPiece[slotIndex] = selectedPieceIndex;
          pieceObjects[selectedPieceIndex].used = true;
          selectedPieceIndex = null;
          redrawUI();
        }
      });
    });

    redrawUI();

    return {
      getSlots,
      clear: () => {
        for (let index = 0; index < slotToPiece.length; index += 1) {
          slotToPiece[index] = null;
        }
        pieceObjects.forEach((piece) => {
          piece.used = false;
        });
        selectedPieceIndex = null;
        redrawUI();
      },
    };
  }

  class ParticleSim {
    constructor(svgEl, { count = 16 } = {}) {
      this.svg = svgEl;
      this.count = count;
      this.tempIndex = 0;
      this.particles = [];
      this.raf = null;
      this.lastT = null;
      this.bounds = { x: 18, y: 18, w: 264, h: 144 };

      svgEl.innerHTML = '<rect x="10" y="10" width="280" height="160" rx="22" fill="rgba(255,255,255,0.60)" stroke="rgba(2,6,23,0.16)" stroke-width="4"></rect>';

      const colors = ['#93c5fd', '#fb7185', '#34d399', '#a78bfa'];
      for (let index = 0; index < count; index += 1) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', 7);
        circle.setAttribute('fill', colors[index % colors.length]);
        circle.setAttribute('stroke', 'rgba(2,6,23,0.18)');
        circle.setAttribute('stroke-width', '3');
        svgEl.appendChild(circle);
        this.particles.push({
          x: this.bounds.x + Math.random() * this.bounds.w,
          y: this.bounds.y + Math.random() * this.bounds.h,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          anchorX: 0,
          anchorY: 0,
          el: circle,
        });
      }

      this.assignSolidAnchors();
      this.snapToAnchors();
      this.render();
    }

    stateName() {
      return ['SOLID', 'LIQUID', 'GAS'][this.tempIndex] || '???';
    }

    setTempIndex(index) {
      const next = clamp(index, 0, 2);
      if (next === this.tempIndex) {
        return;
      }
      this.tempIndex = next;
      if (this.tempIndex === 0) {
        this.assignSolidAnchors();
        this.snapToAnchors();
      } else if (this.tempIndex === 1) {
        this.scatterLiquid();
      } else {
        this.scatterGas();
      }
    }

    assignSolidAnchors() {
      const cols = Math.ceil(Math.sqrt(this.count));
      const rows = Math.ceil(this.count / cols);
      const gapX = this.bounds.w / (cols + 1);
      const gapY = this.bounds.h / (rows + 1);
      for (let index = 0; index < this.count; index += 1) {
        const col = index % cols;
        const row = Math.floor(index / cols);
        this.particles[index].anchorX = this.bounds.x + gapX * (col + 1);
        this.particles[index].anchorY = this.bounds.y + gapY * (row + 1);
      }
    }

    snapToAnchors() {
      this.particles.forEach((particle) => {
        particle.x = particle.anchorX;
        particle.y = particle.anchorY;
        particle.vx = 0;
        particle.vy = 0;
      });
    }

    scatterLiquid() {
      this.particles.forEach((particle) => {
        particle.x = this.bounds.x + Math.random() * this.bounds.w;
        particle.y = this.bounds.y + this.bounds.h * (0.55 + Math.random() * 0.45);
        particle.vx = (Math.random() - 0.5) * 1.2;
        particle.vy = (Math.random() - 0.5) * 1.2;
      });
    }

    scatterGas() {
      this.particles.forEach((particle) => {
        particle.x = this.bounds.x + Math.random() * this.bounds.w;
        particle.y = this.bounds.y + Math.random() * this.bounds.h;
        particle.vx = (Math.random() - 0.5) * 3.2;
        particle.vy = (Math.random() - 0.5) * 3.2;
      });
    }

    start() {
      if (this.raf) {
        return;
      }
      const tick = (time) => {
        this.raf = window.requestAnimationFrame(tick);
        if (this.lastT == null) {
          this.lastT = time;
        }
        const dt = clamp((time - this.lastT) / 16.67, 0.6, 1.8);
        this.lastT = time;
        this.step(time, dt);
        this.render();
      };
      this.raf = window.requestAnimationFrame(tick);
    }

    stop() {
      if (this.raf) {
        window.cancelAnimationFrame(this.raf);
      }
      this.raf = null;
      this.lastT = null;
    }

    step(time, dt) {
      const minX = this.bounds.x;
      const maxX = this.bounds.x + this.bounds.w;
      const minY = this.bounds.y;
      const maxY = this.bounds.y + this.bounds.h;

      if (this.tempIndex === 0) {
        this.particles.forEach((particle, index) => {
          const wiggle = 0.8;
          const wiggleX = Math.sin(time / 260 + index) * wiggle;
          const wiggleY = Math.cos(time / 240 + index) * wiggle;
          particle.x += (particle.anchorX + wiggleX - particle.x) * (0.18 * dt);
          particle.y += (particle.anchorY + wiggleY - particle.y) * (0.18 * dt);
        });
        return;
      }

      const isLiquid = this.tempIndex === 1;
      const noise = isLiquid ? 0.10 : 0.18;
      const friction = isLiquid ? 0.985 : 0.993;
      const gravity = isLiquid ? 0.10 : 0.0;
      const pushDown = isLiquid ? 0.14 : 0.0;
      const speed = isLiquid ? 1.0 : 1.55;

      this.particles.forEach((particle) => {
        particle.vx += (Math.random() - 0.5) * noise * dt;
        particle.vy += (Math.random() - 0.5) * noise * dt;
        particle.vy += gravity * dt;

        if (isLiquid && particle.y < minY + this.bounds.h * 0.35) {
          particle.vy += pushDown * dt;
        }

        particle.x += particle.vx * speed * dt;
        particle.y += particle.vy * speed * dt;

        const bounce = isLiquid ? 0.86 : 0.92;
        if (particle.x < minX) {
          particle.x = minX;
          particle.vx *= -bounce;
        }
        if (particle.x > maxX) {
          particle.x = maxX;
          particle.vx *= -bounce;
        }
        if (particle.y < minY) {
          particle.y = minY;
          particle.vy *= -bounce;
        }
        if (particle.y > maxY) {
          particle.y = maxY;
          particle.vy *= -bounce;
        }

        particle.vx *= friction;
        particle.vy *= friction;
      });
    }

    render() {
      this.particles.forEach((particle) => {
        particle.el.setAttribute('cx', particle.x.toFixed(1));
        particle.el.setAttribute('cy', particle.y.toFixed(1));
      });
    }
  }

  function normalizeProgress(progress) {
    return {
      status: progress.status || 'not_started',
      totalItems: progress.totalItems || state.items.length,
      completedItems: progress.completedItems || 0,
      totalStars: progress.totalStars || 0,
      maxStars: progress.maxStars || state.items.reduce((sum, item) => sum + (item.points || 0), 0),
      percentComplete: progress.percentComplete || 0,
      completed: !!progress.completed,
      currentItemIndex: Number.isFinite(progress.currentItemIndex) ? progress.currentItemIndex : 0,
      currentItemStableId: progress.currentItemStableId || '',
      stickerUnlocked: !!progress.stickerUnlocked,
      stickerLabel: progress.stickerLabel || 'Sticker',
      itemStates: Array.isArray(progress.itemStates) ? progress.itemStates : [],
    };
  }

  state.progress = normalizeProgress(state.progress);
  state.currentIndex = clamp(state.currentIndex, 0, state.items.length);

  function getCurrentItem() {
    return state.items[state.currentIndex] || null;
  }

  function updateStatusSummary() {
    const starsEarned = $('#status-stars-earned');
    const starsMax = $('#status-stars-max');
    const done = $('#status-items-done');
    const total = $('#status-items-total');
    const reward = $('#status-reward-text');

    if (starsEarned) {
      starsEarned.textContent = String(state.progress.totalStars);
    }
    if (starsMax) {
      starsMax.textContent = String(state.progress.maxStars);
    }
    if (done) {
      done.textContent = String(state.progress.completedItems);
    }
    if (total) {
      total.textContent = String(state.progress.totalItems);
    }
    if (reward) {
      reward.textContent = state.progress.stickerUnlocked
        ? `${state.progress.stickerLabel} unlocked!`
        : `${state.progress.stickerLabel} waiting at the finish line.`;
    }
  }

  function stageProgress(nextProgress) {
    state.pendingProgress = normalizeProgress(nextProgress);
    state.pendingAdvanceIndex = state.pendingProgress.currentItemIndex;
    state.progress = {
      ...state.pendingProgress,
      completed: false,
      currentItemIndex: state.currentIndex,
    };
    updateStatusSummary();
  }

  function commitPendingProgress() {
    if (!state.pendingProgress) {
      state.currentIndex = clamp(state.currentIndex + 1, 0, state.items.length);
      return;
    }

    const wasCompleted = !!state.progress.completed;
    const nextProgress = normalizeProgress(state.pendingProgress);
    state.justCompleted = !wasCompleted && nextProgress.completed;
    state.progress = nextProgress;
    state.currentIndex = clamp(state.pendingAdvanceIndex ?? nextProgress.currentItemIndex, 0, state.items.length);
    state.pendingProgress = null;
    state.pendingAdvanceIndex = null;
  }

  async function postJson(url, body) {
    const response = await window.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body || {}),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed.');
    }

    return payload;
  }

  function buildSubmitUrl(item) {
    return `${state.paths.submitBase}/${encodeURIComponent(item.stableId)}/submit${state.paths.submitPreviewQuery || ''}`;
  }

  async function submitPayload(item, payload) {
    if (state.requesting) {
      return null;
    }

    state.requesting = true;
    try {
      return await postJson(buildSubmitUrl(item), payload);
    } finally {
      state.requesting = false;
    }
  }

  async function resetProgress() {
    const confirmed = window.confirm('Reset stars and sticker progress for this lesson?');
    if (!confirmed) {
      return;
    }

    try {
      const result = await postJson(state.paths.restart, {});
      state.progress = normalizeProgress(result.progress || {});
      state.pendingProgress = null;
      state.pendingAdvanceIndex = null;
      state.currentIndex = clamp(state.progress.currentItemIndex || 0, 0, state.items.length);
      render();
    } catch (error) {
      window.alert(error.message || 'Unable to reset progress.');
    }
  }

  function renderShell(item) {
    app.innerHTML = `
      <div class="topbar">
        <div class="brand">
          <div class="logo">${renderArt(state.theme.mascotArt || state.theme.iconArt, 'logo')}</div>
          <div>
            <div class="title">${escapeHtml(state.subtopic.title || 'Learning Lesson')}</div>
            <div class="subtitle">Step ${state.currentIndex + 1} / ${state.items.length}</div>
          </div>
        </div>
        <div class="topActions">
          <a class="chip" href="${escapeHtml(state.paths.topic || '/learning')}">← Topic</a>
          <button class="chip" id="learning-sound-toggle">${state.soundEnabled ? 'Sound: ON' : 'Sound: OFF'}</button>
          <button class="chip" id="learning-reset-progress">Reset</button>
        </div>
      </div>
      <div class="statusRow">
        <div class="statusCard">
          <div class="statusBig"><span class="rankPill">Stars</span></div>
          <div class="statusText">You have <b id="status-stars-earned">${state.progress.totalStars}</b> / <span id="status-stars-max">${state.progress.maxStars}</span></div>
        </div>
        <div class="statusCard">
          <div class="statusBig"><span class="rankPill">Progress</span></div>
          <div class="statusText"><b id="status-items-done">${state.progress.completedItems}</b> / <span id="status-items-total">${state.progress.totalItems}</span> items done</div>
        </div>
        <div class="statusCard">
          <div class="statusBig"><span class="rankPill">Reward</span></div>
          <div class="statusText" id="status-reward-text">${state.progress.stickerUnlocked ? `${escapeHtml(state.progress.stickerLabel)} unlocked!` : `${escapeHtml(state.progress.stickerLabel)} waiting at the finish line.`}</div>
        </div>
      </div>
      <div class="panel" style="margin-top:14px;">
        <div class="panelHead">
          <div class="panelTitle">${escapeHtml(item.title || state.subtopic.title || 'Lesson')}</div>
          <div class="panelBlurb">${escapeHtml(item.blurb || item.helperText || state.subtopic.description || '')}</div>
        </div>
        <div class="panelBody" id="player-body"></div>
        <div class="panelFoot" id="player-foot"></div>
      </div>
    `;

    $('#learning-sound-toggle').addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      persistSoundPreference();
      render();
    });

    $('#learning-reset-progress').addEventListener('click', () => {
      resetProgress();
    });
  }

  function renderSceneAtomPlay(mount) {
    mount.innerHTML = `
      <div class="atomWidgetWrap">
        <div class="speech">
          <div class="speechTitle">Atoms are tiny!</div>
          <div class="speechText">They have a middle called the nucleus and electrons zooming around it.</div>
        </div>
        <div id="atomMount"></div>
        <div class="controls">
          <button class="btn" id="btnAdd">+ electron</button>
          <button class="btn secondary" id="btnRemove">-</button>
          <button class="btn secondary" id="btnClear">Clear</button>
        </div>
        <div class="bigNumber">Electrons: <span id="count">0</span></div>
      </div>
    `;

    const widget = mountAtomWidget($('#atomMount', mount), {
      accent: state.theme.accentColor || '#ffb703',
      count: 0,
      max: 8,
    });
    const countEl = $('#count', mount);
    const sync = () => {
      countEl.textContent = String(widget.getCount());
    };
    sync();

    $('#btnAdd', mount).addEventListener('click', () => {
      widget.add();
      sync();
      soundTap();
    });
    $('#btnRemove', mount).addEventListener('click', () => {
      widget.remove();
      sync();
      soundTap();
    });
    $('#btnClear', mount).addEventListener('click', () => {
      widget.clear();
      sync();
      soundTap();
    });
  }

  function renderSceneMoleculeBuilder(mount, item) {
    mount.innerHTML = `
      <div class="sceneTwoCol">
        <div class="speech">
          <div class="speechTitle">Molecules are atoms holding hands</div>
          <div class="speechText">Build one by tapping atoms and bubbles.</div>
          <div class="tinyLine">Try H-O-H or O-C-O.</div>
        </div>
        <div>
          <div id="builderMount"></div>
          <div class="resultBubble" id="result">Make a molecule!</div>
        </div>
      </div>
    `;

    const result = $('#result', mount);
    mountTapBuilder($('#builderMount', mount), {
      accent: state.theme.accentColor || '#38bdf8',
      pieces: item.config.pieces || ['H', 'H', 'O', 'O', 'C'],
      slots: item.config.slotCount || 3,
      onChange: (symbols) => {
        const joined = symbols.map((symbol) => symbol || '_').join('');
        if (joined === 'HOH') {
          result.textContent = 'H-O-H = WATER (H₂O)!';
        } else if (joined === 'OCO') {
          result.textContent = 'O-C-O = CO₂!';
        } else if (!symbols.includes(null)) {
          result.textContent = 'Mystery molecule!';
        } else {
          result.textContent = 'Tap an atom, then a bubble.';
        }
      },
    });
  }

  function renderSceneParticleParty(mount) {
    mount.innerHTML = `
      <div class="particleWrap">
        <div class="speech">
          <div class="speechTitle">Particles are always moving</div>
          <div class="speechText">Heat makes them faster. Cool makes them slower.</div>
        </div>
        <svg class="particleSvg" viewBox="0 0 300 180" id="pSvg" aria-label="Particles in a box"></svg>
        <div class="particleControls">
          <button class="btn secondary" id="coolBtn">${svgSnowIcon()} Cool</button>
          <button class="btn" id="heatBtn">${svgSunIcon()} Heat</button>
          <div class="particleLabel" id="label">SOLID</div>
          <div class="thermo" id="thermo"></div>
        </div>
      </div>
    `;

    const thermo = $('#thermo', mount);
    thermo.innerHTML = '<div class="thermoSeg"></div><div class="thermoSeg"></div><div class="thermoSeg"></div>';
    const sim = new ParticleSim($('#pSvg', mount), { count: 16 });
    sim.setTempIndex(0);
    sim.start();
    onCleanup(() => sim.stop());

    const label = $('#label', mount);
    const segments = $$('.thermoSeg', thermo);
    const sync = () => {
      label.textContent = sim.stateName();
      segments.forEach((segment, index) => {
        segment.classList.toggle('on', index <= sim.tempIndex);
      });
    };
    sync();

    $('#coolBtn', mount).addEventListener('click', () => {
      sim.setTempIndex(sim.tempIndex - 1);
      sync();
      soundTap();
    });
    $('#heatBtn', mount).addEventListener('click', () => {
      sim.setTempIndex(sim.tempIndex + 1);
      sync();
      soundTap();
    });
  }

  async function handleSceneAdvance(item) {
    try {
      const result = await submitPayload(item, { action: 'complete' });
      if (!result) {
        return;
      }
      state.progress = normalizeProgress(result.progress || {});
      state.currentIndex = clamp(state.progress.currentItemIndex, 0, state.items.length);
      soundGood();
      render();
    } catch (error) {
      window.alert(error.message || 'Unable to save progress.');
    }
  }

  function renderSceneItem(item, body, foot) {
    if (item.config.sceneType === 'molecule_builder') {
      renderSceneMoleculeBuilder(body, item);
    } else if (item.config.sceneType === 'particle_party') {
      renderSceneParticleParty(body, item);
    } else {
      renderSceneAtomPlay(body);
    }

    foot.innerHTML = `
      <button class="btn secondary" id="btnLeaveScene">Back to Topic</button>
      <button class="btn" id="btnSceneNext">Next →</button>
    `;

    $('#btnLeaveScene').addEventListener('click', () => {
      window.location.href = state.paths.topic || '/learning';
    });

    $('#btnSceneNext').addEventListener('click', () => {
      handleSceneAdvance(item);
    });
  }

  function createFeedbackController(feedbackEl, nextButton) {
    let answered = false;
    return {
      answered: () => answered,
      applyCorrect: (message, progress) => {
        answered = true;
        feedbackEl.className = 'feedback good';
        feedbackEl.textContent = message || 'Correct!';
        nextButton.disabled = false;
        stageProgress(progress);
        confettiBurst(18);
        soundGood();
        announce('Correct!');
      },
      applyWrong: (message, progress) => {
        state.progress = normalizeProgress(progress);
        updateStatusSummary();
        feedbackEl.className = 'feedback bad';
        feedbackEl.textContent = message || 'Try again!';
        soundBad();
        announce('Try again');
      },
    };
  }

  function renderQuestionShell(item, foot) {
    foot.innerHTML = `
      <button class="btn secondary" id="btnTopicBack">Back to Topic</button>
      <button class="btn" id="btnNext" disabled>Next →</button>
    `;

    $('#btnTopicBack').addEventListener('click', () => {
      window.location.href = state.paths.topic || '/learning';
    });

    $('#btnNext').addEventListener('click', () => {
      commitPendingProgress();
      render();
    });

    return $('#btnNext');
  }

  function renderSingleChoice(item, body, foot) {
    body.innerHTML = `
      <div class="quizHead">
        <div class="quizProgress">Question ${state.currentIndex + 1} / ${state.items.length}</div>
        <div class="quizStars">${starRow(state.progress.totalStars, state.progress.maxStars)}</div>
      </div>
      <div class="speech" style="margin-top:14px;">
        <div class="speechTitle">${escapeHtml(item.prompt)}</div>
        ${item.helperText ? `<div class="speechText">${escapeHtml(item.helperText)}</div>` : ''}
      </div>
      <div class="optionGrid">
        ${(item.config.options || []).map((option) => `
          <button class="optionBtn" data-key="${escapeHtml(option.key)}">
            <div class="optSvg">${renderArt(option.art, 'option')}</div>
            <div class="optLabel">${escapeHtml(option.label)}</div>
          </button>
        `).join('')}
      </div>
      <div class="feedback" id="feedback">Pick an answer!</div>
    `;

    const nextButton = renderQuestionShell(item, foot);
    const feedback = $('#feedback', body);
    const controller = createFeedbackController(feedback, nextButton);
    $$('button.optionBtn', body).forEach((button) => {
      button.addEventListener('click', async () => {
        if (controller.answered()) {
          return;
        }
        soundTap();
        try {
          const result = await submitPayload(item, { optionKey: button.dataset.key });
          if (!result) {
            return;
          }
          if (result.isCorrect) {
            $$('button.optionBtn', body).forEach((node) => {
              node.disabled = true;
            });
            controller.applyCorrect(result.feedbackMessage, result.progress);
          } else {
            controller.applyWrong(result.feedbackMessage, result.progress);
          }
        } catch (error) {
          feedback.className = 'feedback bad';
          feedback.textContent = error.message || 'Unable to save answer.';
        }
      });
    });
  }

  function renderCountTarget(item, body, foot) {
    body.innerHTML = `
      <div class="quizHead">
        <div class="quizProgress">Question ${state.currentIndex + 1} / ${state.items.length}</div>
        <div class="quizStars">${starRow(state.progress.totalStars, state.progress.maxStars)}</div>
      </div>
      <div class="speech" style="margin-top:14px;">
        <div class="speechTitle">${escapeHtml(item.prompt)}</div>
        ${item.helperText ? `<div class="speechText">${escapeHtml(item.helperText)}</div>` : ''}
      </div>
      <div class="atomWidgetWrap" style="margin-top:14px;">
        <div id="atomMount"></div>
        <div class="controls">
          <button class="btn" id="plus">+ ${escapeHtml(item.config.counterLabel || 'Count')}</button>
          <button class="btn secondary" id="minus">-</button>
          <button class="btn secondary" id="clear">Clear</button>
        </div>
        <div class="bigNumber">Count: <span id="countValue">0</span></div>
        <div class="controls">
          <button class="btn" id="checkCount">Check</button>
        </div>
      </div>
      <div class="feedback" id="feedback">Use the buttons, then tap check.</div>
    `;

    const widget = mountAtomWidget($('#atomMount', body), {
      accent: state.theme.accentColor || '#ffb703',
      count: 0,
      max: item.config.max || 8,
    });
    const countValue = $('#countValue', body);
    const sync = () => {
      countValue.textContent = String(widget.getCount());
    };
    sync();

    $('#plus', body).addEventListener('click', () => {
      widget.add();
      sync();
      soundTap();
    });
    $('#minus', body).addEventListener('click', () => {
      widget.remove();
      sync();
      soundTap();
    });
    $('#clear', body).addEventListener('click', () => {
      widget.clear();
      sync();
      soundTap();
    });

    const nextButton = renderQuestionShell(item, foot);
    const feedback = $('#feedback', body);
    const controller = createFeedbackController(feedback, nextButton);

    $('#checkCount', body).addEventListener('click', async () => {
      if (controller.answered()) {
        return;
      }
      try {
        const result = await submitPayload(item, { count: widget.getCount() });
        if (!result) {
          return;
        }
        if (result.isCorrect) {
          controller.applyCorrect(result.feedbackMessage, result.progress);
        } else {
          controller.applyWrong(result.feedbackMessage, result.progress);
        }
      } catch (error) {
        feedback.className = 'feedback bad';
        feedback.textContent = error.message || 'Unable to save answer.';
      }
    });
  }

  function renderBuilderSequence(item, body, foot) {
    body.innerHTML = `
      <div class="quizHead">
        <div class="quizProgress">Question ${state.currentIndex + 1} / ${state.items.length}</div>
        <div class="quizStars">${starRow(state.progress.totalStars, state.progress.maxStars)}</div>
      </div>
      <div class="speech" style="margin-top:14px;">
        <div class="speechTitle">${escapeHtml(item.prompt)}</div>
        ${item.helperText ? `<div class="speechText">${escapeHtml(item.helperText)}</div>` : ''}
      </div>
      <div id="builderMount" style="margin-top:14px;"></div>
      <div class="controls">
        <button class="btn secondary" id="resetBuilder">Reset</button>
        <button class="btn" id="checkBuilder">Check</button>
      </div>
      <div class="feedback" id="feedback">Build your answer, then tap check.</div>
    `;

    const builder = mountTapBuilder($('#builderMount', body), {
      accent: state.theme.accentColor || '#ffb703',
      pieces: item.config.pieces || [],
      slots: item.config.slots || 3,
    });

    $('#resetBuilder', body).addEventListener('click', () => {
      builder.clear();
      soundTap();
    });

    const nextButton = renderQuestionShell(item, foot);
    const feedback = $('#feedback', body);
    const controller = createFeedbackController(feedback, nextButton);

    $('#checkBuilder', body).addEventListener('click', async () => {
      if (controller.answered()) {
        return;
      }
      try {
        const result = await submitPayload(item, { sequence: builder.getSlots().filter(Boolean) });
        if (!result) {
          return;
        }
        if (result.isCorrect) {
          controller.applyCorrect(result.feedbackMessage, result.progress);
        } else {
          controller.applyWrong(result.feedbackMessage, result.progress);
        }
      } catch (error) {
        feedback.className = 'feedback bad';
        feedback.textContent = error.message || 'Unable to save answer.';
      }
    });
  }

  function renderStateChange(item, body, foot) {
    body.innerHTML = `
      <div class="quizHead">
        <div class="quizProgress">Question ${state.currentIndex + 1} / ${state.items.length}</div>
        <div class="quizStars">${starRow(state.progress.totalStars, state.progress.maxStars)}</div>
      </div>
      <div class="speech" style="margin-top:14px;">
        <div class="speechTitle">${escapeHtml(item.prompt)}</div>
        ${item.helperText ? `<div class="speechText">${escapeHtml(item.helperText)}</div>` : ''}
      </div>
      <div class="particleWrap" style="margin-top:14px;">
        <svg class="particleSvg" viewBox="0 0 300 180" id="pSvg" aria-label="Particles in a box"></svg>
        <div class="particleControls">
          ${item.config.showCoolButton === false ? '' : `<button class="btn secondary" id="coolBtn">${svgSnowIcon()} Cool</button>`}
          <button class="btn" id="heatBtn">${svgSunIcon()} Heat</button>
          <div class="particleLabel" id="label">SOLID</div>
          <div class="thermo" id="thermo"></div>
        </div>
      </div>
      <div class="feedback" id="feedback">Change the state until it matches the goal.</div>
    `;

    const thermo = $('#thermo', body);
    thermo.innerHTML = '<div class="thermoSeg"></div><div class="thermoSeg"></div><div class="thermoSeg"></div>';
    const map = { solid: 0, liquid: 1, gas: 2 };
    const sim = new ParticleSim($('#pSvg', body), { count: 16 });
    sim.setTempIndex(map[item.config.startState] ?? 0);
    sim.start();
    onCleanup(() => sim.stop());

    const label = $('#label', body);
    const segments = $$('.thermoSeg', thermo);
    const nextButton = renderQuestionShell(item, foot);
    const feedback = $('#feedback', body);
    const controller = createFeedbackController(feedback, nextButton);

    const sync = () => {
      label.textContent = sim.stateName();
      segments.forEach((segment, index) => {
        segment.classList.toggle('on', index <= sim.tempIndex);
      });
    };

    const submitState = async () => {
      if (controller.answered()) {
        return;
      }
      try {
        const result = await submitPayload(item, { state: sim.stateName().toLowerCase() });
        if (!result) {
          return;
        }
        if (result.isCorrect) {
          controller.applyCorrect(result.feedbackMessage, result.progress);
        } else {
          controller.applyWrong(result.feedbackMessage, result.progress);
        }
      } catch (error) {
        feedback.className = 'feedback bad';
        feedback.textContent = error.message || 'Unable to save answer.';
      }
    };

    const coolButton = $('#coolBtn', body);
    if (coolButton) {
      coolButton.addEventListener('click', async () => {
        sim.setTempIndex(sim.tempIndex - 1);
        sync();
        soundTap();
        await submitState();
      });
    }

    $('#heatBtn', body).addEventListener('click', async () => {
      sim.setTempIndex(sim.tempIndex + 1);
      sync();
      soundTap();
      await submitState();
    });

    sync();
  }

  function renderCurrentItem() {
    const item = getCurrentItem();
    if (!item) {
      renderComplete();
      return;
    }

    renderShell(item);
    const body = $('#player-body');
    const foot = $('#player-foot');

    if (item.templateType === 'scene') {
      renderSceneItem(item, body, foot);
      return;
    }

    if (item.templateType === 'single_choice') {
      renderSingleChoice(item, body, foot);
      return;
    }

    if (item.templateType === 'count_target') {
      renderCountTarget(item, body, foot);
      return;
    }

    if (item.templateType === 'builder_sequence') {
      renderBuilderSequence(item, body, foot);
      return;
    }

    if (item.templateType === 'state_change') {
      renderStateChange(item, body, foot);
      return;
    }

    body.innerHTML = '<div class="speech"><div class="speechTitle">This template is not supported yet.</div></div>';
    foot.innerHTML = `<a class="btn" href="${escapeHtml(state.paths.topic || '/learning')}">Back to topic</a>`;
  }

  function renderComplete() {
    app.innerHTML = `
      <div class="topbar">
        <div class="brand">
          <div class="logo">${renderArt(state.theme.iconArt || state.theme.mascotArt, 'logo')}</div>
          <div>
            <div class="title">${escapeHtml(state.subtopic.title || 'Lesson complete')}</div>
            <div class="subtitle">Nice work — your progress is saved</div>
          </div>
        </div>
        <div class="topActions">
          <a class="chip" href="${escapeHtml(state.paths.topic || '/learning')}">← Topic</a>
          <button class="chip" id="learning-reset-progress">Play Again</button>
        </div>
      </div>
      <div class="panel" style="margin-top:14px;">
        <div class="panelBody">
          <div class="endCard">
            <div class="stickerBig">${renderRewardArt()}</div>
            <h2>Lesson Complete!</h2>
            ${starRow(state.progress.totalStars, state.progress.maxStars)}
            <p>You have <b>${state.progress.totalStars}</b> total stars in this lesson.</p>
            <p>Sticker: <b>${escapeHtml(state.progress.stickerLabel)}</b></p>
          </div>
        </div>
      </div>
    `;

    $('#learning-reset-progress').addEventListener('click', () => {
      resetProgress();
    });

    if (state.justCompleted) {
      state.justCompleted = false;
      confettiBurst(46);
      soundGood();
      announce('Lesson complete!');
    }
  }

  function render() {
    cleanupAll();
    if (!state.items.length) {
      app.innerHTML = `
        <div class="panel">
          <div class="panelHead">
            <div class="panelTitle">No lesson items yet</div>
            <div class="panelBlurb">Add some content from the learning admin area.</div>
          </div>
        </div>
      `;
      return;
    }

    if (state.progress.completed || state.currentIndex >= state.items.length) {
      renderComplete();
      return;
    }

    renderCurrentItem();
  }

  render();
})();
