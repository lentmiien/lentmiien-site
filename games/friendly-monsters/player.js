(function () {
  'use strict';
  const core = window.MonsterVN;
  const $ = id => document.getElementById(id);
  const key = 'friendly-monsters-v1';
  let book, state, active = false, playing = false, timer, renderToken = 0;
  let artSignature = '', preloaded = [];
  const playback = new core.Playback(() => new Audio(), {
    loading() { playing = false; $('play').textContent = '朗読を一時停止'; $('audio-status').textContent = '朗読を読み込み中…'; },
    playing() { playing = true; $('play').textContent = '朗読を一時停止'; $('audio-status').textContent = '朗読中'; },
    paused() { playing = false; setAuto(false); $('play').textContent = '朗読を再開'; $('audio-status').textContent = '一時停止中'; },
    progress(value) { $('audio-progress').value = Math.max(0, Math.min(1, value)); },
    ended() { playing = false; $('play').textContent = 'もう一度聴く'; $('audio-status').textContent = '朗読おわり'; if (state.auto) scheduleNext(650); },
    error() { playing = false; setAuto(false); $('play').textContent = '朗読を再生'; $('audio-status').textContent = '音声を確認してください'; $('audio-error').hidden = false; }
  });
  function save() {
    try { localStorage.setItem(key, JSON.stringify({ version: 1, ...state })); }
    catch (_) { $('save-status').textContent = 'このブラウザーでは保存できません。目次からいつでも章を選べます。'; }
  }
  function beat() { return book.chapters[state.chapter].beats[state.beat]; }
  function setAuto(value) {
    state.auto = value; clearTimeout(timer);
    $('auto').setAttribute('aria-pressed', String(value)); $('auto').textContent = `自動送り：${value ? '入' : '切'}`;
  }
  function stop() { clearTimeout(timer); playback.stop(); playing = false; $('play').textContent = '朗読を再生'; $('audio-status').textContent = '停止中'; }
  function pause() { clearTimeout(timer); playback.pause(); setAuto(false); }
  function scheduleNext(ms) {
    clearTimeout(timer);
    const token = renderToken;
    timer = setTimeout(() => { if (token === renderToken && state.auto && !document.hidden && !$('settings').open) move(1); }, ms);
  }
  function play() {
    if (!active) return;
    clearTimeout(timer);
    $('audio-error').hidden = true;
    $('ending').hidden = true; $('next').disabled = false;
    if (state.voice) {
      if (playback.paused) playback.resume(state);
      else playback.play(beat(), state);
    }
    else {
      $('audio-status').textContent = '音声なし';
      if (state.auto) scheduleNext(Math.max(4000, beat().text.length * 110) / state.rate);
    }
  }
  function renderArt(force = false) {
    const current = beat();
    const signature = [current.background, ...current.sprites].join('|');
    $('background').alt = current.artDescription || book.chapters[state.chapter].title;
    preloadArt();
    if (signature === artSignature && !force) return;
    artSignature = signature;
    $('art-error').hidden = true;
    const failed = () => { if (artSignature === signature) $('art-error').hidden = false; };
    $('stage').classList.toggle('event-scene', current.background.includes('/cg'));
    $('background').onerror = failed;
    $('background').src = core.assetPath(current.background, 'image');
    $('sprites').replaceChildren();
    current.sprites.forEach(path => { const img = document.createElement('img'); img.alt = ''; img.dataset.character = path.split('/').pop().split('-')[0].replace('.webp', ''); img.onerror = failed; img.src = core.assetPath(path, 'image'); $('sprites').append(img); });
  }
  function preloadArt() {
    const current = beat();
    const displayed = [current.background, ...current.sprites];
    // Retain at most one current/next-beat window. No whole-book media preload.
    preloaded.forEach(img => { img.removeAttribute('src'); });
    preloaded = core.preloadPaths(book, state.chapter, state.beat).filter(path => !displayed.includes(path)).map(path => { const img = new Image(); img.src = path; return img; });
  }
  function render() {
    stop(); renderToken++;
    const chapter = book.chapters[state.chapter];
    $('chapter-label').textContent = `第${state.chapter + 1}章　${chapter.title}`;
    $('position').textContent = `${state.beat + 1} / ${chapter.beats.length}`;
    syncAnnouncements();
    $('subtitle').textContent = beat().text;
    $('audio-progress').value = 0; $('audio-error').hidden = true; $('ending').hidden = true;
    $('previous').disabled = state.chapter === 0 && state.beat === 0;
    $('next').disabled = false;
    $('audio-status').textContent = state.voice ? '朗読の準備ができました' : '音声なし';
    document.documentElement.style.setProperty('--reader-font', state.font);
    renderArt(); save();
    if (active) play();
  }
  function openAt(chapter, index) {
    stop(); state.chapter = chapter; state.beat = index; active = true;
    $('welcome').hidden = true; $('reader').hidden = false; $('settings').close(); render(); $('subtitle').focus({ preventScroll: true });
  }
  function move(direction) {
    const focusPrevious = document.activeElement === $('previous');
    let chapter = state.chapter, index = state.beat + direction;
    if (index < 0 && chapter > 0) { chapter--; index = book.chapters[chapter].beats.length - 1; }
    if (index >= book.chapters[chapter].beats.length) {
      if (chapter === book.chapters.length - 1) { stop(); setAuto(false); $('ending').hidden = false; $('next').disabled = true; $('ending').focus({ preventScroll: true }); return; }
      chapter++; index = 0;
    }
    if (index < 0) return;
    state.chapter = chapter; state.beat = index; render();
    if (focusPrevious && $('previous').disabled) $('subtitle').focus({ preventScroll: true });
  }
  function menu() {
    pause();
    [...$('chapters').children].forEach((li, i) => li.firstChild.setAttribute('aria-current', String(state.chapter === i)));
    $('settings').showModal();
  }
  async function init() {
    $('reload').hidden = true;
    try {
      const response = await fetch('story.json', { signal: AbortSignal.timeout(15000), credentials: 'omit' });
      if (!response.ok) throw new Error('Story unavailable');
      const raw = await response.text();
      if (raw.length > 2000000) throw new Error('Story too large');
      book = core.validateBook(JSON.parse(raw));
      let saved;
      try { saved = localStorage.getItem(key); } catch (_) { $('save-status').textContent = '保存が無効です。目次を使って読み進められます。'; }
      state = core.readSave(saved, book);
      for (const name of ['volume', 'rate', 'font']) $(name).value = state[name];
      $('voice').checked = state.voice; syncMute();
      $('resume').hidden = !(saved && (state.chapter > 0 || state.beat > 0));
      $('chapters').replaceChildren();
      book.chapters.forEach((chapter, index) => {
        const li = document.createElement('li'); const button = document.createElement('button');
        button.textContent = `${String(index + 1).padStart(2, '0')}　${chapter.title}`;
        button.onclick = () => { setAuto(false); openAt(index, 0); }; li.append(button); $('chapters').append(li);
      });
      $('start').disabled = false; $('menu').disabled = false;
      $('load-status').textContent = '朗読：VOICEVOX:四国めたん';
    } catch (_) { $('load-status').textContent = '物語を読み込めませんでした。接続を確認して再試行してください。'; $('reload').hidden = false; }
  }
  $('reload').onclick = init;
  $('start').onclick = () => { setAuto(false); openAt(0, 0); };
  $('restart').onclick = () => $('start').click();
  $('resume').onclick = () => openAt(state.chapter, state.beat);
  $('previous').onclick = () => move(-1); $('next').onclick = () => move(1);
  $('play').onclick = () => { if (playback.audio && !playback.paused) pause(); else play(); };
  $('retry-audio').onclick = play;
  $('text-only').onclick = () => { stop(); state.voice = false; $('voice').checked = false; $('audio-error').hidden = true; $('audio-status').textContent = '音声なし'; syncAnnouncements(); save(); };
  $('retry-art').onclick = () => renderArt(true);
  $('auto').onclick = () => { setAuto(!state.auto); if (state.auto && !playing && (!playback.audio || playback.paused)) play(); save(); };
  $('menu').onclick = menu; $('close-menu').onclick = () => $('settings').close();
  $('settings').addEventListener('cancel', pause);
  for (const name of ['volume', 'rate', 'font']) $(name).oninput = () => { state[name] = Number($(name).value); document.documentElement.style.setProperty('--reader-font', state.font); syncAnnouncements(); save(); };
  $('voice').onchange = () => { state.voice = $('voice').checked; stop(); syncAnnouncements(); save(); };
  $('clear-save').onclick = () => {
    stop(); setAuto(false);
    try { localStorage.removeItem(key); $('save-status').textContent = 'しおりを消しました。次に読み進めた場所から新しく保存します。'; } catch (_) { $('save-status').textContent = 'ブラウザーの保存領域にアクセスできません。'; }
    state = { ...core.defaults }; $('resume').hidden = true; $('settings').close(); active = false; $('reader').hidden = true; $('welcome').hidden = false;
    for (const name of ['volume', 'rate', 'font']) $(name).value = state[name]; $('voice').checked = state.voice; syncMute(); $('start').focus();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && state) { pause(); } });
  window.addEventListener('pagehide', () => { if (state) { pause(); } });
  function syncAnnouncements() {
    $('subtitle').setAttribute('aria-live', state.voice && !state.muted && state.volume > 0 ? 'off' : 'polite');
  }
  function syncMute() {
    syncAnnouncements();
    $('mute').setAttribute('aria-pressed', String(state.muted));
    $('mute').textContent = state.muted ? '消音：入' : '消音：切';
    if (playback.audio) playback.audio.muted = state.muted;
  }
  $('mute').onclick = () => { state.muted = !state.muted; syncMute(); save(); };
  document.addEventListener('keydown', event => {
    if (!book || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.target.closest?.('input, select, textarea, button, a, summary, [contenteditable]:not([contenteditable="false"])') || $('settings').open) return;
    if (event.key.toLowerCase() === 'm') { event.preventDefault(); menu(); }
    if (!active) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.code === 'Space') { event.preventDefault(); $('play').click(); }
  });
  init();
}());
