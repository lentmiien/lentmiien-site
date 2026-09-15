(() => {
  const catalog = JSON.parse(document.getElementById('music-catalog').textContent);
  const form = document.getElementById('music-generate-form');
  const selector = document.getElementById('music-model');
  const snapshots = new Map();
  let previous;
  function applyModel() {
    if (previous) snapshots.set(previous, Object.fromEntries(new FormData(form)));
    const model = catalog.models.find(m => m.id === selector.value);
    const yue = model?.provider === 'yue2';
    for (const [id, enabled] of [['music-yue-controls', yue], ['music-ace-controls', !yue]]) {
      const fieldset = document.getElementById(id);
      fieldset.hidden = !enabled;
      fieldset.disabled = !enabled || !model;
    }
    for (const formId of ['music-generate-form', 'music-ai-form']) document.querySelector(`#${formId} button[type=submit]`).disabled = !model?.usable;
    if (!model) return;
    const formats = yue ? model.limits.audio_format : ['flac', 'wav', 'mp3', 'wav32', 'opus', 'aac'];
    const audio = form.elements.audio_format;
    audio.replaceChildren(...formats.map(format => new Option(format.toUpperCase(), format)));
    const settings = snapshots.get(model.id) || { ...model.defaults, timeout_sec: model.execution_timeout_sec };
    for (const [name, value] of Object.entries(settings)) {
      const el = form.elements[name];
      if (!el || ['model', 'caption', 'lyrics', '_csrf'].includes(name)) continue;
      if (el.type === 'checkbox') el.checked = Boolean(value);
      else if (name !== 'seed' || /^\d+$/.test(String(value))) el.value = value ?? '';
    }
    if (!snapshots.has(model.id)) form.elements.seed.value = '';
    const caption = form.elements.caption;
    caption.maxLength = model.limits.caption_chars;
    form.elements.lyrics.maxLength = model.limits.lyrics_chars;
    form.elements.lyrics.required = yue;
    document.getElementById('caption-help').textContent = `Maximum ${model.limits.caption_chars} characters.`;
    document.getElementById('lyrics-label').textContent = yue ? 'Lyrics (required)' : 'Lyrics (optional)';
    document.getElementById('lyrics-help').textContent = `Maximum ${model.limits.lyrics_chars} characters.${yue ? ' Combined normalized caption and lyrics: 16000 UTF-8 bytes.' : ''}`;
    form.elements.timeout_sec.max = model.execution_timeout_sec;
    if (!yue) form.elements.duration.max = model.limits.duration_seconds[1];
    for (const key of yue ? ['max_duration'] : ['inference_steps', 'guidance_scale', 'batch_size']) {
      form.elements[key].min = model.limits[key][0]; form.elements[key].max = model.limits[key][1];
    }
    document.getElementById('music-model-note').textContent = `${catalog.note} Selected: ${model.id} (${model.availability}). Queue budget: ${model.queue_timeout_sec}s.`;
    document.getElementById('infinity-generator').textContent = `Background generator: ${model.id}. Uses the settings above; playback draws from the shared mixed-model library.`;
    previous = model.id;
  }
  selector.addEventListener('change', applyModel);
  applyModel();
})();
