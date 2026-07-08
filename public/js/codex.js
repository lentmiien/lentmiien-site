(function () {
  const root = document.querySelector('[data-codex-page]');
  const dataElement = document.getElementById('codex-page-data');
  if (!root || !dataElement) {
    return;
  }

  let bootstrap = {};
  try {
    bootstrap = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    console.error('Unable to parse Codex page data.', error);
    return;
  }

  const ACTIVE_TURN_STATUSES = new Set(['queued', 'running']);
  const RETRYABLE_STATUSES = new Set(['failed', 'timed_out', 'cancelled', 'blocked']);
  const TOKEN_TYPES = ['input', 'cached', 'output', 'reasoning'];
  const TOKEN_LABELS = {
    input: 'Input',
    cached: 'Cached',
    output: 'Output',
    reasoning: 'Reasoning',
  };
  let syncPageAutoRefresh = null;

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  function formatDuration(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return '-';
    if (value < 1000) return `${Math.round(value)}ms`;
    if (value < 60000) return `${Math.round(value / 1000)}s`;
    if (value < 3600000) return `${Math.round(value / 60000)}m`;
    return `${(value / 3600000).toFixed(1)}h`;
  }

  function formatNumber(value, fractionDigits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return number.toLocaleString(undefined, {
      maximumFractionDigits: fractionDigits === undefined ? 0 : fractionDigits,
    });
  }

  function formatMoney(value) {
    const number = Number(value) || 0;
    return `$${number.toFixed(4)}`;
  }

  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '-';
    return `${number.toFixed(1)}%`;
  }

  function normalizeTokens(tokens) {
    return TOKEN_TYPES.reduce((result, type) => {
      result[type] = Number(tokens && tokens[type]) || 0;
      return result;
    }, { total: Number(tokens && tokens.total) || 0 });
  }

  function statusClass(status) {
    return `codex-status codex-status--${String(status || '').replace(/_/g, '-')}`;
  }

  function isActiveTurn(turn) {
    return Boolean(turn && ACTIVE_TURN_STATUSES.has(turn.status));
  }

  function hasActiveTurns(turns) {
    return Array.isArray(turns) && turns.some(isActiveTurn);
  }

  function createEl(tag, attrs, children) {
    const element = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) {
        return;
      }
      if (key === 'className') {
        element.className = value;
      } else if (key === 'text') {
        element.textContent = value;
      } else if (key.startsWith('data-')) {
        element.setAttribute(key, value);
      } else {
        element.setAttribute(key, value);
      }
    });
    (children || []).forEach((child) => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child) {
        element.appendChild(child);
      }
    });
    return element;
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (_error) {
      return { ok: false, error: text || 'Unexpected server response.' };
    }
  }

  async function requestJson(url, options) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
      },
    });
    const payload = await readJsonResponse(response);
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || 'Request failed.');
    }
    return payload;
  }

  function setStatus(element, message, tone) {
    if (!element) return;
    element.textContent = message || '';
    if (tone) {
      element.dataset.tone = tone;
    } else {
      delete element.dataset.tone;
    }
  }

  function formToPayload(form) {
    const formData = new FormData(form);
    const payload = {};
    formData.forEach((value, key) => {
      payload[key] = value;
    });
    form.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      payload[input.name] = input.checked;
    });
    return payload;
  }

  function syncPermissionVisibility(form) {
    if (!form) return;
    const permission = form.querySelector('[name="permissionMode"]');
    const yoloConfirm = form.querySelector('.codex-yolo-confirm');
    if (!permission || !yoloConfirm) return;
    const yoloSelected = permission.value === 'yolo';
    const confirmInput = yoloConfirm.querySelector('input[type="checkbox"]');
    yoloConfirm.hidden = !yoloSelected;
    if (confirmInput) {
      confirmInput.required = yoloSelected;
      if (!yoloSelected) {
        confirmInput.checked = false;
      }
    }
  }

  function bindPermissionControls(scope) {
    scope.querySelectorAll('form').forEach((form) => {
      syncPermissionVisibility(form);
      const permission = form.querySelector('[name="permissionMode"]');
      if (permission) {
        permission.addEventListener('change', () => syncPermissionVisibility(form));
      }
    });
  }

  function clearYoloConfirmation(form) {
    if (!form) return;
    const confirmInput = form.querySelector('.codex-yolo-confirm input[type="checkbox"]');
    if (confirmInput) {
      confirmInput.checked = false;
    }
    syncPermissionVisibility(form);
  }

  function renderTurnRow(turn) {
    const row = createEl('article', { className: 'codex-job-row' });
    const main = createEl('div', { className: 'codex-job-row__main' });
    main.appendChild(createEl('span', { className: statusClass(turn.status), text: turn.status }));
    main.appendChild(createEl('a', {
      href: `/codex/turns/${encodeURIComponent(turn.id)}`,
      text: turn.workspace ? turn.workspace.name : 'Workspace',
    }));
    main.appendChild(createEl('small', {
      text: turn.status === 'running' ? `Started ${formatDate(turn.startedAt)}` : `Queued ${formatDate(turn.queuedAt)}`,
    }));
    row.appendChild(main);
    if (turn.status === 'queued' || turn.status === 'running') {
      row.appendChild(createEl('button', {
        type: 'button',
        className: 'codex-icon-button',
        'data-action': 'cancel-turn',
        'data-turn-id': turn.id,
        title: 'Cancel',
        text: 'Cancel',
      }));
    }
    return row;
  }

  function renderTurnList(container, turns, emptyText) {
    if (!container) return;
    container.innerHTML = '';
    if (!turns || turns.length === 0) {
      container.appendChild(createEl('p', { className: 'codex-empty', text: emptyText }));
      return;
    }
    turns.forEach((turn) => container.appendChild(renderTurnRow(turn)));
  }

  function renderMetricCard(label, value, helper) {
    const card = createEl('div', { className: 'codex-stat-card' });
    card.appendChild(createEl('small', { text: label }));
    card.appendChild(createEl('strong', { text: value }));
    if (helper) {
      card.appendChild(createEl('span', { text: helper }));
    }
    return card;
  }

  function renderInlineStats(title, rows) {
    const wrapper = createEl('div', { className: 'codex-mini-stat' });
    wrapper.appendChild(createEl('h3', { text: title }));
    const dl = createEl('dl', { className: 'codex-inline-stats' });
    rows.forEach(([label, value]) => {
      dl.appendChild(createEl('dt', { text: label }));
      dl.appendChild(createEl('dd', { text: value }));
    });
    wrapper.appendChild(dl);
    return wrapper;
  }

  function renderDistribution(title, distribution, emptyText) {
    const wrapper = createEl('div', { className: 'codex-mini-stat' });
    wrapper.appendChild(createEl('h3', { text: title }));
    const list = createEl('div', { className: 'codex-distribution-list' });
    if (!distribution || distribution.length === 0) {
      list.appendChild(createEl('p', { className: 'codex-empty', text: emptyText }));
    } else {
      distribution.forEach((item) => {
        const row = createEl('div');
        row.appendChild(createEl('span', { text: item.label || item.key }));
        row.appendChild(createEl('strong', {
          text: `${formatNumber(item.count)} / ${formatPercent(item.share)}`,
        }));
        list.appendChild(row);
      });
    }
    wrapper.appendChild(list);
    return wrapper;
  }

  function renderTokenStrip(tokensInput) {
    const tokens = normalizeTokens(tokensInput);
    const strip = createEl('div', { className: 'codex-token-strip' });
    TOKEN_TYPES.forEach((type) => {
      const pill = createEl('span', { className: 'codex-token-pill' });
      pill.appendChild(createEl('small', { text: TOKEN_LABELS[type] }));
      pill.appendChild(createEl('strong', { text: formatNumber(tokens[type]) }));
      strip.appendChild(pill);
    });
    return strip;
  }

  function renderDashboardStats(stats, pricing) {
    const summary = stats && stats.summary ? stats.summary : {};
    const summarySection = root.querySelector('[data-codex-stats-summary]');
    if (summarySection) {
      summarySection.innerHTML = '';
      const header = createEl('div', { className: 'codex-panel__header' });
      header.appendChild(createEl('h2', { text: 'Usage Overview' }));
      header.appendChild(createEl('span', {
        className: 'codex-chip',
        text: stats && stats.period ? stats.period.label : 'Last 3 months',
      }));
      summarySection.appendChild(header);

      const grid = createEl('div', { className: 'codex-stat-grid' });
      grid.appendChild(renderMetricCard('Turns', formatNumber(summary.turnCount), `${formatNumber(summary.sessionCount)} sessions`));
      grid.appendChild(renderMetricCard('Tokens', formatNumber(summary.tokens && summary.tokens.total), `Avg ${formatNumber(summary.averageTokensPerTurn)} / turn`));
      grid.appendChild(renderMetricCard('Estimated Cost', formatMoney(summary.cost), (pricing && pricing.currency) || 'USD'));
      grid.appendChild(renderMetricCard('Avg Time', formatDuration(summary.durationStats && summary.durationStats.avg), `Max ${formatDuration(summary.durationStats && summary.durationStats.max)}`));
      grid.appendChild(renderMetricCard('Success', formatPercent(summary.successRate), `${formatNumber(summary.successfulTurnCount)} completed`));
      grid.appendChild(renderMetricCard('Cache Share', formatPercent(summary.cacheShare), `Reasoning ${formatPercent(summary.reasoningShare)}`));
      summarySection.appendChild(grid);

      const split = createEl('div', { className: 'codex-stats-split' });
      const durationStats = summary.durationStats || {};
      split.appendChild(renderInlineStats('Completion Time', [
        ['Min', formatDuration(durationStats.min)],
        ['Avg', formatDuration(durationStats.avg)],
        ['Median', formatDuration(durationStats.median)],
        ['P95', formatDuration(durationStats.p95)],
        ['Max', formatDuration(durationStats.max)],
      ]));
      const tokenStats = summary.tokenStats || {};
      split.appendChild(renderInlineStats('Tokens / Turn', [
        ['Min', formatNumber(tokenStats.min)],
        ['Avg', formatNumber(tokenStats.avg)],
        ['Median', formatNumber(tokenStats.median)],
        ['P95', formatNumber(tokenStats.p95)],
        ['Max', formatNumber(tokenStats.max)],
      ]));
      split.appendChild(renderDistribution('Type Distribution', summary.kindDistribution, 'No turn types yet.'));
      split.appendChild(renderDistribution('Status Distribution', summary.statusDistribution, 'No statuses yet.'));
      summarySection.appendChild(split);
    }

    const monthlyBody = root.querySelector('[data-codex-monthly-body]');
    if (monthlyBody) {
      monthlyBody.innerHTML = '';
      const months = stats && Array.isArray(stats.months) ? stats.months : [];
      if (!months.length) {
        const row = createEl('tr');
        row.appendChild(createEl('td', { colspan: '8', text: 'No token usage recorded for the last 3 months.' }));
        monthlyBody.appendChild(row);
      } else {
        months.forEach((month) => {
          const row = createEl('tr');
          row.appendChild(createEl('td', { text: month.label || month.key || '-' }));
          row.appendChild(createEl('td', { text: formatNumber(month.turnCount) }));
          row.appendChild(createEl('td', { text: formatNumber(month.sessionCount) }));
          const tokens = normalizeTokens(month.tokens);
          TOKEN_TYPES.forEach((type) => row.appendChild(createEl('td', { text: formatNumber(tokens[type]) })));
          row.appendChild(createEl('td', { text: formatMoney(month.cost) }));
          monthlyBody.appendChild(row);
        });
      }
    }

    const workspaceBody = root.querySelector('[data-codex-workspace-body]');
    if (workspaceBody) {
      workspaceBody.innerHTML = '';
      const workspaces = stats && Array.isArray(stats.workspaceActivity) ? stats.workspaceActivity : [];
      if (!workspaces.length) {
        const row = createEl('tr');
        row.appendChild(createEl('td', { colspan: '10', text: 'No workspace activity recorded for the last 3 months.' }));
        workspaceBody.appendChild(row);
      } else {
        workspaces.forEach((workspace) => {
          const row = createEl('tr');
          const nameCell = createEl('td');
          nameCell.appendChild(createEl('strong', { text: workspace.workspaceName || workspace.label || 'Workspace' }));
          if (workspace.rootPath) {
            nameCell.appendChild(createEl('small', { text: workspace.rootPath }));
          }
          row.appendChild(nameCell);
          row.appendChild(createEl('td', { text: formatNumber(workspace.turnCount) }));
          row.appendChild(createEl('td', { text: formatNumber(workspace.sessionCount) }));
          const tokens = normalizeTokens(workspace.tokens);
          TOKEN_TYPES.forEach((type) => row.appendChild(createEl('td', { text: formatNumber(tokens[type]) })));
          row.appendChild(createEl('td', { text: formatDuration(workspace.avgDurationMs) }));
          row.appendChild(createEl('td', { text: formatPercent(workspace.successRate) }));
          row.appendChild(createEl('td', { text: formatMoney(workspace.cost) }));
          workspaceBody.appendChild(row);
        });
      }
    }
  }

  function renderSessionStats(stats) {
    const container = root.querySelector('[data-codex-session-stats]');
    if (!container) return;
    const current = stats || {};
    container.innerHTML = '';
    const header = createEl('div', { className: 'codex-panel__header' });
    header.appendChild(createEl('h2', { text: 'Session Totals' }));
    header.appendChild(createEl('span', { className: 'codex-chip', text: formatMoney(current.cost) }));
    container.appendChild(header);
    const grid = createEl('div', { className: 'codex-stat-grid codex-stat-grid--compact' });
    grid.appendChild(renderMetricCard('Total Time', formatDuration(current.totalDurationMs), `Elapsed ${formatDuration(current.elapsedMs)}`));
    grid.appendChild(renderMetricCard('Turns', formatNumber(current.turnCount), `${formatNumber(current.completedTurnCount)} timed`));
    const tokens = normalizeTokens(current.tokens);
    TOKEN_TYPES.forEach((type) => {
      grid.appendChild(renderMetricCard(TOKEN_LABELS[type], formatNumber(tokens[type]), 'tokens'));
    });
    container.appendChild(grid);
  }

  function renderSessionsTable(table, sessions) {
    if (!table) return;
    const tbody = table.querySelector('tbody') || table.appendChild(document.createElement('tbody'));
    tbody.innerHTML = '';
    if (!sessions || sessions.length === 0) {
      const row = createEl('tr');
      row.appendChild(createEl('td', { colspan: '4', text: 'No Codex sessions yet.' }));
      tbody.appendChild(row);
      return;
    }
    sessions.forEach((session) => {
      const row = createEl('tr');
      const titleCell = createEl('td');
      titleCell.appendChild(createEl('a', {
        href: `/codex/sessions/${encodeURIComponent(session.id)}`,
        text: session.title,
      }));
      if (session.lastResponsePreview) {
        titleCell.appendChild(createEl('small', { text: session.lastResponsePreview }));
      }
      row.appendChild(titleCell);
      row.appendChild(createEl('td', { text: session.workspace ? session.workspace.name : '-' }));
      const statusCell = createEl('td');
      statusCell.appendChild(createEl('span', { className: statusClass(session.status), text: session.status }));
      row.appendChild(statusCell);
      row.appendChild(createEl('td', { text: formatDate(session.updatedAt) }));
      tbody.appendChild(row);
    });
  }

  async function refreshDashboard() {
    const [queue, sessions, statsPayload] = await Promise.all([
      requestJson('/codex/api/queue'),
      requestJson('/codex/api/sessions?limit=12'),
      requestJson('/codex/api/stats'),
    ]);
    renderTurnList(root.querySelector('[data-codex-running-list]'), queue.runningTurns || [], 'No running requests.');
    renderTurnList(root.querySelector('[data-codex-queued-list]'), queue.queuedTurns || [], 'No queued requests.');
    renderSessionsTable(root.querySelector('[data-codex-session-table]'), sessions.sessions || []);
    renderDashboardStats(statsPayload.stats, statsPayload.pricing);
    const runningCount = root.querySelector('[data-codex-running-count]');
    const queuedCount = root.querySelector('[data-codex-queued-count]');
    const sessionCount = root.querySelector('[data-codex-session-count]');
    if (runningCount) runningCount.textContent = String((queue.runningTurns || []).length);
    if (queuedCount) queuedCount.textContent = String((queue.queuedTurns || []).length);
    if (sessionCount) sessionCount.textContent = String((sessions.sessions || []).length);
  }

  function renderTranscriptBlock(title, text, fallback, headingTag) {
    const block = createEl('div', { className: 'codex-transcript__block' });
    block.appendChild(createEl(headingTag || 'h3', { text: title }));
    if (text) {
      block.appendChild(createEl('pre', { text }));
    } else {
      block.appendChild(createEl('p', { className: 'codex-empty', text: fallback }));
    }
    return block;
  }

  function renderTurnCard(turn, workspace) {
    const card = createEl('article', { className: 'codex-turn-card', 'data-turn-id': turn.id });
    const header = createEl('div', { className: 'codex-turn-card__header' });
    const title = createEl('div');
    title.appendChild(createEl('span', { className: statusClass(turn.status), text: turn.status }));
    title.appendChild(createEl('strong', { text: `Turn ${turn.sequence}` }));
    title.appendChild(createEl('span', { text: String(turn.kind || '').replace(/_/g, ' ') }));
    header.appendChild(title);
    const actions = createEl('div', { className: 'codex-turn-card__actions' });
    actions.appendChild(createEl('a', {
      href: `/codex/turns/${encodeURIComponent(turn.id)}`,
      className: 'codex-small-link',
      text: 'Open',
    }));
    if (turn.status === 'queued' || turn.status === 'running') {
      actions.appendChild(createEl('button', {
        type: 'button',
        className: 'codex-small-button',
        'data-action': 'cancel-turn',
        'data-turn-id': turn.id,
        text: 'Cancel',
      }));
    }
    if (RETRYABLE_STATUSES.has(turn.status)) {
      actions.appendChild(createEl('button', {
        type: 'button',
        className: 'codex-small-button',
        'data-action': 'retry-turn',
        'data-turn-id': turn.id,
        text: 'Retry',
      }));
    }
    header.appendChild(actions);
    card.appendChild(header);

    const meta = createEl('div', { className: 'codex-turn-meta' });
    [
      workspace ? workspace.name : '-',
      turn.permissionMode,
      `Queued ${formatDate(turn.queuedAt)}`,
      `Duration ${formatDuration(turn.durationMs)}`,
      `Turn cost ${formatMoney(turn.costEstimate && turn.costEstimate.total)}`,
    ].forEach((text) => meta.appendChild(createEl('span', { text })));
    card.appendChild(meta);
    card.appendChild(renderTokenStrip(turn.tokenUsage));

    const transcript = createEl('div', { className: 'codex-transcript' });
    transcript.appendChild(renderTranscriptBlock('Prompt', turn.prompt, 'Prompt unavailable.'));
    if (turn.errorMessage && !turn.finalResponse) {
      transcript.appendChild(renderTranscriptBlock('Response', turn.errorMessage, 'Response pending.'));
    } else {
      transcript.appendChild(renderTranscriptBlock('Response', turn.finalResponse, 'Response pending.'));
    }
    card.appendChild(transcript);

    const eventPanel = createEl('div', { className: 'codex-event-panel' });
    eventPanel.appendChild(createEl('button', {
      type: 'button',
      className: 'codex-small-button',
      'data-action': 'toggle-events',
      'data-turn-id': turn.id,
      text: 'Process details',
    }));
    eventPanel.appendChild(createEl('div', {
      className: 'codex-events',
      hidden: true,
      'data-events-for': turn.id,
    }));
    card.appendChild(eventPanel);
    return card;
  }

  function renderTimeline(turns, workspace) {
    const container = root.querySelector('[data-codex-timeline]');
    if (!container) return;
    container.innerHTML = '';
    if (!turns || turns.length === 0) {
      container.appendChild(createEl('p', { className: 'codex-empty', text: 'No turns found.' }));
      return;
    }
    turns.forEach((turn) => container.appendChild(renderTurnCard(turn, workspace)));
  }

  async function refreshSession() {
    const sessionId = root.dataset.sessionId;
    if (!sessionId) return null;
    const payload = await requestJson(`/codex/api/sessions/${encodeURIComponent(sessionId)}`);
    renderTimeline(payload.turns || [], payload.workspace);
    renderSessionStats(payload.stats);
    return payload;
  }

  function renderTurnActions(turn) {
    const container = root.querySelector('[data-turn-actions]');
    if (!container) return;
    container.innerHTML = '';
    if (turn.status === 'queued' || turn.status === 'running') {
      container.appendChild(createEl('button', {
        type: 'button',
        className: 'codex-button codex-button--secondary',
        'data-action': 'cancel-turn',
        'data-turn-id': turn.id,
        text: 'Cancel',
      }));
    }
    if (RETRYABLE_STATUSES.has(turn.status)) {
      container.appendChild(createEl('button', {
        type: 'button',
        className: 'codex-button codex-button--secondary',
        'data-action': 'retry-turn',
        'data-turn-id': turn.id,
        text: 'Retry',
      }));
    }
  }

  function renderTurnDetail(turn, workspace) {
    const container = root.querySelector('[data-codex-turn-detail]');
    if (!container) return;
    renderTurnActions(turn);
    const transcript = root.querySelector('.codex-transcript--detail');
    const status = root.querySelector('.codex-panel__header .codex-status');
    if (status) {
      status.className = statusClass(turn.status);
      status.textContent = turn.status;
    }
    const errorText = root.querySelector('.codex-error-text');
    if (errorText) {
      errorText.textContent = turn.errorMessage || '';
    }
    if (transcript) {
      transcript.innerHTML = '';
      transcript.appendChild(renderTranscriptBlock('Prompt', turn.prompt, 'Prompt unavailable.', 'h2'));
      transcript.appendChild(renderTranscriptBlock('Response', turn.finalResponse, turn.errorMessage || 'Response pending.', 'h2'));
    }
    const detailGrid = root.querySelector('.codex-detail-grid');
    if (detailGrid) {
      const tokens = normalizeTokens(turn.tokenUsage);
      const values = [
        ['Workspace', workspace ? workspace.name : '-'],
        ['Mode', String(turn.kind || '').replace(/_/g, ' ') || '-'],
        ['Permission', turn.permissionMode || '-'],
        ['Queued', formatDate(turn.queuedAt)],
        ['Started', formatDate(turn.startedAt)],
        ['Completed', formatDate(turn.completedAt)],
        ['Duration', formatDuration(turn.durationMs)],
        ['Turn Input Tokens', formatNumber(tokens.input)],
        ['Turn Cached Tokens', formatNumber(tokens.cached)],
        ['Turn Output Tokens', formatNumber(tokens.output)],
        ['Turn Reasoning Tokens', formatNumber(tokens.reasoning)],
        ['Turn Estimated Cost', formatMoney(turn.costEstimate && turn.costEstimate.total)],
        ['Exit', turn.exitCode === null || turn.exitCode === undefined ? '-' : String(turn.exitCode)],
      ];
      detailGrid.innerHTML = '';
      values.forEach(([label, value]) => {
        const cell = createEl('div');
        cell.appendChild(createEl('small', { text: label }));
        cell.appendChild(createEl('strong', { text: value }));
        detailGrid.appendChild(cell);
      });
    }
  }

  async function refreshTurn() {
    const turnId = root.dataset.turnId;
    if (!turnId) return null;
    const payload = await requestJson(`/codex/api/turns/${encodeURIComponent(turnId)}`);
    renderTurnDetail(payload.turn, payload.workspace);
    return payload;
  }

  function renderEvents(container, events) {
    container.innerHTML = '';
    if (!events || events.length === 0) {
      container.appendChild(createEl('p', { className: 'codex-empty', text: 'No process events stored.' }));
      return;
    }
    events.forEach((event) => {
      const wrapper = createEl('article', { className: 'codex-event' });
      const header = createEl('div', { className: 'codex-event__header' });
      header.appendChild(createEl('strong', { text: `#${event.seq} ${event.eventType}` }));
      header.appendChild(createEl('span', { text: `${event.stream} / ${event.severity}` }));
      wrapper.appendChild(header);
      if (event.text) {
        wrapper.appendChild(createEl('pre', { text: event.text }));
      } else if (event.payload && Object.keys(event.payload).length) {
        wrapper.appendChild(createEl('pre', { text: JSON.stringify(event.payload, null, 2) }));
      } else {
        wrapper.appendChild(createEl('p', { className: 'codex-empty', text: 'No event payload.' }));
      }
      container.appendChild(wrapper);
    });
  }

  async function toggleEvents(turnId) {
    const container = root.querySelector(`[data-events-for="${CSS.escape(turnId)}"]`);
    if (!container) return;
    const shouldLoad = container.hidden || !container.dataset.loaded;
    container.hidden = !container.hidden;
    if (!shouldLoad) return;
    container.dataset.loaded = '1';
    container.innerHTML = '';
    container.appendChild(createEl('p', { className: 'codex-empty', text: 'Loading events...' }));
    try {
      const payload = await requestJson(`/codex/api/turns/${encodeURIComponent(turnId)}/events`);
      renderEvents(container, payload.events || []);
      container.hidden = false;
    } catch (error) {
      container.innerHTML = '';
      container.appendChild(createEl('p', { className: 'codex-error-text', text: error.message }));
      container.hidden = false;
    }
  }

  async function cancelTurn(turnId) {
    await requestJson(`/codex/api/turns/${encodeURIComponent(turnId)}/cancel`, { method: 'POST', body: '{}' });
    if (root.dataset.codexPage === 'dashboard') {
      await refreshDashboard();
    } else if (root.dataset.codexPage === 'session') {
      const payload = await refreshSession();
      if (syncPageAutoRefresh) {
        syncPageAutoRefresh(payload);
      }
    } else if (root.dataset.codexPage === 'turn') {
      const payload = await refreshTurn();
      if (syncPageAutoRefresh) {
        syncPageAutoRefresh(payload);
      }
    }
  }

  async function retryTurn(turnId) {
    const payload = await requestJson(`/codex/api/turns/${encodeURIComponent(turnId)}/retry`, { method: 'POST', body: '{}' });
    if (payload.statusUrl) {
      window.location.href = payload.statusUrl;
    }
  }

  function bindGlobalActions() {
    root.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      try {
        button.disabled = true;
        if (action === 'cancel-turn') {
          await cancelTurn(button.dataset.turnId);
        } else if (action === 'retry-turn') {
          await retryTurn(button.dataset.turnId);
        } else if (action === 'toggle-events') {
          await toggleEvents(button.dataset.turnId);
        } else if (action === 'archive-session') {
          await requestJson(`/codex/api/sessions/${encodeURIComponent(button.dataset.sessionId)}/archive`, { method: 'POST', body: '{}' });
          window.location.href = '/codex';
        } else if (action === 'disable-workspace') {
          await requestJson(`/codex/api/workspaces/${encodeURIComponent(button.dataset.workspaceId)}`, { method: 'DELETE', body: '{}' });
          window.location.reload();
        }
      } catch (error) {
        console.error(error);
        alert(error.message || 'Request failed.');
      } finally {
        button.disabled = false;
      }
    });
  }

  function initDashboard() {
    const form = document.getElementById('codex-new-session-form');
    const status = document.getElementById('codex-new-session-status');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        setStatus(status, 'Submitting...', '');
        submit.disabled = true;
        try {
          const payload = await requestJson('/codex/api/sessions', {
            method: 'POST',
            body: JSON.stringify(formToPayload(form)),
          });
          setStatus(status, `Accepted. Turn ${payload.turn.id} is queued.`, 'success');
          form.querySelector('[name="prompt"]').value = '';
          clearYoloConfirmation(form);
          await refreshDashboard();
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      });
    }
    const pricingForm = document.getElementById('codex-pricing-form');
    const pricingStatus = document.getElementById('codex-pricing-status');
    if (pricingForm) {
      pricingForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = pricingForm.querySelector('[type="submit"]');
        setStatus(pricingStatus, 'Saving...', '');
        submit.disabled = true;
        try {
          const payload = {};
          TOKEN_TYPES.forEach((type) => {
            const input = pricingForm.querySelector(`[name="${type}"]`);
            payload[type] = input ? input.value : 0;
          });
          const response = await requestJson('/codex/api/pricing', {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          setStatus(pricingStatus, 'Prices saved.', 'success');
          renderDashboardStats(response.stats, response.pricing);
        } catch (error) {
          setStatus(pricingStatus, error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      });
    }
    setInterval(() => {
      refreshDashboard().catch(() => {});
    }, 10000);
  }

  function initSession() {
    const form = document.getElementById('codex-followup-form');
    const status = document.getElementById('codex-followup-status');
    let refreshTimer = null;

    function stopAutoRefresh() {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    }

    function startAutoRefresh() {
      if (refreshTimer) return;
      refreshTimer = setInterval(() => {
        refreshSession()
          .then(syncAutoRefresh)
          .catch(() => {});
      }, 10000);
    }

    function syncAutoRefresh(payload) {
      if (hasActiveTurns(payload && payload.turns)) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    }

    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        setStatus(status, 'Submitting...', '');
        submit.disabled = true;
        try {
          const payload = await requestJson(`/codex/api/sessions/${encodeURIComponent(form.dataset.sessionId)}/turns`, {
            method: 'POST',
            body: JSON.stringify(formToPayload(form)),
          });
          setStatus(status, `Accepted. Turn ${payload.turn.id} is queued.`, 'success');
          form.querySelector('[name="prompt"]').value = '';
          clearYoloConfirmation(form);
          const state = await refreshSession();
          syncAutoRefresh(state);
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      });
    }
    syncPageAutoRefresh = syncAutoRefresh;
    syncAutoRefresh({ turns: bootstrap.turns });
  }

  function initTurn() {
    let refreshTimer = null;

    function startAutoRefresh() {
      if (refreshTimer) return;
      refreshTimer = setInterval(() => {
        refreshTurn()
          .then(syncAutoRefresh)
          .catch(() => {});
      }, 10000);
    }

    function stopAutoRefresh() {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    }

    function syncAutoRefresh(payload) {
      if (isActiveTurn(payload && payload.turn)) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    }

    syncPageAutoRefresh = syncAutoRefresh;
    syncAutoRefresh({ turn: bootstrap.turn });
  }

  function initWorkspaces() {
    const createForm = document.getElementById('codex-workspace-create');
    const status = document.getElementById('codex-workspace-status');
    if (createForm) {
      createForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = createForm.querySelector('[type="submit"]');
        submit.disabled = true;
        setStatus(status, 'Saving...', '');
        try {
          await requestJson('/codex/api/workspaces', {
            method: 'POST',
            body: JSON.stringify(formToPayload(createForm)),
          });
          setStatus(status, 'Workspace added.', 'success');
          window.location.reload();
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      });
    }

    root.querySelectorAll('[data-workspace-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          await requestJson(`/codex/api/workspaces/${encodeURIComponent(form.dataset.workspaceForm)}`, {
            method: 'PATCH',
            body: JSON.stringify(formToPayload(form)),
          });
          window.location.reload();
        } catch (error) {
          alert(error.message || 'Unable to save workspace.');
        } finally {
          submit.disabled = false;
        }
      });
    });
  }

  bindPermissionControls(root);
  bindGlobalActions();

  if (root.dataset.codexPage === 'dashboard') {
    initDashboard();
  } else if (root.dataset.codexPage === 'session') {
    initSession();
  } else if (root.dataset.codexPage === 'turn') {
    initTurn();
  } else if (root.dataset.codexPage === 'workspaces') {
    initWorkspaces();
  }
})();
