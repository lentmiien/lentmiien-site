'use strict';
window.localAiBatch = (() => {
  let config;
  const pending = new Map();
  async function load() {
    const response = await fetch('/local-ai/api/v1/config', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Local batching requires local_ai.jobs.use permission.');
    config = await response.json();
    return config;
  }
  async function submit(body) {
    if (!config) await load();
    const serialized = JSON.stringify(body);
    // Retain the same frozen request and key after an ambiguous response, including page reloads.
    const storageKey = 'local-ai-pending-submission';
    let record;
    try { record = JSON.parse(sessionStorage.getItem(storageKey)); } catch (_) { /* no saved request */ }
    if (record && record.ownerId !== config.ownerId) throw new Error('Recover the pending submission using its original account.');
    if (!record && !config.enabled) throw new Error('Local batch submissions are disabled by the operator.');
    if (record && record.serialized !== serialized) throw new Error('A prior submission has an uncertain response. Retry that frozen submission using the recovery link below before submitting changed inputs.');
    if (!record) { record = { ownerId: config.ownerId, key: crypto.randomUUID(), serialized }; sessionStorage.setItem(storageKey, JSON.stringify(record)); }
    pending.set(record.key, record);
    const response = await fetch('/local-ai/api/v1/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': config.csrfToken, 'Idempotency-Key': record.key }, body: record.serialized });
    const result = await response.json();
    if (!response.ok) {
      if (response.status < 500) sessionStorage.removeItem(storageKey);
      const error = new Error(result.error?.code || 'Submission response uncertain; retry the same request.');
      error.definitive = response.status < 500;
      throw error;
    }
    sessionStorage.removeItem(storageKey); pending.delete(record.key);
    return result;
  }
  async function retryPending() {
    const record = JSON.parse(sessionStorage.getItem('local-ai-pending-submission') || 'null');
    if (!record) throw new Error('No uncertain submission in this tab.');
    return submit(JSON.parse(record.serialized));
  }
  return { load, submit, retryPending };
})();
