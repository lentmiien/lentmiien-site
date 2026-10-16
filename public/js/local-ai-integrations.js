'use strict';
(() => {
  const status = document.getElementById('localAiBatchStatus');
  const button = document.getElementById('localAiChatBatch');
  const recover = document.getElementById('localAiRecover');
  function showJob(job) {
    status.textContent = 'Durably queued. ';
    const link = document.createElement('a'); link.href = job.url; link.textContent = 'View local job'; status.append(link);
  }
  recover?.addEventListener('click', async () => {
    try { showJob(await window.localAiBatch.retryPending()); } catch (error) { status.textContent = error.message; }
  });
  if (button) {
    window.addEventListener('load', () => {
      window.localAiBatch.load().then(config => {
        if (!config.enabled) throw new Error('Local batch submissions are disabled by the operator.');
        const eligible = () => {
          const settings = collectChatSettings();
          const local = (window.chatModels || []).some(model => model.api_model === settings.model && model.provider === 'Local');
          const reason = document.getElementById('id')?.value === 'NEW' ? 'Save this conversation before batching.'
            : !local ? 'Select a Local model for local batching.'
              : settings.tools.length ? 'Local batching does not support tools.'
                : settings.reasoning !== 'none' || settings.mode !== 'standard' || settings.verbosity !== 'medium' ? 'Use reasoning none, standard mode and medium verbosity.'
                  : document.getElementById('fileInput')?.files?.length ? 'Local batching does not support attached files.' : '';
          button.dataset.ineligible = '';
          button.disabled = Boolean(reason);
          status.textContent = reason;
        };
        document.querySelectorAll('select, input').forEach(input => input.addEventListener('change', eligible));
        eligible();
      }).catch(error => { status.textContent = error.message; });
    });
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const settings = collectChatSettings();
        if (document.getElementById('fileInput')?.files?.length) throw new Error('Batch does not support attached images.');
        const job = await window.localAiBatch.submit({ type: 'chat5.response', conversation_id: document.getElementById('id').value,
          prompt: window.editor.getMarkdown(), settings: { model: settings.model, contextPrompt: settings.context,
            maxMessages: settings.maxMessages, tools: settings.tools, reasoning: settings.reasoning,
            mode: settings.mode, verbosity: settings.verbosity, outputFormat: document.getElementById('outputFormat')?.value || 'text' } });
        showJob(job);
      } catch (error) { status.textContent = error.message; button.dataset.ineligible = error.definitive ? 'true' : ''; }
      finally { button.disabled = button.dataset.ineligible === 'true'; }
    });
  }
  const panel = document.getElementById('localAiScheduler');
  if (panel) {
    const state = document.getElementById('localAiSchedulerState');
    let csrf;
    async function refresh() {
      try {
        const conf = await fetch('/local-ai/api/v1/config');
        if (!conf.ok) throw new Error('Local queue access unavailable.');
        csrf = (await conf.json()).csrfToken;
        const response = await fetch('/local-ai/api/v1/scheduler');
        if (!response.ok) throw new Error('Scheduler management permission required.');
        state.textContent = JSON.stringify(await response.json(), null, 2);
      } catch (error) { state.textContent = error.message; }
    }
    panel.querySelectorAll('[data-batch-control]').forEach(control => control.addEventListener('click', async () => {
      control.disabled = true;
      try {
        const response = await fetch(`/local-ai/api/v1/scheduler/${control.dataset.batchControl}`, { method: 'POST', headers: { 'X-CSRF-Token': csrf, Accept: 'application/json' } });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.code || 'Request failed');
        await refresh();
      } catch (error) { state.textContent = error.message; }
      finally { control.disabled = false; }
    }));
    refresh(); setInterval(refresh, 15000);
  }
})();
