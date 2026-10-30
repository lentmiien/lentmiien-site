(() => {
  'use strict';
  const root = document.querySelector('.experimental-lab');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const status = $('lab-status'), sessions = $('lab-sessions'), base = '/admin/experimental-models/api';
  const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  let busy = false, snapshot = [], timer, signature = '', referenceAvailable = false, refreshing = null, activeAction = null, stopped = false;
  let lifecycle = new AbortController();
  const referenceTasks = ['TTS', 'MULTILINGUAL', 'BASIC', 'EMOTION', 'DIALECT'];
  const speechTags = ['Breathing', 'Cough', 'Sigh', 'Laughter', 'Surprise-ah', 'Surprise-oh', 'Dissatisfaction-hnn', 'Uhm', 'Confirmation-en', 'Question-ei', 'Question-ah', 'Question-en', 'Question-oh', 'Question-huh'];
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const aborted = () => { clearTimeout(wait); reject(new DOMException('Page closed', 'AbortError')); };
      const wait = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, ms);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }
  async function request(path, options = {}) {
    const read = !options.method || options.method === 'GET';
    const controller = new AbortController(), page = lifecycle;
    const abort = () => controller.abort();
    page.signal.addEventListener('abort', abort, { once: true });
    const deadline = Date.now() + 45000;
    const timeout = read ? setTimeout(abort, 45000) : null;
    let lastBusy;
    try {
      for (let attempt = 0; ; attempt += 1) {
        if (page.signal.aborted) throw new DOMException('Page closed', 'AbortError');
        const response = await fetch(base + path, { ...options, signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
          headers: { Accept: 'application/json', 'X-CSRF-Token': root.dataset.csrf, ...options.headers } });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) throw new DOMException('Read aborted', 'AbortError');
        if ([401, 403].includes(response.status)) { clearBrowserData(); status.textContent = 'Authorization expired. Reload the page.'; }
        if (response.ok) return body;
        const code = /^[a-z][a-z0-9_]{0,79}$/.test(body?.code || '') ? body.code : 'request_failed';
        const reason = /^[a-z][a-z0-9_]{0,79}$/.test(body?.reason || '') ? ` · ${body.reason}` : '';
        const prefix = Number.isInteger(response.status) ? `HTTP ${response.status} · ${code}${reason}: ` : '';
        const error = new Error(prefix + (body?.error || 'Request failed. Refresh and try again.'));
        error.inspection = { status: response.status, code, stage: body?.stage, reason: body?.reason, numeric: body?.numeric, requestId: body?.requestId };
        // Only this safe read failure is retried. Mutations are never replayed,
        // including immediate busy responses and uncertain network outcomes.
        if (!read || response.status !== 429 || code !== 'storage_busy') throw error;
        lastBusy = error;
        const retryAfter = response.headers?.get('Retry-After');
        const retryMs = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000
          : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
        const wait = Math.max(Number.isFinite(retryMs) ? retryMs : 0, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
        if (attempt >= 4 || Date.now() + wait >= deadline) {
          error.message += ' Automatic read retries stopped; refresh to check again.'; throw error;
        }
        status.textContent = 'Waiting for test storage…';
        await delay(wait, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted && !page.signal.aborted) {
        if (lastBusy) lastBusy.message += ' Read deadline reached; refresh to check again.';
        throw lastBusy || new Error('Session read timed out. Refresh to check its current state.');
      }
      throw error;
    } finally {
      clearTimeout(timeout); page.signal.removeEventListener('abort', abort);
    }
  }
  function element(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
  function button(text, handler) { const node = element('button', text); node.type = 'button'; node.addEventListener('click', handler); return node; }
  function fileUrl(sessionId, fileId) {
    if (!idPattern.test(sessionId) || !idPattern.test(fileId)) throw new Error('Invalid result identifier.');
    return `${base}/sessions/${sessionId}/files/${fileId}`;
  }
  function link(text, href) { const node = element('a', text); node.href = href; node.download = ''; return node; }
  function inspector(title, value) {
    const details = element('details'); details.append(element('summary', title));
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    details.append(element('pre', text.length > 65536 ? text.slice(0, 65536) + '\n[Preview truncated; download full sanitized result.]' : text));
    return details;
  }
  function showFailure(error) {
    status.textContent = error.message;
    if (error.inspection) $('lab-error-inspector').replaceChildren(inspector('Request failure (safe diagnostics)', error.inspection));
  }
  function schedulePoll() {
    clearTimeout(timer);
    if (stopped || busy || !snapshot.some(s => s.deletePending || (s.jobs || []).some(j => ['queued', 'waiting_gateway'].includes(j.state)))) return;
    timer = setTimeout(async () => {
      if (stopped || busy) return;
      try { await refresh(); if (!busy) schedulePoll(); }
      catch (error) { if (!stopped && !busy) showFailure(error); } // Persistent failure stops automatic polling.
    }, 5000);
  }
  function disableButtons() {
    root.querySelectorAll('button:not([data-disabled])').forEach(b => { b.dataset.disabled = String(b.disabled); b.disabled = true; });
  }
  function action(work) {
    if (busy || stopped) return;
    activeAction = performAction(work).finally(() => { activeAction = null; });
    return activeAction;
  }
  async function performAction(work) {
    const page = lifecycle;
    busy = true; clearTimeout(timer); status.textContent = 'Working…'; $('lab-error-inspector').replaceChildren();
    disableButtons();
    let refreshed = false;
    try {
      // Coalesce an already running poll, then keep polls paused until this owned
      // action and its one final refresh settle. Never overlap list requests.
      if (refreshing) await refreshing.catch(() => {});
      if (page.signal.aborted) return;
      await work();
      if (page.signal.aborted) return;
      await refresh(); refreshed = true;
    } catch (error) { if (!page.signal.aborted) showFailure(error); }
    finally {
      root.querySelectorAll('button[data-disabled]').forEach(b => { b.disabled = b.dataset.disabled === 'true'; delete b.dataset.disabled; });
      busy = false; updateMingTask();
      if (refreshed) schedulePoll();
    }
  }
  function updateSelect(select, choices) {
    const previous = select.value;
    select.replaceChildren(...choices.map(([value, text]) => { const option = element('option', text); option.value = value; return option; }));
    if (choices.some(([value]) => value === previous)) select.value = previous;
  }
  function updateImages() {
    const session = snapshot.find(s => s.id === $('lab-session').value);
    updateSelect($('wevis-file'), (session?.assets || []).filter(a => a.mime === 'image/png').map(a => [a.id, `${a.id.slice(0, 8)} · ${a.width} × ${a.height}`]));
    updateSelect($('ming-file'), (session?.assets || []).filter(a => a.mime === 'audio/wav' && a.audio && a.referenceEligible !== false).map(a => [a.id, `${a.id.slice(0, 8)} · ${a.audio.sampleRate} Hz · ${a.audio.durationSeconds.toFixed(2)} s`]));
    updateImagePreview(); updateReferencePreview(); updatePreviews();
  }
  function updateImagePreview() {
    const preview = $('wevis-preview'), selected = $('wevis-file').value; preview.hidden = !selected;
    if (selected) { const url = fileUrl($('lab-session').value, selected); if (preview.getAttribute('src') !== url) preview.src = url; } else preview.removeAttribute('src');
  }
  function updateReferencePreview() {
    const preview = $('ming-reference-preview'), selected = $('ming-file').value;
    preview.hidden = !selected;
    if (selected) {
      const url = fileUrl($('lab-session').value, selected);
      if (preview.getAttribute('src') !== url) { preview.src = url; $('ming-consent').checked = false; }
    } else preview.removeAttribute('src');
    const asset = snapshot.find(s => s.id === $('lab-session').value)?.assets.find(a => a.id === selected);
    $('ming-reference-metadata').textContent = asset ? `${asset.audio.channels} channel(s), PCM16, ${asset.audio.sampleRate} Hz, ${asset.audio.durationSeconds.toFixed(2)} seconds, ${asset.bytes} bytes` : '';
  }
  function stopAudio(container) {
    container.querySelectorAll('audio').forEach(audio => { audio.pause(); audio.removeAttribute('src'); audio.load(); });
  }
  function clearBrowserData() {
    stopped = true; clearTimeout(timer); lifecycle.abort();
    clearDrafts(); snapshot = []; signature = ''; sessions.replaceChildren(); $('lab-error-inspector').replaceChildren();
    updateSelect($('lab-session'), []); updateImages();
  }
  function clearDrafts() {
    for (const id of ['ming-text', 'ming-style', 'ming-instruction', 'ming-transcript', 'wevis-query', 'ming-upload']) $(id).value = '';
    $('ming-consent').checked = false; $('ming-transcript-verification').hidden = true;
    stopAudio(root);
    updatePreviews();
  }
  function wevisInput() { return { fileId: $('wevis-file').value, task: $('wevis-task').value,
    query: $('wevis-task').value === 'ocr' ? '' : $('wevis-query').value, max_new_tokens: Number($('wevis-tokens').value) }; }
  function mingInput() {
    const task = $('ming-task').value;
    const controls = {};
    for (const key of ['speed', 'pitch', 'volume', 'emotion', 'dialect']) if (!$(`ming-${key}`).disabled && $(`ming-${key}`).value) controls[key] = $(`ming-${key}`).value;
    return { task, text: $('ming-text').value, language: $('ming-language').value,
      ...(referenceTasks.includes(task) ? { controls, fileId: $('ming-file').value, transcript: $('ming-transcript').value, consent: $('ming-consent').checked }
        : task === 'VOICE_DESIGN' ? { controls: { style: $('ming-style').value } } : { instruction: $('ming-instruction').value }), max_decode_steps: Number($('ming-steps').value) };
  }
  function updatePreviews() {
    $('wevis-request').textContent = JSON.stringify(wevisInput(), null, 2);
    $('ming-request').textContent = JSON.stringify(mingInput(), null, 2);
  }
  function overlay(session, job, result) {
    const asset = session.assets.find(a => a.id === job.fileId && a.mime === 'image/png');
    if (!asset) return element('p', 'Source image is unavailable.');
    const wrapper = element('div'); wrapper.className = 'lab-preview';
    const img = element('img'); img.src = fileUrl(session.id, asset.id); img.alt = 'EXIF-oriented image sent to WeVis'; wrapper.append(img);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${asset.width} ${asset.height}`); svg.setAttribute('aria-label', 'WeVis region overlay');
    for (const region of (result.regions || []).slice(0, 1024)) {
      const p = region.pixels;
      if (!Array.isArray(p) || p.length > 8192 || p.some((v, i) => !Number.isFinite(v) || v < 0 || v > (i % 2 ? asset.height : asset.width))) continue;
      let shape;
      if (region.shape === 'box' && p.length === 4 && p[0] <= p[2] && p[1] <= p[3]) {
        shape = document.createElementNS(svg.namespaceURI, 'rect');
        for (const [key, value] of Object.entries({ x: p[0], y: p[1], width: p[2] - p[0], height: p[3] - p[1] })) shape.setAttribute(key, value);
      } else if (region.shape === 'point' && p.length === 2) {
        shape = document.createElementNS(svg.namespaceURI, 'circle'); shape.setAttribute('cx', p[0]); shape.setAttribute('cy', p[1]); shape.setAttribute('r', Math.max(asset.width, asset.height) / 150);
      } else if (region.shape === 'polygon' && p.length >= 6 && p.length % 2 === 0) {
        shape = document.createElementNS(svg.namespaceURI, 'polygon'); shape.setAttribute('points', p.join(' '));
      }
      if (!shape) continue;
      shape.setAttribute('vector-effect', 'non-scaling-stroke');
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = region.label; shape.append(title); svg.append(shape);
    }
    wrapper.append(svg);
    const container = element('div'), label = element('label', 'Show region overlay '), toggle = element('input'); toggle.type = 'checkbox'; toggle.checked = true;
    toggle.addEventListener('change', () => { svg.hidden = !toggle.checked; svg.style.display = toggle.checked ? '' : 'none'; });
    label.append(toggle); container.append(label, wrapper); return container;
  }
  function renderJob(session, job) {
    const card = element('article'); card.className = 'lab-job';
    const names = { queued: 'Queued locally', waiting_gateway: 'Waiting for Gateway (queue / preparation / inference)', succeeded: 'Inference response received',
      failed: 'Failed', cancelled: 'Cancelled before forwarding', interrupted: 'Interrupted — completion may be unknown' };
    card.append(element('h4', `${job.model} · ${names[job.state] || job.state}`));
    const elapsed = ((job.endedAt || Date.now()) - job.createdAt) / 1000;
    card.append(element('p', `Site elapsed at last refresh: ${Math.max(0, elapsed).toFixed(1)} s · ${job.id.slice(0, 8)}`));
    card.append(inspector('Submitted request (sanitized)', job.request || '{}'));
    if (job.status) card.append(inspector('Sanitized Gateway response / Site failure status and safe headers', { status: job.status, headers: job.headers || {}, code: job.code }));
    if (job.error) card.append(element('p', job.error));
    if (job.model === 'wevisone-vl' && ['failed', 'interrupted'].includes(job.state)) {
      if (job.inspectionId) {
        const panel = element('div');
        card.append(element('p', 'Rejected model output: invalid. Validated diagnostics are available; no geometry preview is shown.'));
        card.append(button('Inspect rejected model output', () => action(async () => {
          const value = await request(`/sessions/${session.id}/files/${job.inspectionId}`);
          const d = value.detail.diagnostics;
          panel.replaceChildren(inspector('Sanitized Gateway response', value));
          panel.append(element('p', d.raw_available
            ? `Rejected model output: ${d.raw_truncated ? 'truncated prefix' : d.raw_text === '' ? 'empty decoded string' : 'available'}. Original length: ${d.raw_length} Unicode code points (before Site redaction).`
            : 'Rejected model output: unavailable. No raw generation was captured.'));
          if (d.raw_available) panel.append(inspector('Rejected model output (escaped text; server secrets and private storage redacted)', d.raw_text));
        })), panel);
      } else {
        card.append(element('p', 'Rejected model output: unavailable. No validated failure diagnostics were received; failure may have occurred before decoding. Output is not valid and no overlay is shown.'));
      }
    }
    if (job.resultId && job.state === 'succeeded') {
      const url = fileUrl(session.id, job.resultId);
      card.append(link(job.audio ? 'Download complete WAV' : 'Download complete sanitized JSON', url));
      if (job.audio) {
        const audio = element('audio'); audio.controls = true; audio.preload = 'none'; audio.src = url;
        card.append(audio, inspector('Site-parsed WAV metadata (not Gateway JSON)', job.audio));
        const asset = session.assets.find(a => a.id === job.resultId);
        const reuse = button('Use as reference', () => {
          if (busy) return;
          if (!referenceAvailable) { status.textContent = 'Check Ming availability before using reference audio.'; return; }
          clearDrafts(); $('lab-session').value = session.id; updateImages();
          let submitted = {};
          try { const preview = JSON.parse(job.request); submitted = preview.json || preview.fields?.request || {}; } catch (_) { /* verify manually */ }
          $('ming-task').value = ['ja', 'ko', 'de', 'fr', 'es'].includes(submitted.language) ? 'MULTILINGUAL' : 'TTS';
          updateMingTask();
          if (Array.from($('ming-language').options).some(option => option.value === submitted.language)) $('ming-language').value = submitted.language;
          $('ming-file').value = asset.id; updateReferencePreview();
          $('ming-transcript').value = typeof submitted.text === 'string' ? submitted.text : '';
          $('ming-transcript-verification').hidden = false; $('ming-consent').checked = false;
          updatePreviews(); $('ming-transcript').focus();
          status.textContent = 'VERIFY_TRANSCRIPT: listen and correct the proposed transcript, then give explicit consent. Existing audio is reused without another upload.';
        });
        reuse.disabled = asset?.referenceEligible !== true;
        card.append(reuse, element('p', asset?.referenceReason || 'Reference eligibility is unavailable. Refresh this session.'));
      } else {
        const output = element('div');
        const load = button('Inspect result and overlay', async () => {
          load.disabled = true;
          try {
            const result = await request(`/sessions/${session.id}/files/${job.resultId}`);
            if (stopped) return;
            output.replaceChildren(element('p', `Count: ${result.count ?? 'not provided'} · declared: ${result.declared_count ?? 'not provided'}`),
              inspector('Extracted text (generation order)', result.text ?? ''), inspector('Raw model text (sanitized)', result.raw_text || ''),
              overlay(session, job, result), inspector('Full structured response (preview)', result));
          } catch (error) { output.textContent = error.message; load.disabled = false; }
        }); card.append(load, output);
      }
    }
    return card;
  }
  function renderSession(session) {
    const card = element('section'); card.className = 'lab-session';
    card.append(element('h3', `Session ${session.id.slice(0, 8)}`));
    card.append(element('p', `Expires ${new Date(session.expiresAt).toLocaleString()} · ${session.assets.length}/8 files/results · ${(session.bytes / 1048576).toFixed(2)} MiB including reservations`));
    if (session.deletePending) { card.append(element('p', 'Deletion pending — waiting for active request or download to close.')); return card; }
    const label = element('label', 'Stage one image');
    const picker = element('input'); picker.type = 'file'; picker.accept = 'image/png,image/jpeg,image/webp'; label.append(picker); card.append(label);
    card.append(button('Upload image', () => action(async () => {
      const file = picker.files[0];
      if (!file || file.size > 8388608) throw new Error('Choose one image up to 8 MiB.');
      const data = new FormData(); data.append('file', file);
      await request(`/sessions/${session.id}/files`, { method: 'POST', body: data });
    })), button('Clear session / Delete test data', () => action(async () => {
      await request(`/sessions/${session.id}`, { method: 'DELETE' });
      if ($('lab-session').value === session.id) clearDrafts();
    })));
    const files = element('ul');
    for (const asset of session.assets.filter(a => a.mime === 'image/png')) {
      const li = element('li'); li.append(link(`Normalized PNG · ${asset.width} × ${asset.height} · ${(asset.bytes / 1024).toFixed(1)} KiB`, fileUrl(session.id, asset.id))); files.append(li);
    }
    card.append(files, ...(session.jobs || []).map(job => renderJob(session, job))); return card;
  }
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = readSessions().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function readSessions() {
    const page = lifecycle;
    const data = await request('/sessions');
    if (page.signal.aborted) return;
    if (snapshot.some(s => s.id === $('lab-session').value) && !data.sessions.some(s => s.id === $('lab-session').value && !s.deletePending)) clearDrafts();
    snapshot = data.sessions;
    const nextSignature = JSON.stringify(snapshot);
    if (signature !== nextSignature) { stopAudio(sessions); sessions.replaceChildren(...snapshot.map(renderSession)); signature = nextSignature; }
    updateSelect($('lab-session'), snapshot.filter(s => !s.deletePending).map(s => [s.id, `Session ${s.id.slice(0, 8)}`])); updateImages();
    if (busy) disableButtons();
    status.textContent = snapshot.length ? `${snapshot.length} private test session(s).` : 'No test data in this browser session.';
  }
  function validateMing(input) {
    const validText = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[<>\x00-\x08\x0b-\x1f\x7f]/.test(value);
    if (!['VOICE_DESIGN', 'FREEFORM', ...referenceTasks].includes(input.task) || !validText(input.text, 500)) throw new Error('Enter nonblank speech text up to 500 characters, without angle brackets or control characters.');
    const residue = input.text.replace(/\[([^\[\]]+)\]/g, (match, tag) => speechTags.includes(tag) && ['zh', 'en'].includes(input.language) ? '' : match);
    if (/[\[\]]/.test(residue)) throw new Error('Use only the documented speech tags in zh/en text; multilingual text accepts no tags.');
    if (!Number.isInteger(input.max_decode_steps) || input.max_decode_steps < 8 || input.max_decode_steps > 400) throw new Error('Decode steps must be an integer from 8 to 400.');
    if (input.task === 'BASIC' && !Object.keys(input.controls).length) throw new Error('Choose at least one of speed, pitch or volume.');
    if (input.task === 'VOICE_DESIGN' && !validText(input.controls.style, 512) || input.task === 'FREEFORM' && !validText(input.instruction, 512)) throw new Error('Enter the required style or instruction, up to 512 characters.');
    if (referenceTasks.includes(input.task) && (!input.fileId || !validText(input.transcript, 4096) || Array.from(input.transcript).length > 2048 || new Blob([input.transcript]).size > 8192)) throw new Error('Choose a staged WAV and enter a valid transcript, up to 2048 characters and 8192 UTF-8 bytes.');
  }
  function submit(model, input) {
    return action(async () => {
      const id = $('lab-session').value;
      if (!id) throw new Error('Create or select a test session first.');
      if (model === $('lab-ming').dataset.model && referenceTasks.includes(input.task) && (!referenceAvailable || input.consent !== true)) throw new Error('Check reference availability and give affirmative consent before running.');
      if (model === $('lab-ming').dataset.model) validateMing(input);
      await request(`/sessions/${id}/experiments/${model}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      if (model === $('lab-ming').dataset.model) $('ming-consent').checked = false;
    });
  }
  $('lab-wevis').addEventListener('submit', event => { event.preventDefault(); submit($('lab-wevis').dataset.model, wevisInput()); });
  $('lab-ming').addEventListener('submit', event => { event.preventDefault(); submit($('lab-ming').dataset.model, mingInput()); });
  $('wevis-task').addEventListener('change', () => {
    const task = $('wevis-task').value; $('wevis-query').disabled = task === 'ocr'; $('wevis-query').required = task !== 'ocr';
    $('wevis-help').textContent = ({ ocr: 'OCR requires an empty query. Text remains in model generation order.', detection: 'Describe objects; put multiple labels on separate lines.',
      referring: 'Enter one referring expression. Commas and phrases are preserved.', point: 'Describe objects; put multiple labels on separate lines.',
      count_box: 'Describe what to count; returns boxes.', count_point: 'Describe what to count; returns points.', ocr_grounding: 'Enter the text to find in this image.' })[task]; updatePreviews();
  });
  function updateMingTask() {
    const task = $('ming-task').value, design = task === 'VOICE_DESIGN', freeform = task === 'FREEFORM', reference = referenceTasks.includes(task);
    $('ming-style-field').hidden = !design; $('ming-style').disabled = !design; $('ming-style').required = design;
    $('ming-instruction-field').hidden = !freeform; $('ming-instruction').disabled = !freeform; $('ming-instruction').required = freeform;
    $('ming-reference').hidden = !reference; $('ming-reference').disabled = !reference || !referenceAvailable;
    const languages = task === 'MULTILINGUAL' ? [['ja', 'Japanese'], ['ko', 'Korean'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish']]
      : task === 'DIALECT' ? [['zh', 'Chinese']] : [['en', 'English'], ['zh', 'Chinese']];
    updateSelect($('ming-language'), languages.map(([value, name]) => [value, `${name} (${value})`]));
    $('ming-tag-field').hidden = task === 'MULTILINGUAL';
    $('ming-tags').querySelectorAll('button').forEach(button => { button.disabled = task === 'MULTILINGUAL'; });
    const allowed = { BASIC: ['speed', 'pitch', 'volume'], EMOTION: ['emotion'], DIALECT: ['dialect'] }[task] || [];
    for (const key of ['speed', 'pitch', 'volume', 'emotion', 'dialect']) {
      $(`ming-${key}-field`).hidden = !allowed.includes(key); $(`ming-${key}`).disabled = !allowed.includes(key);
      $(`ming-${key}`).required = allowed.includes(key) && task !== 'BASIC';
    }
    $('ming-control-help').textContent = task === 'BASIC' ? 'Choose at least one of speed, pitch or volume.' : task === 'MULTILINGUAL' ? 'No controls or speech tags are accepted for multilingual text.' : '';
    updatePreviews();
  }
  $('ming-task').addEventListener('change', updateMingTask);
  $('ming-file').addEventListener('change', () => { $('ming-consent').checked = false; $('ming-transcript').value = ''; $('ming-transcript-verification').hidden = true; updateReferencePreview(); updatePreviews(); });
  $('ming-upload-button').addEventListener('click', () => action(async () => {
    const id = $('lab-session').value, file = $('ming-upload').files[0];
    if (!id || !file || file.size > 6291456) throw new Error('Select a session and one PCM16 WAV up to 6 MiB.');
    const data = new FormData(); data.append('file', file);
    await request(`/sessions/${id}/references`, { method: 'POST', body: data });
    $('ming-upload').value = ''; $('ming-consent').checked = false;
  }));
  for (const tag of speechTags) {
    $('ming-tags').append(button(`[${tag}]`, () => { const text = $('ming-text'), addition = `[${tag}]`;
      if (text.value.length - (text.selectionEnd - text.selectionStart) + addition.length > 500) { status.textContent = 'Speech text is limited to 500 characters.'; return; }
      text.setRangeText(addition, text.selectionStart, text.selectionEnd, 'end'); text.focus(); updatePreviews(); }));
  }
  root.querySelectorAll('.lab-capabilities').forEach(control => control.addEventListener('click', () => action(async () => {
    const output = control.nextElementSibling;
    try {
      const capabilities = await request(`/experiments/${control.dataset.model}/capabilities`);
      output.textContent = JSON.stringify(capabilities, null, 2);
      if (control.dataset.model === $('lab-wevis').dataset.model) {
        $('wevis-inspection-status').textContent = capabilities.failureInspection?.enabled === true
          ? 'Compatible failure inspection v1 is available. The server automatically requests it for admin lab WeVis runs; failed output remains invalid.'
          : 'Failure inspection unavailable: Gateway does not advertise the supported version. Ordinary WeVis runs remain available.';
      }
      if (control.dataset.model === $('lab-ming').dataset.model) {
        referenceAvailable = capabilities.referenceAdapter === 'available' && capabilities.available === true;
        $('ming-availability').textContent = capabilities.referenceAdapter !== 'available' ? 'Unsupported Gateway: deploy the updated Gateway and Ming worker for ephemeral references.'
          : capabilities.available ? 'Ephemeral reference v1 available. Controls remain experimentally unqualified; a runtime failure is reported on the job.' : 'Ephemeral reference v1 is supported, but Ming is currently unavailable.';
      }
    } catch (error) {
      output.textContent = error.message;
      if (control.dataset.model === $('lab-ming').dataset.model) { referenceAvailable = false; $('ming-availability').textContent = `Availability check failed: ${error.message}`; }
    }
    if (control.dataset.model === $('lab-ming').dataset.model) {
      $('ming-task').querySelectorAll('option').forEach(option => {
        if (referenceTasks.includes(option.value)) { option.disabled = !referenceAvailable; option.textContent = option.value + (referenceAvailable ? '' : ' — unavailable'); }
      });
      if (!referenceAvailable && referenceTasks.includes($('ming-task').value)) $('ming-task').value = 'VOICE_DESIGN';
      updateMingTask();
    }
  })));
  $('lab-session').addEventListener('change', () => { clearDrafts(); updateImages(); });
  $('wevis-file').addEventListener('change', updateImagePreview);
  root.addEventListener('input', updatePreviews);
  $('lab-create').addEventListener('click', () => action(() => request('/sessions', { method: 'POST' })));
  $('lab-refresh').addEventListener('click', () => action(async () => {}));
  window.addEventListener('pagehide', clearBrowserData);
  window.addEventListener('pageshow', async event => {
    if (!event.persisted) return;
    if (activeAction) await activeAction;
    if (refreshing) await refreshing.catch(() => {});
    lifecycle = new AbortController(); stopped = false; action(async () => {});
  });
  updateMingTask(); action(async () => {});
})();
