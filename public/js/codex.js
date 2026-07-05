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

  const RETRYABLE_STATUSES = new Set(['failed', 'timed_out', 'cancelled', 'blocked']);

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${Math.round(ms / 1000)}s`;
  }

  function statusClass(status) {
    return `codex-status codex-status--${String(status || '').replace(/_/g, '-')}`;
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
    yoloConfirm.hidden = permission.value !== 'yolo';
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
    const [queue, sessions] = await Promise.all([
      requestJson('/codex/api/queue'),
      requestJson('/codex/api/sessions?limit=12'),
    ]);
    renderTurnList(root.querySelector('[data-codex-running-list]'), queue.runningTurns || [], 'No running requests.');
    renderTurnList(root.querySelector('[data-codex-queued-list]'), queue.queuedTurns || [], 'No queued requests.');
    renderSessionsTable(root.querySelector('[data-codex-session-table]'), sessions.sessions || []);
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
    ].forEach((text) => meta.appendChild(createEl('span', { text })));
    card.appendChild(meta);

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
      const values = [
        ['Workspace', workspace ? workspace.name : '-'],
        ['Mode', String(turn.kind || '').replace(/_/g, ' ') || '-'],
        ['Permission', turn.permissionMode || '-'],
        ['Queued', formatDate(turn.queuedAt)],
        ['Started', formatDate(turn.startedAt)],
        ['Completed', formatDate(turn.completedAt)],
        ['Duration', formatDuration(turn.durationMs)],
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
      const payload = await requestJson(`/codex/api/turns/${encodeURIComponent(turnId)}/events?limit=200`);
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
      await refreshSession();
    } else if (root.dataset.codexPage === 'turn') {
      await refreshTurn();
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
          await refreshDashboard();
        } catch (error) {
          setStatus(status, error.message, 'error');
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
          await refreshSession();
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      });
    }
    setInterval(() => {
      refreshSession().catch(() => {});
    }, 10000);
  }

  function initTurn() {
    setInterval(() => {
      refreshTurn().catch(() => {});
    }, 10000);
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
