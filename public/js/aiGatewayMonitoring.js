(() => {
  'use strict';
  const status = document.getElementById('serviceMonitoringStatus');
  const cards = document.getElementById('serviceMonitoringCards');
  const context = document.getElementById('serviceMonitoringContext');
  const refresh = document.getElementById('refreshServiceMonitoring');
  if (!status || !cards || !context || !refresh) return;
  let snapshot;
  let busy = false;
  let stopped = false;
  let controller;
  const addText = (parent, tag, text, className) => {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
  };
  const unavailable = message => {
    status.textContent = message;
    status.className = 'monitoring-warning';
    cards.replaceChildren();
    context.replaceChildren();
  };
  const render = data => {
    const age = Date.now() - Date.parse(data?.fetchedAt);
    if (!Number.isFinite(age) || age > 60000 || !Array.isArray(data?.services) || !Array.isArray(data?.sources) || !Array.isArray(data?.context)) {
      snapshot = null;
      unavailable('Monitoring stale or invalid — current service availability unknown. Refresh to retry.');
      return;
    }
    snapshot = data;
    status.className = data.complete && data.status === 'Gateway reports healthy' ? '' : 'monitoring-warning';
    status.textContent = `${data.status}. Observed: ${new Date(data.fetchedAt).toLocaleString()}. ${data.complete ? '' : 'Partial monitoring — unavailable sources: ' + data.sources.filter(source => !source.available).map(source => source.key).join(', ') + '.'}`;
    context.replaceChildren();
    data.context.forEach(line => addText(context, 'p', line));
    cards.replaceChildren();
    data.services.forEach(service => {
      const card = addText(cards, 'article', '', `health-card monitoring-card--${['normal', 'failure', 'unknown'].includes(service.tone) ? service.tone : 'unknown'}`);
      addText(card, 'h3', service.id, 'health-card__title');
      addText(card, 'strong', service.availability);
      addText(card, 'p', `Container: ${service.state} · Model: ${service.model}`);
      addText(card, 'p', `GPU ownership: ${service.owner}`);
      addText(card, 'p', service.policy, 'health-card__meta');
      (service.evidence || []).forEach(line => addText(card, 'p', line, 'health-card__meta'));
      const link = addText(card, 'a', 'Recovery / interpretation');
      link.addEventListener('click', () => { document.querySelector('.gateway-runbook').open = true; });
      link.href = '#recovery-' + (['voicevox', 'idle', 'cpu', 'probe', 'missing', 'monitoring', 'queue', 'preparation'].includes(service.guidance) ? service.guidance : 'monitoring');
    });
    if (!data.services.length) addText(cards, 'p', 'No usable service catalog. Service availability is unknown.');
  };
  const load = async () => {
    if (busy || stopped || document.hidden) return;
    busy = true;
    refresh.disabled = true;
    controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch('/admin/ai-gateway/monitoring', { cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error('Monitoring request failed');
      const data = await response.json();
      if (!stopped) render(data);
    } catch (_) {
      snapshot = null;
      if (!stopped) unavailable('Monitoring unavailable — current service availability unknown. Last refresh failed; retrying while visible.');
    } finally {
      window.clearTimeout(timeout);
      busy = false;
      refresh.disabled = false;
    }
  };
  try { render(JSON.parse(document.getElementById('aiGatewayMonitoringData')?.textContent || 'null')); }
  catch (_) { unavailable('Monitoring unavailable — refresh to retry.'); }
  refresh.addEventListener('click', load);
  const expire = () => {
    if (snapshot && Date.now() - Date.parse(snapshot.fetchedAt) > 60000) {
      snapshot = null;
      unavailable('Monitoring stale — current service availability unknown. Refresh to retry.');
    }
  };
  let poll = window.setInterval(load, 30000);
  let expiry = window.setInterval(expire, 1000);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    stopped = false;
    expire();
    poll = window.setInterval(load, 30000);
    expiry = window.setInterval(expire, 1000);
    load();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  window.addEventListener('pagehide', () => {
    stopped = true;
    controller?.abort();
    window.clearInterval(poll);
    window.clearInterval(expiry);
  });
  document.querySelectorAll('[data-copy-command]').forEach(button => {
    button.addEventListener('click', async () => {
      const feedback = document.getElementById('monitoringCopyFeedback');
      try {
        await navigator.clipboard.writeText(document.getElementById(button.dataset.copyCommand).textContent.trim());
        feedback.textContent = 'Commands copied. Review before running on the Gateway host.';
      } catch (_) {
        feedback.textContent = 'Clipboard unavailable. Select and copy the command text above.';
      }
    });
  });
})();
