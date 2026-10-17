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
    let enabled = false;
    let mediaEnabled = false;
    let submitting = false;
    const conversationId = () => document.getElementById('id')?.textContent.trim() || '';
    const outputFormat = () => document.getElementById('outputFormat')?.value || document.getElementById('id')?.dataset.outputFormat || 'text';
    function ineligible(settings) {
      if (!enabled) return 'Local batch submissions are disabled by the operator.';
      if (!/^[a-f\d]{24}$/i.test(conversationId())) return 'Save this conversation before batching.';
      if (document.getElementById('id')?.dataset.source !== 'conversation5') return 'Shared templates cannot be batched.';
      if (!(window.chatModels || []).some(model => model.api_model === settings.model && model.provider === 'Local')) return 'Select a Local model for local batching.';
      if (settings.tools.length) return 'Local batching does not support tools.';
      if (settings.reasoning !== 'none' || settings.mode !== 'standard' || settings.verbosity !== 'medium' || outputFormat() !== 'text') return 'Use reasoning none, standard mode, medium verbosity and text output.';
      if (window.chat5UploadBarrier?.pending) return 'Wait for all image uploads to be acknowledged.';
      if (window.chat5UploadBarrier?.failed) return 'Retry the failed or uncertain image upload before batching.';
      if (document.getElementById('fileInput')?.files?.length) return mediaEnabled ? 'Wait for image upload acknowledgement.' : 'Local batching does not support attached files.';
      return '';
    }
    function eligible(showReason = true) {
      const reason = ineligible(collectChatSettings());
      button.disabled = submitting || Boolean(reason);
      if (showReason) status.textContent = reason;
    }
    button.disabled = true;
    window.addEventListener('chat5-upload-state', () => eligible());
    window.addEventListener('load', () => {
      window.localAiBatch.load().then(config => {
        enabled = config.enabled === true; mediaEnabled = config.mediaEnabled === true;
        document.querySelectorAll('select, input').forEach(input => input.addEventListener('change', () => eligible()));
        eligible();
      }).catch(error => { status.textContent = error.message; });
    });
    button.addEventListener('click', async () => {
      if (submitting) return;
      submitting = true;
      button.disabled = true;
      try {
        const settings = collectChatSettings();
        const reason = ineligible(settings);
        if (reason) throw new Error(reason);
        const job = await window.localAiBatch.submit({ type: 'chat5.response', conversation_id: conversationId(),
          prompt: window.editor.getMarkdown(), settings: { model: settings.model, contextPrompt: settings.context,
            maxMessages: settings.maxMessages, tools: settings.tools, reasoning: settings.reasoning,
            mode: settings.mode, verbosity: settings.verbosity, outputFormat: outputFormat() } });
        showJob(job);
      } catch (error) { status.textContent = error.message; }
      finally { submitting = false; eligible(false); }
    });
  }
  const panel = document.getElementById('localAiScheduler');
  if (panel) {
    const state = document.getElementById('localAiSchedulerState');
    let csrf;
    let startKey;
    async function refresh() {
      try {
        const conf = await fetch('/local-ai/api/v1/config');
        if (!conf.ok) throw new Error('Local queue access unavailable.');
        csrf = (await conf.json()).csrfToken;
        const response = await fetch('/local-ai/api/v1/scheduler');
        if (!response.ok) throw new Error('Scheduler management permission required.');
        const data = await response.json();
        state.textContent = JSON.stringify(data, null, 2);
        const summary = document.getElementById('localAiSessionSummary');
        if (summary) {
          const session = data.session;
          const phase = session?.state === 'held' ? (data.run ? 'GPU reserved — running cohort' : 'GPU reserved — between cohorts') : ['closing', 'stopping', 'release_failed'].includes(session?.state) ? `Release pending (${session.state})` : session?.state?.replace(/_/g, ' ');
          summary.textContent = session ? `${phase}. Deadline ${session.deadline || 'pending'}; lease ${session.lease_deadline || 'pending'}; cohort ${session.cohort || 0}. Queued ${data.counts?.queued || 0}, eligible ${data.counts?.remaining_eligible || 0}, staging ${(data.counts?.claimed || 0) + (data.counts?.exporting || 0) + (data.counts?.intakes || 0)}, blocked ${data.counts?.blocked || 0}, collecting ${data.counts?.collecting || 0}. ${session.reason || ''}${session.next_attempt_at ? ` Retry ${session.retry_stage}: ${session.next_attempt_at}` : ''}` : `No active session. ${data.reason || ''}`;
        }
      } catch (error) { state.textContent = error.message; }
    }
    panel.querySelectorAll('[data-batch-control]').forEach(control => control.addEventListener('click', async () => {
      control.disabled = true;
      if (control.dataset.batchControl === 'start' && !startKey) startKey = crypto.randomUUID();
      try {
        const response = await fetch(`/local-ai/api/v1/scheduler/${control.dataset.batchControl}`, { method: 'POST', headers: { 'X-CSRF-Token': csrf, Accept: 'application/json', ...(control.dataset.batchControl === 'start' ? { 'Idempotency-Key': startKey } : {}) } });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.code || 'Request failed');
        if (control.dataset.batchControl === 'start') startKey = null;
        await refresh();
      } catch (error) { state.textContent = error.message; }
      finally { control.disabled = false; }
    }));
    refresh(); setInterval(refresh, 15000);
  }
})();
