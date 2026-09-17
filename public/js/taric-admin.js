/* All untrusted values are rendered as text, never HTML. No local/session storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const token = document.querySelector('meta[name="csrf-token"]').content;
  let previewSha = null; let cursor = null;
  const show = (id, value) => { $(id).textContent = JSON.stringify(value, null, 2); };
  async function api(path, body, multipart = false, extraHeaders = {}) {
    const response = await fetch(`/admin/taric${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...extraHeaders, Accept: 'application/json', 'X-CSRF-Token': token, ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request rejected'); return data;
  }
  const on = (id, fn) => $(id).addEventListener('click', async () => {
    $(id).disabled = true; $('status').textContent = 'Working…';
    try { await fn(); $('status').textContent = 'Done.'; } catch (e) { $('status').textContent = e.message; }
    finally { $(id).disabled = id === 'import' && !previewSha; }
  });
  async function refresh() {
    const state = await api('/state'); show('readiness', { normal: state.normal, test: state.test, inference: state.inference, credential: state.credential, template: state.template, codeFingerprint: state.codeFingerprint });
    $('enabled').checked = state.settings?.enabled === true; $('max-tokens').value = state.settings?.maxTokens || 256;
    $('catalog').value = JSON.stringify(state.settings?.catalog || null, null, 2);
    $('runtime').value = JSON.stringify(state.settings?.runtime || { adapters: [] }, null, 2);
  }
  const clearSecret = () => { $('secret').textContent = ''; $('secret-panel').hidden = true; };
  let testId = null;
  on('test', async () => {
    const request = { item_code: $('test-code').value, descriptive_name: $('test-name').value, input_hs_code: $('test-hs').value, test: true };
    const data = await api('/test', request, false, { 'Idempotency-Key': crypto.randomUUID() });
    testId = data.id; show('test-result', data);
  });
  on('test-poll', async () => { if (!testId) throw new Error('Submit a test first.'); show('test-result', await api(`/test/${testId}`)); });
  on('test-feedback', async () => {
    if (!testId) throw new Error('Submit a test first.');
    show('test-feedback-result', await api(`/test/${testId}/feedback`, { selected_code: $('test-selected-code').value }, false, { 'Idempotency-Key': `feedback-${testId}` }));
  });
  on('resume', async () => { if (!$('confirm-idle').checked) throw new Error('Verify the Gateway is idle first.'); await api('/inference/resume', { confirmIdle: true }); $('confirm-idle').checked = false; await refresh(); });
  on('refresh', refresh);
  on('rotate', async () => {
    clearSecret(); const data = await api('/credential/rotate', {});
    $('secret').textContent = data.secret; $('secret-panel').hidden = false; setTimeout(clearSecret, 60000);
  });
  on('clear-secret', clearSecret); window.addEventListener('pagehide', clearSecret);
  on('revoke', async () => { clearSecret(); await api('/credential/revoke', {}); await refresh(); });
  on('save-config', async () => { await api('/config', { enabled: $('enabled').checked, maxTokens: Number($('max-tokens').value), catalog: JSON.parse($('catalog').value), runtime: JSON.parse($('runtime').value) }); await refresh(); });
  async function upload(action) {
    const file = $('csv').files[0]; if (!file) throw new Error('Choose a private CSV file.');
    const form = new FormData(); form.append('file', file);
    form.append('metadata', JSON.stringify({ action, version: Number($('version').value), review: JSON.parse($('review').value), expectedSha: previewSha }));
    return api('/imports', form, true);
  }
  $('csv').addEventListener('change', () => { previewSha = null; $('import').disabled = true; });
  on('preview', async () => { const report = await upload('preview'); show('import-report', report); previewSha = report.sha256; $('import').disabled = false; });
  on('import', async () => { if (!previewSha) throw new Error('Preview the file first.'); const report = await upload('import'); show('import-report', report); $('benchmark-id').value = report.id; previewSha = null; });
  on('adapters', async () => { const rows = await api('/adapters'); $('adapter').replaceChildren(...rows.map(r => { const option = document.createElement('option'); option.value = r.name; option.textContent = r.name; return option; })); });
  on('run', async () => { const run = await api(`/benchmarks/${encodeURIComponent($('benchmark-id').value)}/runs`, { adapter: $('adapter').value }); $('run-id').value = run.id; show('records', run); });
  on('publish', async () => { await api(`/benchmarks/${encodeURIComponent($('benchmark-id').value)}/publish`, {}); await refresh(); });
  on('cancel', async () => { await api(`/runs/${encodeURIComponent($('run-id').value)}/cancel`, {}); });
  async function inspect(next = false) {
    const rows = await api(`/inspect/${$('kind').value}${next && cursor ? `?before=${cursor}` : ''}`); show('records', rows);
    cursor = rows.at(-1)?._id; $('next').disabled = rows.length < 25;
  }
  on('inspect', () => inspect()); on('next', () => inspect(true));
  on('detail', async () => show('details', await api(`/inspect/${$('kind').value}/${encodeURIComponent($('detail-id').value)}?offset=${Number($('offset').value)}`)));
  refresh().then(() => { $('status').textContent = 'Readiness loaded.'; }).catch(e => { $('status').textContent = e.message; });
})();
