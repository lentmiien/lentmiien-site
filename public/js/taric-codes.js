(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const token = document.querySelector('meta[name="csrf-token"]').content;
  let sha = null; let next = null; let current = null; let busy = false; let file = null;
  async function api(path, body, headers = {}) {
    const response = await fetch(`/admin/taric/codes${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-CSRF-Token': token, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json().catch(() => { throw new Error('Unable to read the response. Reload the page and check that you are signed in.'); });
    if (!response.ok) throw new Error(response.status === 409 ? 'The record changed. Search again or preview the file again before saving.' : `Request failed (${response.status}: ${data.error}). Check the CSV format or reload the page.`);
    return data;
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    $('status').textContent = 'Working…';
    try { await fn(); } catch (e) { $('status').textContent = e.message; }
    finally { busy = false; for (const button of document.querySelectorAll('button')) button.disabled = false; $('import').disabled = !sha; }
  }
  function edit(row) {
    current = row; $('editor').hidden = false; $('edit-title').textContent = `Edit ${row._id}`;
    $('approved').checked = row.approved; $('headings').value = row.headings;
    $('goods-summary').value = row.goods_summary; $('description-summary').value = row.description_summary;
    $('headings').focus();
  }
  async function load(after = '') {
    const data = await api(`/data?${new URLSearchParams({ prefix: $('prefix').value, after })}`);
    next = data.next; current = null; $('editor').hidden = true; $('codes').replaceChildren();
    $('empty').hidden = data.rows.length !== 0; $('next').hidden = !next;
    for (const row of data.rows) {
      const card = document.createElement('section'); const title = document.createElement('h3');
      title.textContent = `${row._id} — ${row.approved ? 'Approved' : 'Not approved'}`;
      const summary = document.createElement('p'); summary.textContent = row.description_summary || 'Stable description not yet set';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `Edit ${row._id}`;
      button.addEventListener('click', () => { if (!busy) edit(row); }); card.append(title, summary, button); $('codes').append(card);
    }
    $('status').textContent = `${data.rows.length} codes shown${next ? '; more available' : ''}.`;
  }
  $('csv').addEventListener('change', () => { sha = null; file = null; $('import').disabled = true; $('import-preview').textContent = ''; });
  $('preview').addEventListener('click', () => run(async () => {
    sha = null; file = $('csv').files[0]; if (!file) throw new Error('Choose a CSV file first.');
    const selected = file; const data = new FormData(); data.append('file', selected);
    const manifest = await api('/imports', data);
    if ($('csv').files[0] !== selected) return;
    sha = manifest.sha256; $('import-preview').textContent = `${manifest.rows} rows; ${manifest.unique} unique codes; ${manifest.duplicates} duplicate rows.\n${manifest.additions} new approved codes; ${manifest.existing} existing records preserved.\n${manifest.missingDescriptions} new codes need a stable description before training export.`;
    $('status').textContent = 'Preview ready. Import will approve the new codes.';
  }));
  $('import').addEventListener('click', () => run(async () => {
    if (!sha || !file) throw new Error('Preview the file first.');
    const data = new FormData(); data.append('file', file);
    const result = await api('/imports', data, { 'X-Import-Sha': sha }); sha = null; file = null;
    await load(); $('status').textContent = `${result.inserted} approved codes added. Existing records preserved.`;
  }));
  $('search').addEventListener('submit', event => { event.preventDefault(); run(() => load()); });
  $('next').addEventListener('click', () => run(() => load(next)));
  $('edit').addEventListener('submit', event => { event.preventDefault(); run(async () => {
    if (!current) return;
    const row = await api(`/${current._id}`, { expectedRevision: current.revision, approved: $('approved').checked,
      headings: $('headings').value, goods_summary: $('goods-summary').value, description_summary: $('description-summary').value });
    await load(); edit(row); $('status').textContent = `${row._id} saved.`;
  }); });
  run(() => load());
})();
