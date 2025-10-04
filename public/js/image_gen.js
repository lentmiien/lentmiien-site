// public/js/image_gen.js (full updated, includes rating + prompt library)
(function(){
  const $ = (s, r=document)=>r.querySelector(s);
  const logEl = $('#log');
  const statusPill = $('#statusPill');

  let workflows = [];
  let wfMap = new Map();
  let currentJobId = null;
  let ratingBarVisible = false;

  function setStatus(t){ statusPill.textContent = t; }
  function log(msg, cls){
    const t = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    if (cls) div.classList.add(cls);
    div.textContent = `[${t}] ${msg}`;
    logEl.prepend(div);
  }
  async function api(path, opts={}){
    const url = `/image_gen${path}`;
    const init = Object.assign({ headers: {} }, opts);
    if(!(init.body instanceof FormData) && init.method && init.method.toUpperCase() !== 'GET'){
      init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
    }
    const r = await fetch(url, init);
    if(!r.ok){
      const text = await r.text().catch(()=> '');
      throw new Error(`${r.status} ${r.statusText} — ${text}`);
    }
    const ct = r.headers.get('content-type') || '';
    if(ct.includes('application/json')) return r.json();
    return r;
  }

  // Health
  $('#btnHealth').addEventListener('click', async ()=>{
    try {
      const j = await api('/api/health');
      const dot = $('#healthDot');
      dot.textContent = j.ok ? 'ok' : 'error';
      dot.className = `badge ${j.ok ? 'bg-success' : 'bg-danger'}`;
      log('Health ok.');
    } catch (e) {
      const dot = $('#healthDot');
      dot.textContent = 'error';
      dot.className = 'badge bg-danger';
      log('Health failed: ' + e.message, 'text-danger');
    }
  });

  // Workflows
  function clearForm(){
    $('#formArea').innerHTML = '';
    $('#wfDesc').textContent = '';
  }
  function ctl(spec){
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6';
    const id = 'inp_' + spec.key;

    const label = document.createElement('label');
    label.className = 'form-label';
    label.setAttribute('for', id);
    label.textContent = spec.key + (spec.required ? ' *' : '');
    col.appendChild(label);

    let ctrl;
    if (spec.type === 'string' && (spec.key === 'prompt' || spec.key === 'negative')) {
      ctrl = document.createElement('textarea');
      ctrl.className = 'form-control';
      ctrl.rows = spec.key === 'prompt' ? 5 : 3;
    } else if (spec.type === 'number') {
      ctrl = document.createElement('input');
      ctrl.type = 'number';
      ctrl.className = 'form-control';
      if (spec.min !== undefined) ctrl.min = spec.min;
      if (spec.max !== undefined) ctrl.max = spec.max;
      if (spec.step !== undefined) ctrl.step = spec.step;
    } else {
      ctrl = document.createElement('input');
      ctrl.type = 'text';
      ctrl.className = 'form-control';
    }
    ctrl.id = id;
    if (spec.default !== undefined) ctrl.value = spec.default;
    if (spec.key === 'image') ctrl.placeholder = 'filename in input/ (e.g. photo.png)';
    col.appendChild(ctrl);

    if (spec.note || spec.default !== undefined) {
      const small = document.createElement('small');
      small.className = 'text-muted';
      small.textContent = (spec.note ? spec.note + ' ' : '') + (spec.default !== undefined ? `(default: ${spec.default})` : '');
      col.appendChild(small);
    }
    return col;
  }
  function renderForm(def){
    clearForm();
    if(!def) return;
    $('#wfDesc').textContent = def.description || '';
    const area = $('#formArea');
    def.inputs.forEach(spec => area.appendChild(ctl(spec)));
  }
  async function loadWorkflows(){
    setStatus('loading');
    try{
      const j = await api('/api/workflows');
      workflows = j.workflows || [];
      wfMap = new Map(workflows.map(w => [w.key, w]));
      const sel = $('#wfSelect');
      sel.innerHTML = '';
      workflows.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.key; opt.textContent = w.name || w.key;
        sel.appendChild(opt);
      });
      $('#wfCount').textContent = `${workflows.length} loaded`;
      if (workflows[0]) {
        sel.value = workflows[0].key;
        renderForm(workflows[0]);
      }
      setStatus('ready');
      log(`Loaded ${workflows.length} workflow(s).`);
    }catch(e){
      setStatus('error');
      log('Load workflows failed: ' + e.message, 'text-danger');
    }
  }
  $('#btnLoadWf').addEventListener('click', loadWorkflows);
  $('#wfSelect').addEventListener('change', (e)=>{
    const def = wfMap.get(e.target.value);
    renderForm(def);
  });

  // Generate
  async function generate(){
    const def = wfMap.get($('#wfSelect').value);
    if(!def){ log('Select a workflow first.', 'text-warning'); return; }

    const inputs = {};
    for(const spec of def.inputs){
      const el = $('#inp_' + spec.key);
      if(!el) continue;
      if(spec.type === 'number') {
        const v = el.value.trim();
        inputs[spec.key] = v === '' ? spec.default ?? null : Number(v);
      } else {
        inputs[spec.key] = el.value;
      }
      if (spec.required && (inputs[spec.key] === '' || inputs[spec.key] === null || inputs[spec.key] === undefined)) {
        log(`Missing required: ${spec.key}`, 'text-warning');
        return;
      }
    }

    $('#btnGenerate').disabled = true;
    setStatus('queuing');
    hideRatingBar();
    try{
      const resp = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ workflow: $('#wfSelect').value, inputs })
      });
      $('#jobId').value = resp.job_id || '';
      currentJobId = resp.job_id || null;
      $('#jobStatus').textContent = 'queued';
      log(`Queued job ${resp.job_id}`);
      await poll(resp.job_id);
    }catch(e){
      log('Generate failed: ' + e.message, 'text-danger');
    }finally{
      $('#btnGenerate').disabled = false;
    }
  }
  $('#btnGenerate').addEventListener('click', generate);
  $('#btnPoll').addEventListener('click', ()=>{
    const id = $('#jobId').value.trim();
    if (id) poll(id);
  });

  async function poll(jobId){
    setStatus('waiting');
    $('#results').innerHTML = '';
    for (let i=0;i<300;i++){
      try{
        const j = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
        $('#jobStatus').textContent = j.status;
        if (j.status === 'completed') {
          setStatus('completed');
          log(`Completed with ${j.files.length} image(s).`, 'text-success');
          await showResults(jobId, j.files);
          showRatingBar(jobId);
          return;
        } else if (j.status === 'failed') {
          setStatus('failed');
          log(`Failed: ${j.error || 'Unknown error'}`, 'text-danger');
          return;
        }
      }catch(e){
        log('Poll error: ' + e.message, 'text-danger');
      }
      await new Promise(r=>setTimeout(r, 2000));
    }
    setStatus('timeout');
    log('Polling timeout.', 'text-warning');
  }

  async function showResults(jobId, files){
    const wrap = $('#results');
    wrap.innerHTML = '';
    for (let i=0;i<files.length;i++){
    const fileMeta = files[i];
    const filename = typeof fileMeta === 'string'
      ? fileMeta
      : (fileMeta?.filename || fileMeta?.name || fileMeta?.file || `image_${i}.png`);
    const url = `/image_gen/api/jobs/${encodeURIComponent(jobId)}/images/${i}${filename ? `?filename=${encodeURIComponent(filename)}` : ''}`;
    try{
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Image ${i} ${resp.status}`);
      const contentType = resp.headers.get('content-type') || 'image/png';
      const cacheUrl = filename ? `/imgen/${encodeURIComponent(filename)}` : null;
      const arrayBuffer = await resp.arrayBuffer();

      let imgSrc = cacheUrl;
      let downloadHref = cacheUrl;
      if (!cacheUrl) {
        const blob = new Blob([arrayBuffer], { type: contentType });
        imgSrc = URL.createObjectURL(blob);
        downloadHref = imgSrc;
      }

      const col = document.createElement('div'); col.className = 'col';
      const card = document.createElement('div'); card.className = 'thumb';
      const img = document.createElement('img'); img.src = imgSrc; img.alt = filename;
      if (!cacheUrl) {
        img.addEventListener('load', () => { try { URL.revokeObjectURL(imgSrc); } catch {} }, { once: true });
      }
      const caption = document.createElement('div'); caption.className = 'muted mt-1'; caption.textContent = filename;
      const dl = document.createElement('a'); dl.href = downloadHref; dl.download = filename; dl.textContent = 'Download';
      card.appendChild(img); card.appendChild(caption); card.appendChild(dl);
      col.appendChild(card); wrap.appendChild(col);
    }catch(e){
      log('Render image failed: ' + e.message, 'text-danger');
    }
  }
}

  // Rating bar
  function showRatingBar(jobId){
    if (!jobId || ratingBarVisible) return;
    const cont = document.createElement('div');
    cont.id = 'ratingBar';
    cont.className = 'd-flex gap-2 align-items-center mt-3';
    cont.innerHTML = `
      <span class="text-muted">Rate this result:</span>
      <div class="btn-group" role="group" aria-label="Rating">
        <button type="button" class="btn btn-outline-secondary" data-rate="bad">Bad</button>
        <button type="button" class="btn btn-outline-primary" data-rate="ok">OK</button>
        <button type="button" class="btn btn-outline-success" data-rate="good">Good</button>
        <button type="button" class="btn btn-success" data-rate="great">Great</button>
      </div>
      <span id="ratingMsg" class="text-muted"></span>
    `;
    const jobCard = document.getElementById("job_card_body") || document.body;
    jobCard.appendChild(cont);
    cont.querySelectorAll('button[data-rate]').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const rating = e.currentTarget.getAttribute('data-rate');
        try{
          cont.querySelectorAll('button').forEach(b=>b.disabled=true);
          const resp = await api('/api/rate', { method:'POST', body: JSON.stringify({ job_id: jobId, rating }) });
          $('#ratingMsg').textContent = 'Thanks!';
          setTimeout(hideRatingBar, 1200);
        }catch(err){
          $('#ratingMsg').textContent = 'Rating failed';
          log('Rate failed: ' + err.message, 'text-danger');
          cont.querySelectorAll('button').forEach(b=>b.disabled=false);
        }
      });
    });
    ratingBarVisible = true;
  }
  function hideRatingBar(){
    const el = $('#ratingBar');
    if (el) el.remove();
    ratingBarVisible = false;
  }

  // Upload
  $('#btnUpload').addEventListener('click', async ()=>{
    const f = $('#fileUp').files[0];
    if(!f){ log('Choose a file first.', 'text-warning'); return; }
    const fd = new FormData(); fd.append('image', f, f.name);
    try{
      const r = await api('/api/files/input', { method:'POST', body: fd });
      $('#lastUpload').textContent = `Uploaded as ${r.filename || r.file || '(see response)'}`;
      log(`Uploaded ${f.name}${r.filename ? ' -> ' + r.filename : ''}`, 'text-success');
      const imageCtl = $('#inp_image'); if (imageCtl && r.filename) imageCtl.value = r.filename;
    }catch(e){
      log('Upload failed: ' + e.message, 'text-danger');
    }
  });

  // Browse
  $('#btnListInput').addEventListener('click', ()=> list('input'));
  $('#btnListOutput').addEventListener('click', ()=> list('output'));
  const hideBtn = $('#btnHideBrowse');
  if (hideBtn) {
    hideBtn.addEventListener('click', () => {
      const area = $('#browseArea');
      if (area) area.innerHTML = '';
      log('Cleared browse list.');
    });
  }

  async function list(bucket){
    const area = $('#browseArea'); area.innerHTML = '';
    try{
      const j = await api(`/api/files/${bucket}`);
      const items = (Array.isArray(j.cached) && j.cached.length)
        ? j.cached
        : (Array.isArray(j.files) ? j.files.map(name => ({ name, original: name, bucket, url: null })) : []);

      log(`Listed ${items.length} file(s) in ${bucket}/.`);
      for (const item of items) {
        const displayName = item.name || item.original;
        const originalName = item.original || displayName;
        const col = document.createElement('div'); col.className = 'col';
        const card = document.createElement('div'); card.className = 'thumb';
        const img = document.createElement('img'); img.alt = displayName || originalName || 'image'; img.loading = 'lazy';

        let hasImage = false;
        if (item.url) {
          img.src = item.url;
          hasImage = true;
        } else if (originalName) {
          try{
            const r = await fetch(`/image_gen/api/files/${bucket}/${encodeURIComponent(originalName)}`);
            if (r.ok) {
              const blob = await r.blob();
              const objUrl = URL.createObjectURL(blob);
              img.src = objUrl;
              hasImage = true;
              img.addEventListener('load', () => { try { URL.revokeObjectURL(objUrl); } catch {} }, { once: true });
            } else {
              img.remove();
            }
          }catch{ img.remove(); }
        } else {
          img.remove();
        }

        if (hasImage) card.appendChild(img);

        const cap = document.createElement('div'); cap.className='muted mt-1'; cap.textContent = `${bucket}/ ${displayName || originalName || '(unknown)'}`;
        card.appendChild(cap);

        if (bucket === 'input' && (displayName || originalName)) {
          const useName = displayName || originalName;
          const btn = document.createElement('button'); btn.className='btn btn-sm btn-outline-primary mt-2'; btn.textContent='Use for img2img';
          btn.addEventListener('click', ()=>{
            const i=$('#inp_image');
            if(i){
              i.value=useName;
              log(`Selected ${useName} for img2img.`);
            }
          });
          card.appendChild(btn);
        }
        if (bucket === 'output' && (displayName || originalName)) {
          const useName = displayName || originalName;
          const btn = document.createElement('button');
          btn.className = 'btn btn-sm btn-outline-success mt-2';
          btn.textContent = 'Use for img2img';
          btn.addEventListener('click', async () => {
            try{
              btn.disabled = true;
              const resp = await api('/api/files/promote', {
                method: 'POST',
                body: JSON.stringify({ bucket: 'output', filename: originalName || useName })
              });
              const newName = resp.filename || useName;
              const inputCtl = $('#inp_image');
              if (inputCtl) inputCtl.value = newName;
              log(`Copied ${useName} to input as ${newName}.`, 'text-success');
            }catch(err){
              log('Promote failed: ' + err.message, 'text-danger');
            }finally{
              btn.disabled = false;
            }
          });
          card.appendChild(btn);
        }
        col.appendChild(card); area.appendChild(col);
      }
    }catch(e){
      log('List failed: ' + e.message, 'text-danger');
    }
  }

  // Prompt Library Modal
  const modalEl = $('#promptModal');
  let bsModal = null;
  function openPromptLib(type='positive'){
    if (!bsModal) bsModal = new bootstrap.Modal(modalEl);
    // set tabs visual
    $('#tabPos').classList.toggle('active', type==='positive');
    $('#tabNeg').classList.toggle('active', type==='negative');
    modalEl.dataset.type = type;
    $('#libShowAll').checked = false; // default filtered view
    loadPromptList();
    bsModal.show();
  }
  async function loadPromptList(){
    const type = modalEl.dataset.type || 'positive';
    const wfKey = $('#wfSelect').value;
    const show = $('#libShowAll').checked ? 'all' : 'default';
    const list = $('#promptList');
    list.innerHTML = '<div class="text-muted">Loading…</div>';
    try{
      const j = await api(`/api/prompts?workflow=${encodeURIComponent(wfKey)}&type=${encodeURIComponent(type)}&show=${show}`);
      const items = j.items || [];
      if (!items.length) {
        list.innerHTML = '<div class="text-muted">No prompts yet.</div>';
        return;
      }
      list.innerHTML = '';
      for (const it of items) {
        const li = document.createElement('div');
        li.className = 'list-group-item';
        li.innerHTML = `
          <div class="d-flex justify-content-between align-items-start">
            <div class="me-3" style="white-space:pre-wrap">${escapeHtml(it.prompt)}</div>
            <div class="text-end" style="min-width:140px">
              <div><span class="badge bg-primary-subtle text-primary">avg ${(it.average||0).toFixed(2)}</span></div>
              <div class="text-muted small">uses ${it.uses} • rated ${it.rating_count}</div>
              <button type="button" class="btn btn-sm btn-outline-success mt-2" data-insert="1">Use</button>
            </div>
          </div>`;
        li.querySelector('[data-insert]').addEventListener('click', ()=>{
          if (type === 'positive') {
            const p = $('#inp_prompt'); if (p) p.value = it.prompt;
          } else {
            const n = $('#inp_negative'); if (n) n.value = it.prompt;
          }
          log('Inserted prompt from library.');
          // keep modal open so you can insert both if you want
        });
        list.appendChild(li);
      }
    }catch(e){
      list.innerHTML = `<div class="text-danger">Failed to load: ${e.message}</div>`;
    }
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  $('#btnPromptLib').addEventListener('click', ()=> openPromptLib('positive'));
  $('#tabPos').addEventListener('click', ()=> { openPromptLib('positive'); });
  $('#tabNeg').addEventListener('click', ()=> { openPromptLib('negative'); });
  $('#libShowAll').addEventListener('change', loadPromptList);

  // Auto-load
  loadWorkflows();
})();
