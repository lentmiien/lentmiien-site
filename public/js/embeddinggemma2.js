/* global document, fetch, FormData, URL, confirm */
(() => {
  'use strict';
  const root = document.querySelector('.eg2');
  const status = document.getElementById('eg2-status');
  const progress = document.getElementById('eg2-progress');
  const base = '/admin/embeddinggemma2/api';
  let next = null; let busy = false;
  function element(tag, text) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; }
  function message(text, error = false) { status.textContent = text; status.classList.toggle('eg2-error', error); }
  function pending(value) {
    busy = value; progress.hidden = !value; root.setAttribute('aria-busy', String(value));
    root.querySelectorAll('button').forEach(b => { b.disabled = value; });
  }
  async function request(path, options = {}) {
    const response = await fetch(base + path, { ...options, credentials: 'same-origin', headers: { Accept: 'application/json', 'X-CSRF-Token': root.dataset.csrf, ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}). Reload and check access.`);
    return data;
  }
  function preview(kind, url) {
    const media = element(kind === 'image' ? 'img' : kind);
    media.src = url;
    if (kind === 'image') { media.alt = 'Original test image'; media.loading = 'lazy'; }
    else { media.controls = true; media.preload = 'metadata'; }
    return media;
  }
  function render(records, target) {
    target.replaceChildren();
    if (!records.length) { target.append(element('p', 'No records to show.')); return; }
    records.forEach(record => {
      const card = element('article'); card.className = 'eg2-record';
      card.append(element('h3', record.title || record.filename || `${record.kind} document`));
      card.append(element('p', `${record.kind} · ${new Date(record.capturedAt).toLocaleString()} · ${record.bytes} bytes`));
      if (record.similarity !== undefined) card.append(element('strong', `Cosine similarity: ${record.similarity.toFixed(5)}`));
      if (record.kind === 'text') card.append(element('pre', record.text));
      else {
        card.append(preview(record.kind, record.mediaUrl));
        const link = element('a', 'Open original media'); link.href = record.mediaUrl; link.target = '_blank'; link.rel = 'noopener'; card.append(link);
      }
      const details = element('details'); details.append(element('summary', 'Embedding provenance'));
      details.append(element('pre', JSON.stringify({ model: record.model, revision: record.revision, space_id: record.space_id, dimensions: record.dimensions, normalized: record.normalized, precision: record.precision, preprocessing: record.preprocessing, mapping: record.mapping }, null, 2))); card.append(details);
      const remove = element('button', 'Delete record'); remove.type = 'button'; remove.disabled = busy;
      remove.addEventListener('click', async () => {
        if (busy || !confirm('Delete this record and its original media permanently?')) return;
        pending(true);
        try { await request(`/records/${record.id}`, { method: 'DELETE' }); await load(); document.getElementById('eg2-results').replaceChildren(); message('Record deleted.'); }
        catch (error) { message(error.message, true); }
        finally { pending(false); }
      });
      card.append(remove); target.append(card);
    });
  }
  async function load(before) {
    const data = await request(`/records${before ? `?before=${encodeURIComponent(before)}` : ''}`);
    next = data.next; document.getElementById('eg2-more').hidden = !next;
    document.getElementById('eg2-counts').textContent = `${data.counts.count}/${data.limits.items} records · ${(data.counts.bytes / 1048576).toFixed(2)}/${(data.limits.bytes / 1048576).toFixed(0)} MiB · ${data.counts.compatible} compatible searchable records. Pending recovery records count toward capacity.`;
    render(data.records, document.getElementById('eg2-records'));
  }
  root.querySelectorAll('form').forEach(form => {
    const kind = form.elements.kind; const file = form.elements.file; let objectUrl;
    const update = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
      form.querySelector('.eg2-preview').replaceChildren();
      const text = kind.value === 'text'; form.querySelector('.eg2-text').hidden = !text; form.querySelector('.eg2-file').hidden = text;
      form.elements.text.disabled = !text; form.elements.text.required = text; if (form.elements.title) form.elements.title.disabled = !text;
      file.disabled = text; file.required = !text;
      file.accept = { image: '.png,.jpg,.jpeg,.webp', audio: '.wav,.mp3,.flac,.ogg,.opus,.m4a,.mp4,.mov,.mkv,.mka,.webm', video: '.mp4,.mov,.mkv,.webm' }[kind.value] || '';
      const selected = file.files[0];
      if (selected) {
        const target = form.querySelector('.eg2-preview');
        target.append(element('p', `${selected.name} · ${selected.size} bytes. Local preview; server validation still applies.`));
        if (selected.size <= 8388608 && (kind.value !== 'image' || ['image/png', 'image/jpeg', 'image/webp'].includes(selected.type))) {
          objectUrl = URL.createObjectURL(selected); target.append(preview(kind.value, objectUrl));
        }
      }
    };
    kind.addEventListener('change', () => { file.value = ''; update(); }); file.addEventListener('change', update);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      if (file.files[0]?.size > 8388608) { message('File exceeds 8 MiB.', true); return; }
      pending(true); message('Working… cold startup and queueing can take 30 minutes. Do not submit again.');
      try {
        const body = new FormData(form); const search = form.dataset.mode === 'search';
        let options;
        if (kind.value === 'text') {
          const json = Object.fromEntries(body); delete json.file; if (!json.title) delete json.title;
          options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) };
        } else options = { method: 'POST', body };
        const data = await request(search ? '/search' : '/records', options);
        if (search) {
          render(data.records, document.getElementById('eg2-results'));
          document.getElementById('eg2-coverage').textContent = `Scanned all ${data.scanned}/${data.eligible} eligible records; ${data.excluded} excluded by model space, modality filter or pending state. ${data.total} total owned records. Cosines are not probabilities.`;
          message('Search complete. Query input was not stored.');
        } else { await load(); message('Original content and embedding added.'); }
      } catch (error) { message(`${error.message} No automatic retry was attempted. Refresh the dataset before resubmitting an add.`, true); }
      finally { pending(false); }
    });
  });
  document.getElementById('eg2-refresh').addEventListener('click', async () => { if (busy) return; pending(true); try { await load(); message('Dataset refreshed.'); } catch (error) { message(error.message, true); } finally { pending(false); } });
  document.getElementById('eg2-more').addEventListener('click', async () => { if (busy || !next) return; pending(true); try { await load(next); } catch (error) { message(error.message, true); } finally { pending(false); } });
  load().then(() => message('Ready. Add content or search your test dataset.')).catch(error => message(error.message, true));
})();
