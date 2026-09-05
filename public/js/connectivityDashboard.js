(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const names = { ok: 'OK', slow: 'Slow success', http_error: 'HTTP error', contract_error: 'Contract error',
    timeout: 'Timeout', connection_error: 'Connection/DNS error', unknown: 'Unknown' };
  const severity = ['unknown', 'ok', 'slow', 'http_error', 'contract_error', 'connection_error', 'timeout'];
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatTime = (value) => value ? new Date(value).toLocaleString(undefined, { timeZoneName: 'short' }) : 'No observation';
  const ms = (value) => value == null ? '—' : `${Math.round(value * 100) / 100} ms`;
  const pct = (value) => value == null ? '—' : `${value.toFixed(1)}%`;
  let data;
  let page = 0;
  let generation = 0;
  let controller;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function table(id, headers, rows, empty) {
    const root = $(id);
    root.replaceChildren();
    if (!rows.length) { root.append(element('p', empty)); return; }
    const node = element('table');
    const head = element('tr');
    headers.forEach((label) => { const th = element('th', label); th.scope = 'col'; head.append(th); });
    const thead = element('thead'); thead.append(head); node.append(thead);
    const body = element('tbody');
    rows.forEach((cells) => {
      const row = element('tr');
      cells.forEach((value) => { const td = element('td'); td.append(value instanceof Node ? value : document.createTextNode(String(value))); row.append(td); });
      body.append(row);
    });
    node.append(body); root.append(node);
  }
  function stateNode(state) { return element('span', names[state] || state, `connectivity-state state-${state}`); }
  function svgNode(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }
  function charts() {
    $('timeline-legend').replaceChildren(...Object.entries(names).map(([state, label]) => element('span', label, `state-${state}`)));
    const svg = svgNode('svg', { viewBox: '0 0 1120 255', role: 'group', 'aria-label': 'Aligned probe observations; each row has keyboard selectable time cells' });
    const latency = svgNode('svg', { viewBox: '0 0 1120 405', role: 'img', 'aria-label': 'Per-probe successful latency charts; exact p50 and p95 values also appear in probe cards' });
    const width = 950 / data.bins.length;
    data.probes.forEach((probe, row) => {
      svg.append(svgNode('text', { x: 5, y: row * 42 + 30 }, probe.label));
      latency.append(svgNode('text', { x: 5, y: row * 72 + 25 }, probe.label));
      const max = Math.max(1, ...data.bins.map((bin) => bin.probes[probe.name]?.p95Ms || 0));
      latency.append(svgNode('text', { x: 5, y: row * 72 + 44 }, `0–${Math.ceil(max)} ms`));
      latency.append(svgNode('line', { x1: 160, x2: 1110, y1: row * 72 + 64, y2: row * 72 + 64 }));
      let path = '';
      let connected = false;
      data.bins.forEach((bin, index) => {
        const item = bin.probes[probe.name];
        const state = severity.filter((key) => item?.counts[key]).at(-1) || 'unknown';
        const label = `${probe.label}, ${formatTime(bin.start)} to ${formatTime(bin.end)}: ${item ? Object.entries(item.counts).map(([key, count]) => `${names[key]} ${count}`).join(', ') : 'no observation'}; configurations ${bin.configIds.join(', ') || 'none'}`;
        const rect = svgNode('rect', { x: 160 + index * width, y: row * 42 + 12, width: Math.max(.5, width - .5), height: 26,
          class: `state-${state}`, role: 'button', tabindex: index === 0 ? 0 : -1, 'aria-label': label });
        rect.append(svgNode('title', {}, label));
        const select = () => { $('timeline-selection').textContent = label; };
        rect.addEventListener('click', select);
        rect.addEventListener('keydown', (event) => {
          if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); }
          const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (offset) {
            event.preventDefault();
            const cells = svg.querySelectorAll(`[data-row="${row}"]`);
            const next = cells[Math.max(0, Math.min(cells.length - 1, index + offset))];
            rect.setAttribute('tabindex', '-1'); next.setAttribute('tabindex', '0'); next.focus();
          }
        });
        rect.setAttribute('data-row', row); svg.append(rect);
        const value = item?.p95Ms;
        if (value == null) { connected = false; return; }
        const x = 160 + (index + .5) * width;
        const y = row * 72 + 64 - value / max * 50;
        path += `${connected ? 'L' : 'M'}${x},${y} `;
        connected = true;
        const point = svgNode('circle', { cx: x, cy: y, r: 1.8 });
        point.append(svgNode('title', {}, `${probe.label}: ${ms(value)} p95 at ${formatTime(bin.start)}`));
        latency.append(point);
      });
      latency.append(svgNode('path', { d: path }));
    });
    [svg, latency].forEach((node, index) => {
      const y = index ? 395 : 245;
      node.append(svgNode('text', { x: 160, y }, formatTime(data.since)));
      node.append(svgNode('text', { x: 1110, y, 'text-anchor': 'end' }, formatTime(data.until)));
    });
    $('timeline').replaceChildren(svg); $('latency-chart').replaceChildren(latency);
  }
  function history() {
    const slice = data.samples.slice(page * 30, (page + 1) * 30);
    $('history-caption').textContent = `${data.samples.length ? page * 30 + 1 : 0}–${Math.min((page + 1) * 30, data.samples.length)} of ${data.samples.length} detailed rounds${data.detailsTruncated ? ` (newest ${data.detailLimit} of ${data.sampleCount}; charts and statistics cover all included rounds)` : ''}. Times use ${zone}. Expand a result for cumulative phase timings and safe error codes.`;
    $('history-raw-older').hidden = !data.detailsTruncated;
    if (data.detailsTruncated) $('history-raw-older').href = `/admin/connectivity/api?before=${encodeURIComponent(data.samples.at(-1).sampledAt)}`;
    $('history-previous').disabled = page === 0;
    $('history-next').disabled = (page + 1) * 30 >= data.samples.length;
    table('history', ['Sample / run', ...data.probes.map((probe) => probe.label)], slice.map((sample) => {
      const meta = element('div', formatTime(sample.sampledAt));
      meta.append(element('small', `${sample.configId} · monitor ${sample.monitorVersion} · alert ${sample.notification}`));
      const details = element('details'); details.append(element('summary', 'Run timing'));
      details.append(element('small', `Scheduled ${formatTime(sample.scheduledAt)}; start ${formatTime(sample.startedAt)}; end ${formatTime(sample.endedAt)}; run ${ms(sample.runDurationMs)}; lateness ${ms(sample.schedulerLatenessMs)}; process started ${formatTime(sample.processStartedAt)}; process ${sample.processId || 'legacy'}; run ${sample.runId || 'legacy'}`));
      meta.append(details);
      return [meta, ...data.probes.map(({ name }) => {
        const probe = sample.probes.find((item) => item.name === name);
        if (!probe) return 'No observation';
        const detail = element('details'); const summary = element('summary'); summary.append(stateNode(probe.state)); detail.append(summary);
        detail.append(element('small', `${probe.outcome}; HTTP ${probe.statusCode || '—'}; elapsed ${ms(probe.latencyMs)}; phase ${probe.failurePhase || '—'}; code ${probe.errorCode || '—'}`));
        detail.append(element('small', `DNS ${ms(probe.timings.dnsMs)} / TCP ${ms(probe.timings.tcpMs)} / TLS ${ms(probe.timings.tlsMs)} / first byte ${ms(probe.timings.ttfbMs)} / total ${ms(probe.timings.totalMs)}`));
        return detail;
      })];
    }), 'No stored observations in this window. Check whether the collector is enabled, MongoDB is writable, and retention covers this range.');
  }
  function render() {
    $('connectivity-results').hidden = false;
    $('timeline-selection').textContent = 'Select a timeline cell to inspect its counts. A detailed history table is below.';
    $('recent-status').textContent = data.status === 'ok' ? 'OK' : data.status === 'degraded' ? 'Degraded' : 'Unknown';
    $('latest-at').textContent = `${data.enabled ? 'Latest stored round' : 'Collector disabled'} · ${formatTime(data.latestAt)}`;
    $('coverage-value').textContent = `${data.sampleCount} rounds · ${pct(data.coverage.percent)}`;
    $('coverage-detail').textContent = `${data.coverage.occupiedSlots} of ${data.coverage.expectedRounds} expected time slots contain a round at the current ${data.intervalMs / 60000}-minute cadence. This is sample coverage, not uptime.`;
    const n = data.notifications;
    $('alert-value').textContent = `${(n.attempted || 0) + (n.sent || 0) + (n.failed || 0)} attempts`;
    $('alert-detail').textContent = `${n.sent || 0} sent · ${n.failed || 0} failed · ${n.attempted || 0} unknown delivery · ${n.deferred || 0} deferred rounds`;
    $('config-note').textContent = `Monitor ${data.monitorVersion}. Slow ≥ ${data.slowMs} ms; external deadline ${data.timeoutMs} ms; sustained alert ${data.sustainedMs / 60000} min; cooldown ${data.cooldownMs / 60000} min; retention ${data.retentionDays} days. ${data.configurations.map((c) => `${c.id}: ${c.current ? 'current' : 'historical'} v${c.monitorVersion}, cadence ${c.intervalMs == null ? 'unknown' : c.intervalMs / 60000 + ' min'}`).join('; ')}. Historical HEAD Cloudflare errors are retained, not reclassified. ${data.coverage.cadenceChanged ? 'Historical or unknown cadence: coverage uses current cadence as an estimate.' : ''} ${data.truncated ? 'Query limit reached: only the newest 5,000 rounds are represented; coverage and counts are incomplete.' : ''} ${data.coverage.percent < 90 ? 'Limited coverage: these samples cannot support reliable daily attribution.' : ''}`;
    $('timeline-range').textContent = `${formatTime(data.since)} – ${formatTime(data.until)} · browser timezone ${zone}`;
    $('performance-link').href = `/admin/performance?range=${$('connectivity-window').value}`;
    $('probe-cards').replaceChildren(...data.probes.map((probe) => {
      const card = element('article', null, 'connectivity-card');
      card.append(element('h3', probe.label));
      card.append(stateNode(probe.configured ? probe.latest : 'unknown'));
      card.append(element('p', probe.configured ? probe.scope === 'local' ? 'Local diagnostic · no internet alerts' : 'External observation' : 'Not configured; historical data may remain'));
      const dl = element('dl');
      const pairs = [['Observed / missing rounds', `${probe.observed} / ${probe.missingInStoredRounds}`],
        ['Sampled success', `${pct(probe.sampledSuccessPercent)} (${probe.successCount}/${probe.observed})`],
        ['HTTP responses received', probe.scope === 'local' && probe.name === 'database' ? 'Not HTTP' : probe.httpReachable],
        ['Success p50 / p95', `${ms(probe.p50Ms)} / ${ms(probe.p95Ms)}`], ['Latency samples', probe.latencyObservations],
        ...Object.entries(names).map(([key, label]) => [label, probe.counts[key] || 0])];
      pairs.forEach(([key, value]) => dl.append(element('dt', key), element('dd', String(value))));
      card.append(dl);
      if (probe.codes.length) card.append(element('p', probe.codes.map(({ code, count }) => `${code}: ${count}`).join(' · ')));
      return card;
    }));
    charts();
    table('incidents', ['Probe / config', 'First observed', 'Last observed', 'Observed span / samples', 'States / end boundary'],
      data.incidents.map((item) => [`${item.probe} · ${item.configId}`, formatTime(item.start), formatTime(item.end),
        `${((new Date(item.end) - new Date(item.start)) / 60000).toFixed(1)} min · ${item.observations}`, `${item.states.map((s) => names[s]).join(', ')} · ${item.endReason}`]),
      'No degraded stretches in the stored observations. This does not establish health during gaps.');
    if (data.incidentCount > data.incidents.length) $('incidents').prepend(element('p', `Showing newest ${data.incidents.length} of ${data.incidentCount} stretches.`));
    table('gaps', ['From', 'To', 'Span without intermediate samples', 'Boundary'],
      data.gaps.map((gap) => [formatTime(gap.start), formatTime(gap.end), `${(gap.durationMs / 60000).toFixed(1)} min`, gap.boundary]), 'No gaps over 1.5 intervals detected in this window.');
    if (data.gapCount > data.gaps.length) $('gaps').prepend(element('p', `Showing newest ${data.gaps.length} of ${data.gapCount} gaps.`));
    table('alerts', ['Round', 'Status', 'Last persisted attempt'], data.alertAttempts.map((sample) => [formatTime(sample.sampledAt), sample.notification, formatTime(sample.lastAttemptAt)]),
      'No alert activity recorded in this window.');
    const activityCount = (n.attempted || 0) + (n.sent || 0) + (n.failed || 0) + (n.deferred || 0);
    if (activityCount > data.alertAttempts.length) $('alerts').prepend(element('p', `Showing newest ${data.alertAttempts.length} of ${activityCount} alert activity rounds.`));
    history();
  }
  async function refresh() {
    const requestGeneration = ++generation;
    controller?.abort(); controller = new AbortController();
    const requestController = controller;
    const timer = setTimeout(() => requestController.abort(), 15000);
    $('connectivity-message').textContent = 'Loading stored observations…';
    $('connectivity-results').setAttribute('aria-busy', 'true');
    $('connectivity-refresh').disabled = true;
    try {
      const response = await fetch(`/admin/connectivity/analytics?hours=${$('connectivity-window').value}`, { signal: requestController.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Access denied or session expired. Sign in with connectivity read access.' : 'Connectivity history is unavailable. Refresh to retry.');
      const next = await response.json();
      if (requestGeneration !== generation) return;
      data = next; page = 0; render();
      $('connectivity-message').textContent = `Updated ${formatTime(data.until)}. Refresh reads stored data; probes run on their own schedule.`;
    } catch (error) {
      if (requestGeneration !== generation) return;
      $('connectivity-message').textContent = `${error.name === 'AbortError' ? 'Loading timed out. Refresh to retry.' : error.message} ${data ? 'Previous results remain displayed; they have not been refreshed.' : ''}`;
    } finally {
      clearTimeout(timer);
      if (requestGeneration === generation) {
        $('connectivity-refresh').disabled = false;
        $('connectivity-results').setAttribute('aria-busy', 'false');
      }
    }
  }
  $('connectivity-refresh').addEventListener('click', refresh);
  $('connectivity-window').addEventListener('change', refresh);
  $('history-previous').addEventListener('click', () => { page -= 1; history(); });
  $('history-next').addEventListener('click', () => { page += 1; history(); });
  refresh();
})();
