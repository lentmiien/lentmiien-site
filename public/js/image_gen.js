// public/js/image_gen.js
(function(){
  const $ = (s, r=document)=>r.querySelector(s);
  const logEl = $('#log');
  const statusPill = $('#statusPill');

  let workflows = [];
  let wfMap = new Map();

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
    try{
      const j = await api('/api/health');
      const dot = $('#healthDot');
      dot.textContent = j.ok ? 'ok' : 'error';
      dot.className = `badge ${j.ok ? 'bg-success' : 'bg-danger'}`;
      log('Health ok.');
    }catch(e){
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

  // Example prompts
  const EXAMPLES = [
    'A vibrant, warm neon-lit street in Hong Kong, cinematic, volumetric haze, high detail.',
    'Ancient library with floating candles, golden beams, dust motes, fantasy matte painting.',
    'Cyberpunk alley in rain, colorful reflections, fog, sharp focus, ultra-detailed.',
    'Snowy mountain temple above the clouds at sunrise, serene, dramatic god-rays.',
    'Retro-futuristic city park at dusk, pastel sky, isometric style, soft lighting.'
  ];
  $('#btnExample1').addEventListener('click', ()=>{
    const def = wfMap.get($('#wfSelect').value);
    if(!def) return;
    const promptCtl = $('#inp_prompt');
    if (promptCtl) {
      promptCtl.value = EXAMPLES[Math.floor(Math.random()*EXAMPLES.length)];
      log('Inserted example prompt.');
    }
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
    try{
      const resp = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ workflow: $('#wfSelect').value, inputs })
      });
      $('#jobId').value = resp.job_id;
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
    for (let i=0;i<300;i++){ // up to ~10 minutes @2s
      try{
        const j = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
        $('#jobStatus').textContent = j.status;
        if (j.status === 'completed') {
          setStatus('completed');
          log(`Completed with ${j.files.length} image(s).`, 'text-success');
          await showResults(jobId, j.files);
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
      const url = `/image_gen/api/jobs/${encodeURIComponent(jobId)}/images/${i}`;
      try{
        const resp = await fetch(url);
        if (!resp.ok) {
          const msg = await resp.text().catch(()=> '');
          throw new Error(`Image fetch ${resp.status}: ${msg.slice(0,200)}`);
        }
        const blob = await resp.blob();
        const objUrl = URL.createObjectURL(blob);
        const col = document.createElement('div'); col.className = 'col';
        const card = document.createElement('div'); card.className = 'thumb';
        const img = document.createElement('img'); img.src = objUrl; img.alt = files[i].filename;
        const caption = document.createElement('div'); caption.className = 'muted mt-1'; caption.textContent = files[i].filename;
        const dl = document.createElement('a'); dl.href = objUrl; dl.download = files[i].filename; dl.textContent = 'Download';
        card.appendChild(img); card.appendChild(caption); card.appendChild(dl);
        col.appendChild(card); wrap.appendChild(col);
      }catch(e){
        log('Render image failed: ' + e.message, 'text-danger');
      }
    }
  }

  // Upload
  $('#btnUpload').addEventListener('click', async ()=>{
    const f = $('#fileUp').files[0];
    if(!f){ log('Choose a file first.', 'text-warning'); return; }
    const fd = new FormData(); fd.append('image', f, f.name);
    try{
      const r = await api('/api/files/input', { method:'POST', body: fd });
      $('#lastUpload').textContent = `Uploaded as ${r.filename || r.file || '(see ComfyUI response)'}`;
      log(`Uploaded ${f.name}${r.filename ? ' -> ' + r.filename : ''}`, 'text-success');
      const imageCtl = $('#inp_image'); if (imageCtl && r.filename) imageCtl.value = r.filename;
    }catch(e){
      log('Upload failed: ' + e.message, 'text-danger');
    }
  });

  // Browse
  $('#btnListInput').addEventListener('click', ()=> list('input'));
  $('#btnListOutput').addEventListener('click', ()=> list('output'));

  async function list(bucket){
    const area = $('#browseArea'); area.innerHTML = '';
    try{
      const j = await api(`/api/files/${bucket}`);
      log(`Listed ${j.files.length} file(s) in ${bucket}/.`);
      for (const name of j.files) {
        const col = document.createElement('div'); col.className = 'col';
        const card = document.createElement('div'); card.className = 'thumb';
        const img = document.createElement('img'); img.alt = name;
        try{
          const blob = await fetch(`/image_gen/api/files/${bucket}/${encodeURIComponent(name)}`).then(r=>r.blob());
          img.src = URL.createObjectURL(blob);
        }catch{ img.remove(); }
        const cap = document.createElement('div'); cap.className='muted mt-1'; cap.textContent = `${bucket}/ ${name}`;
        card.appendChild(img); card.appendChild(cap);
        if (bucket === 'input') {
          const btn = document.createElement('button'); btn.className='btn btn-sm btn-outline-primary mt-2'; btn.textContent='Use for img2img';
          btn.addEventListener('click', ()=>{ const i=$('#inp_image'); if(i){ i.value=name; log(`Selected ${name} for img2img.`);} });
          card.appendChild(btn);
        }
        col.appendChild(card); area.appendChild(col);
      }
    }catch(e){
      log('List failed: ' + e.message, 'text-danger');
    }
  }

  // Auto-load
  loadWorkflows();
})();