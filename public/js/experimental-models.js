(() => {
  'use strict';
  const root = document.querySelector('.experimental-lab');
  if (!root) return;
  const status = document.getElementById('lab-status');
  const sessions = document.getElementById('lab-sessions');
  const base = '/admin/experimental-models/api';
  let busy = false;
  async function request(path, options = {}) {
    const response = await fetch(base + path, { ...options, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'X-CSRF-Token': root.dataset.csrf, ...options.headers } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || 'Request failed. Reload the page and try again.');
    return body;
  }
  function element(tag, text) { const node = document.createElement(tag); if (text) node.textContent = text; return node; }
  async function action(work) {
    if (busy) return;
    busy = true;
    root.querySelectorAll('button').forEach(button => { button.dataset.disabled = String(button.disabled); button.disabled = true; });
    status.textContent = 'Working…';
    try { await work(); await refresh(); } catch (error) { status.textContent = error.message; }
    finally {
      root.querySelectorAll('button[data-disabled]').forEach(button => { button.disabled = button.dataset.disabled === 'true'; delete button.dataset.disabled; });
      busy = false;
    }
  }
  function renderSession(session) {
    const card = element('section'); card.className = 'lab-session';
    card.append(element('h3', `Session ${session.id.slice(0, 8)}`));
    card.append(element('p', `Expires ${new Date(session.expiresAt).toLocaleString()} · ${session.assets.length}/8 images · ${(session.bytes / 1048576).toFixed(2)} MiB`));
    const label = element('label', 'Stage one image (local only)');
    const picker = element('input'); picker.type = 'file'; picker.accept = 'image/png,image/jpeg,image/webp';
    label.append(picker); card.append(label);
    const upload = element('button', 'Upload image'); upload.type = 'button';
    upload.addEventListener('click', () => action(async () => {
      const file = picker.files[0];
      if (!file || file.size > 8388608) throw new Error('Choose one image up to 8 MiB.');
      const data = new FormData(); data.append('file', file);
      await request(`/sessions/${session.id}/files`, { method: 'POST', body: data });
    }));
    const clear = element('button', 'Clear session / Delete test data'); clear.type = 'button';
    clear.addEventListener('click', () => action(() => request(`/sessions/${session.id}`, { method: 'DELETE' })));
    card.append(upload, clear);
    const files = element('ul');
    for (const asset of session.assets) {
      const li = element('li');
      const link = element('a', `Download normalized PNG · ${asset.width} × ${asset.height} · ${(asset.bytes / 1024).toFixed(1)} KiB`);
      link.href = `${base}/sessions/${session.id}/files/${asset.id}`; link.download = '';
      li.append(link); files.append(li);
    }
    card.append(files); return card;
  }
  async function refresh() {
    const data = await request('/sessions');
    sessions.replaceChildren(...data.sessions.map(renderSession));
    status.textContent = data.sessions.length ? `${data.sessions.length} private test session(s). No model runs are available yet.` : 'No test data in this browser session.';
  }
  document.getElementById('lab-create').addEventListener('click', () => action(() => request('/sessions', { method: 'POST' })));
  document.getElementById('lab-refresh').addEventListener('click', () => action(async () => {}));
  action(async () => {});
})();
