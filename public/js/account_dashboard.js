(() => {
  const root = document.getElementById('account-dashboard');
  if (!root) return;
  let settings = JSON.parse(document.getElementById('account-settings').textContent);
  const token = root.dataset.csrfToken;
  const csrfHelp = 'Your secure form session is unavailable or was rejected. Your choices are still here; note them before reloading and sign in again if asked.';
  const dialog = document.getElementById('account-customizer');
  const globalStatus = document.getElementById('account-status');
  const queue = [];
  let active = 0;
  let opener;
  const loaded = new Set();
  const inflight = new Set();
  const cards = [...root.querySelectorAll('[data-section]')];
  const labels = { ocr: 'OCR', ocr_tts: 'OCR to TTS', asr: 'Transcription', gpt_image: 'GPT Image', trellis2: 'TRELLIS.2', pixal3d: 'Pixal3D', prompt_to_3d: 'Prompt to 3D', music: 'Music', sora: 'Sora', bulk: 'ComfyUI bulk' };
  async function request(url, options = {}) {
    if (options.method && !/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error(csrfHelp);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { credentials: 'same-origin', ...options, signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': token, ...options.headers } });
      if (!response.ok || response.redirected) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.code === 'CSRF_REJECTED' || response.status === 401 || response.redirected ? csrfHelp : 'Request failed');
      }
      return options.html ? response.text() : response.json();
    } finally { clearTimeout(timeout); }
  }
  const element = (tag, value, className) => {
    const el = document.createElement(tag); if (value !== undefined) el.textContent = value;
    if (className) el.className = className; return el;
  };
  function localLink(title, href) {
    const link = element('a', title);
    if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && !/[\\\r\n]/.test(href)) link.href = href;
    return link;
  }
  function renderRows(card, data) {
    const target = card.querySelector('.account-card-data');
    if (card.dataset.section === 'tasks') {
      const list = card.querySelector('.account-task-list'); list.replaceChildren();
      const groups = new Map();
      const dateFormat = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      data.rows.forEach(row => {
        if (!groups.has(row.group)) {
          const group = element('div'); group.dataset.taskGroup = row.group;
          group.append(element('h3', row.group, 'account-task-group-title'));
          groups.set(row.group, group); list.append(group);
        }
        const wrapper = element('div', undefined, 'account-task-row');
        const link = localLink(row.title, row.href); link.className = 'schedule-task-pill'; link.draggable = false;
        link.append(element('small', row.detail));
        for (const [field, label, fallback] of [['start', 'Start', 'Available anytime'], ['end', 'Deadline', 'No deadline']]) {
          const line = element('small', row[field] ? `${label}: ` : fallback);
          if (row[field]) {
            const time = element('time', dateFormat.format(new Date(row[field])));
            time.dateTime = row[field]; line.append(time);
          }
          link.append(line);
        }
        if (row.canComplete) {
          link.dataset.taskId = row.taskId; link.setAttribute('aria-describedby', 'mypage-task-hint');
          link.setAttribute('aria-keyshortcuts', 'Space');
          const progress = element('span', undefined, 'mypage-task-progress');
          progress.append(element('span', undefined, 'mypage-task-progress__fill')); link.append(progress);
        }
        wrapper.append(link);
        groups.get(row.group).append(wrapper);
      });
      card.querySelector('.schedule-task-pill--empty').hidden = data.rows.length > 0;
      return;
    }
    if (card.dataset.section === 'life' && target.dataset.panelMounted) return;
    const list = element('ul', undefined, 'account-rows');
    data.rows.forEach(row => {
      const item = element('li', undefined, 'account-row'); item.append(localLink(row.title, row.href));
      if (row.detail) item.append(element('small', row.detail));
      if (row.at) {
        const time = element('time', new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(row.at)));
        time.dateTime = row.at; item.append(time);
      }
      list.append(item);
    });
    target.replaceChildren(list);
  }
  async function load(card) {
    const id = card.dataset.section;
    inflight.add(id); active++;
    const status = card.querySelector('.account-card-state');
    card.dataset.state = 'loading'; status.textContent = 'Loading…'; card.setAttribute('aria-busy', 'true');
    try {
      const data = await request(`/mypage/api/cards/${id}`);
      if (!data.ok) throw new Error('Invalid card response');
      card.dataset.state = data.state;
      status.textContent = ({ empty: 'Nothing here yet', stale: 'Last-known data · check freshness', unavailable: 'Not available yet' })[data.state]
        || `Updated ${new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }).format(new Date(data.fetchedAt))}`;
      renderRows(card, data); card.querySelector('.account-card-note').textContent = data.note || '';
      if (id === 'life' && !card.querySelector('.account-card-data').dataset.panelLoaded) {
        const target = card.querySelector('.account-card-data');
        if (!target.dataset.panelMounted) {
          const html = await request('/mypage/api/life-panel', { html: true });
          // This fragment is escaped Pug from the same authorized route, never record HTML.
          target.innerHTML = html; target.dataset.panelMounted = 'true';
          // A script download failure must never leave a native GET form exposing entries in a URL.
          target.querySelector('form').addEventListener('submit', event => event.preventDefault());
        }
        window.LIFE_LOG_BASE_PATH = '/mypage/api/life';
        await new Promise((resolve, reject) => {
          const script = document.createElement('script'); script.src = root.dataset.lifeLogScript;
          script.onload = () => {
            script.remove();
            if (target.querySelector('form').dataset.lifeLogInitialized === 'true') resolve();
            else reject(new Error('Life log did not initialize'));
          };
          script.onerror = () => { script.remove(); reject(new Error('Life log script unavailable')); };
          document.body.append(script);
        });
        target.dataset.panelLoaded = 'true';
      }
      loaded.add(id);
    } catch (_) {
      card.dataset.state = 'error'; status.textContent = 'Could not load. Use refresh to retry.';
    } finally {
      card.removeAttribute('aria-busy'); inflight.delete(id); active--; pump();
    }
  }
  function pump() {
    while (active < 4 && queue.length) {
      const card = queue.shift();
      if (!card.hidden && !card.querySelector('.account-card-content').hidden && !inflight.has(card.dataset.section)) void load(card);
    }
  }
  function enqueue(card, force = false) {
    if (card.hidden || card.querySelector('.account-card-content').hidden || inflight.has(card.dataset.section) || queue.includes(card)) return;
    if (force || !loaded.has(card.dataset.section)) { queue.push(card); pump(); }
  }
  cards.forEach(card => {
    card.querySelector('.account-collapse').addEventListener('click', event => {
      const content = card.querySelector('.account-card-content'); content.hidden = !content.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!content.hidden)); enqueue(card);
    });
    card.querySelector('.account-refresh').addEventListener('click', () => {
      const content = card.querySelector('.account-card-content'); content.hidden = false;
      card.querySelector('.account-collapse').setAttribute('aria-expanded', 'true'); enqueue(card, true);
    });
  });
  function openCustomize() {
    opener = document.activeElement; dialog.showModal(); document.body.classList.add('no-scroll');
  }
  document.getElementById('account-customize').addEventListener('click', openCustomize);
  root.querySelector('.account-filter-open')?.addEventListener('click', () => { openCustomize(); document.getElementById('job-scope').focus(); });
  document.getElementById('account-customize-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { document.body.classList.remove('no-scroll'); opener?.focus(); });
  dialog.addEventListener('click', event => {
    const button = event.target.closest('[data-move]'); if (!button) return;
    const item = button.closest('li');
    if (button.dataset.move === 'up' && item.previousElementSibling) item.before(item.previousElementSibling);
    else if (button.dataset.move === 'down' && item.nextElementSibling) item.after(item.nextElementSibling);
    button.focus();
  });
  // All source choices are supplied by the server for both scopes, without record counts.
  function renderTypes() {
    const scope = document.getElementById('job-scope').value;
    const available = settings.jobTypesByScope?.[scope] || settings.jobTypes || [];
    const target = document.getElementById('job-types'); target.replaceChildren();
    available.forEach(id => {
      const label = element('label'); const input = element('input'); input.type = 'checkbox'; input.value = id;
      input.checked = settings.jobs.types.includes(id); label.append(input, document.createTextNode(` ${labels[id] || id}`)); target.append(label);
    });
  }
  document.getElementById('job-scope').addEventListener('change', renderTypes);
  renderTypes();
  async function save(reset = false) {
    const status = document.getElementById('account-save-status'); status.textContent = 'Saving…';
    const items = [...document.querySelectorAll('[data-setting-id]')];
    const body = reset ? { reset: true } : {
      version: 1, sectionOrder: items.map(el => el.dataset.settingId),
      hiddenSections: items.filter(el => !el.querySelector('[data-visible]').checked).map(el => el.dataset.settingId),
      collapsedSections: items.filter(el => el.querySelector('[data-collapsed]').checked).map(el => el.dataset.settingId),
      jobs: { scope: document.getElementById('job-scope').value, status: document.getElementById('job-status').value,
        dateWindow: Number(document.getElementById('job-window').value), types: [...document.querySelectorAll('#job-types input:checked')].map(el => el.value) },
    };
    const buttons = [...dialog.querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
    try {
      const result = await request('/mypage/api/settings', { method: 'POST', body: JSON.stringify(body) });
      if (!result.ok) throw new Error('Save not acknowledged');
      settings = result.settings;
      // Reload only after the server acknowledges the save, applying all states consistently.
      window.location.reload();
    } catch (error) { status.textContent = error.message === csrfHelp ? csrfHelp : 'Could not save. Your saved settings are unchanged; try again.'; }
    finally { buttons.forEach(b => { b.disabled = false; }); }
  }
  document.getElementById('account-save').addEventListener('click', () => void save());
  document.getElementById('account-reset').addEventListener('click', () => void save(true));
  async function saveNav(reset = false) {
    const status = document.getElementById('nav-save-status'); status.textContent = 'Saving…';
    const items = [...document.querySelectorAll('[data-nav-id]')];
    try {
      const result = await request('/mypage/icon-settings', { method: 'POST', body: JSON.stringify(reset ? { reset: true } : {
        order: items.map(el => el.dataset.navId), hidden: items.filter(el => !el.querySelector('input').checked).map(el => el.dataset.navId),
      }) });
      if (!result.ok) throw new Error('Save not acknowledged');
      window.location.reload();
    } catch (error) { status.textContent = error.message === csrfHelp ? csrfHelp : 'Could not save shortcuts. Try again.'; }
  }
  document.getElementById('nav-save').addEventListener('click', () => void saveNav());
  document.getElementById('nav-reset').addEventListener('click', () => void saveNav(true));
  if (window.location.hash === '#customize-shortcuts') { openCustomize(); document.getElementById('customize-shortcuts').open = true; }
  if (!cards.some(c => !c.hidden)) globalStatus.textContent = 'All sections are hidden. Use Customize account to show them.';
  cards.forEach(card => enqueue(card));
})();
