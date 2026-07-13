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
  const COMMIT_PUSH_MODE = 'git_commit_push';
  const COMMIT_PUSH_DEFAULT_PROFILE_ID = 'fastest';
  const COMMIT_PUSH_DEFAULT_PROMPT = 'Please commit the pending changes and push to online repository';
  const TOKEN_LABELS = {
    input: 'Input',
    cached: 'Cached',
    output: 'Output',
    reasoning: 'Reasoning',
  };
  const HEALTH_OMITTED_KEYS = new Set(['reasoningEfforts', 'codexModelOptions']);
  const HEALTH_LABELS = {
    apiOk: 'API response',
    ok: 'Overall health',
    path: 'Path',
    available: 'Available',
    version: 'Version',
    error: 'Error',
    workerId: 'Worker ID',
    started: 'Started',
    enabled: 'Enabled',
    activeCount: 'Active turns',
    activeTurnIds: 'Active turn IDs',
    globalConcurrency: 'Global concurrency',
    pollIntervalMs: 'Poll interval',
    lastTickAt: 'Last tick',
    lastError: 'Last error',
    queuedCount: 'Queued',
    runningCount: 'Running',
    staleLockCount: 'Stale locks',
    workspaceCount: 'Workspaces',
    workerEnabled: 'Worker enabled',
    timeoutMs: 'Turn timeout',
    maxPromptChars: 'Maximum prompt length',
    yoloEnabled: 'YOLO enabled',
  };
  const LIVE_ACTIVITY_POLL_MS = 2000;
  const LIVE_ACTIVITY_HIGHLIGHT_MS = 1400;
  const liveActivityByTurn = new Map();
  let liveActivityTurns = [];
  let liveActivityTimer = null;
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

  function tableCell(label, attrs, children) {
    const cellAttrs = { ...(attrs || {}) };
    if (label) {
      cellAttrs['data-label'] = label;
    }
    return createEl('td', cellAttrs, children);
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

  function getLiveActivityState(turnOrId) {
    const turn = turnOrId && typeof turnOrId === 'object' ? turnOrId : null;
    const turnId = String(turn ? turn.id : turnOrId || '');
    if (!liveActivityByTurn.has(turnId)) {
      liveActivityByTurn.set(turnId, {
        turnId,
        status: turn ? turn.status : '',
        reportedCount: Number(turn && turn.eventCount) || 0,
        events: [],
        lastSeq: 0,
        latestEvent: null,
        loaded: false,
        loading: false,
        detailsOpen: false,
        failureCount: 0,
        errorMessage: '',
        highlightUntil: 0,
      });
    }
    const state = liveActivityByTurn.get(turnId);
    if (turn) {
      state.status = turn.status || '';
      state.reportedCount = Math.max(state.reportedCount, Number(turn.eventCount) || 0);
    }
    return state;
  }

  function humanizeEventName(value) {
    const text = String(value || 'process update')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return 'Process update';
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  }

  function describeProcessEvent(event) {
    const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
    const nestedPayload = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
    const item = payload.item && typeof payload.item === 'object'
      ? payload.item
      : (nestedPayload.item && typeof nestedPayload.item === 'object' ? nestedPayload.item : {});
    const itemType = String(item.type || '').toLowerCase();
    const eventType = String(event && event.eventType || '').toLowerCase();
    const completed = eventType.includes('completed') || eventType.includes('complete');

    if (eventType === 'process.started') return 'Codex process started';
    if (eventType === 'thread.started' || eventType === 'session_meta') return 'Codex session connected';
    if (eventType.startsWith('turn.')) return humanizeEventName(eventType);
    if (itemType.includes('reasoning')) return 'Reasoning update';
    if (itemType.includes('command')) return completed ? 'Command completed' : 'Command started';
    if (itemType.includes('file')) return 'File changes updated';
    if (itemType.includes('agent') || itemType.includes('assistant')) return 'Response update';
    if (itemType.includes('web_search') || itemType.includes('search')) return 'Search activity';
    if (itemType.includes('tool') || itemType.includes('mcp')) return 'Tool activity';
    if (eventType === 'stdout.line') return 'Process output received';
    if (eventType === 'stderr.line') return 'Process warning received';
    if (itemType) return humanizeEventName(itemType);
    return humanizeEventName(event && event.eventType);
  }

  function formatActivityAge(value) {
    if (!value) return 'time unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'time unavailable';
    const elapsedMs = Math.max(0, Date.now() - date.getTime());
    if (elapsedMs < 5000) return 'just now';
    if (elapsedMs < 60000) return `${Math.floor(elapsedMs / 1000)}s ago`;
    if (elapsedMs < 3600000) return `${Math.floor(elapsedMs / 60000)}m ago`;
    return formatDate(value);
  }

  function liveActivityCount(state) {
    return Math.max(state.reportedCount, state.lastSeq, state.events.length);
  }

  function liveActivityDisplay(state) {
    const latest = state.latestEvent;
    let heading = 'Codex is working';
    if (state.failureCount >= 2) {
      heading = 'Reconnecting to activity feed';
    } else if (state.highlightUntil > Date.now()) {
      heading = 'New process detail';
    } else if (latest) {
      const eventTime = new Date(latest.createdAt || 0).getTime();
      heading = eventTime && Date.now() - eventTime > 30000
        ? 'Monitoring for the next detail'
        : 'Receiving process details';
    }

    if (!latest) {
      return {
        heading,
        summary: state.failureCount >= 2
          ? 'The status is still running; activity checks will retry automatically.'
          : 'Waiting for the first process detail…',
      };
    }

    return {
      heading,
      summary: `Detail #${latest.seq} · ${describeProcessEvent(latest)} · ${formatActivityAge(latest.createdAt)}`,
    };
  }

  function renderLiveActivity(turn) {
    const state = getLiveActivityState(turn);
    const display = liveActivityDisplay(state);
    const wrapper = createEl('div', {
      className: `codex-live-activity${state.highlightUntil > Date.now() ? ' codex-live-activity--updated' : ''}`,
      'data-turn-activity': turn.id,
      'data-activity-state': state.failureCount >= 2 ? 'retrying' : 'live',
      'aria-label': 'Live Codex process activity',
    });
    const signal = createEl('span', {
      className: 'codex-live-activity__signal',
      'aria-hidden': 'true',
    });
    signal.appendChild(createEl('span'));
    signal.appendChild(createEl('span'));
    signal.appendChild(createEl('span'));
    wrapper.appendChild(signal);
    const copy = createEl('span', { className: 'codex-live-activity__copy' });
    copy.appendChild(createEl('strong', { 'data-activity-heading': '', text: display.heading }));
    copy.appendChild(createEl('span', { 'data-activity-summary': '', text: display.summary }));
    wrapper.appendChild(copy);
    wrapper.appendChild(createEl('span', {
      className: 'codex-visually-hidden',
      'data-activity-announcement': '',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    }));
    return wrapper;
  }

  function updateProcessDetailButtons(turnId) {
    const state = getLiveActivityState(turnId);
    const count = liveActivityCount(state);
    root.querySelectorAll(`[data-action="toggle-events"][data-turn-id="${CSS.escape(turnId)}"]`).forEach((button) => {
      const open = state.detailsOpen;
      const onTurnPage = root.dataset.codexPage === 'turn';
      const label = onTurnPage
        ? (open ? 'Hide details' : 'Show details')
        : (open ? 'Hide process details' : 'Process details');
      button.textContent = count ? `${label} (${count})` : label;
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  function updateLiveActivityIndicators(turnId, options = {}) {
    const state = getLiveActivityState(turnId);
    const display = liveActivityDisplay(state);
    const selector = `[data-turn-activity="${CSS.escape(turnId)}"]`;
    root.querySelectorAll(selector).forEach((indicator) => {
      indicator.classList.toggle('codex-live-activity--updated', state.highlightUntil > Date.now());
      indicator.dataset.activityState = state.failureCount >= 2 ? 'retrying' : 'live';
      const heading = indicator.querySelector('[data-activity-heading]');
      const summary = indicator.querySelector('[data-activity-summary]');
      if (heading) heading.textContent = display.heading;
      if (summary) summary.textContent = display.summary;
      if (state.latestEvent && state.latestEvent.createdAt) {
        indicator.title = `Latest process detail: ${formatDate(state.latestEvent.createdAt)}`;
      }
      if (options.announce && state.latestEvent) {
        const announcement = indicator.querySelector('[data-activity-announcement]');
        if (announcement) {
          announcement.textContent = `New process detail: ${describeProcessEvent(state.latestEvent)}.`;
        }
      }
    });
    updateProcessDetailButtons(turnId);

    if (options.renderEventPanels) {
      root.querySelectorAll(`[data-events-for="${CSS.escape(turnId)}"]`).forEach((container) => {
        if (container.hidden || !state.detailsOpen) return;
        renderEvents(container, state.events, {
          errorMessage: state.errorMessage,
          isRunning: state.status === 'running',
          loaded: state.loaded,
          newSeqs: options.newSeqs,
        });
      });
    }
  }

  async function loadTurnActivity(turnId) {
    const state = getLiveActivityState(turnId);
    if (!turnId || state.loading) return false;
    const initialLoad = !state.loaded;
    state.loading = true;
    try {
      const afterSeq = initialLoad ? 0 : state.lastSeq;
      const payload = await requestJson(
        `/codex/api/turns/${encodeURIComponent(turnId)}/events?afterSeq=${encodeURIComponent(afterSeq)}`,
        { cache: 'no-store' }
      );
      const knownSeqs = new Set(state.events.map((event) => Number(event.seq) || 0));
      const incoming = (payload.events || [])
        .filter((event) => !knownSeqs.has(Number(event.seq) || 0))
        .sort((left, right) => Number(left.seq) - Number(right.seq));
      const newSeqs = new Set(initialLoad ? [] : incoming.map((event) => Number(event.seq) || 0));
      if (incoming.length) {
        state.events.push(...incoming);
        state.events.sort((left, right) => Number(left.seq) - Number(right.seq));
        state.latestEvent = state.events[state.events.length - 1];
        state.lastSeq = Number(state.latestEvent.seq) || state.lastSeq;
        state.reportedCount = Math.max(state.reportedCount, state.lastSeq);
        state.highlightUntil = Date.now() + LIVE_ACTIVITY_HIGHLIGHT_MS;
      } else if (state.events.length) {
        state.latestEvent = state.events[state.events.length - 1];
        state.lastSeq = Math.max(state.lastSeq, Number(state.latestEvent.seq) || 0);
      }
      state.loaded = true;
      state.failureCount = 0;
      state.errorMessage = '';
      updateLiveActivityIndicators(turnId, {
        announce: incoming.length > 0,
        newSeqs,
        renderEventPanels: initialLoad || incoming.length > 0,
      });
      if (incoming.length) {
        window.setTimeout(() => {
          updateLiveActivityIndicators(turnId);
        }, LIVE_ACTIVITY_HIGHLIGHT_MS + 50);
      }
      return true;
    } catch (error) {
      state.failureCount += 1;
      state.errorMessage = error.message || 'Unable to load process details.';
      updateLiveActivityIndicators(turnId, { renderEventPanels: true });
      return false;
    } finally {
      state.loading = false;
    }
  }

  function stopLiveActivityPolling() {
    if (liveActivityTimer) {
      window.clearInterval(liveActivityTimer);
      liveActivityTimer = null;
    }
  }

  async function pollLiveActivities() {
    if (document.hidden || liveActivityTurns.length === 0) return;
    await Promise.all(liveActivityTurns.map((turn) => loadTurnActivity(turn.id)));
  }

  function startLiveActivityPolling() {
    if (liveActivityTimer || liveActivityTurns.length === 0) return;
    pollLiveActivities().catch(() => {});
    liveActivityTimer = window.setInterval(() => {
      pollLiveActivities().catch(() => {});
    }, LIVE_ACTIVITY_POLL_MS);
  }

  function syncLiveActivityTurns(turns) {
    const previousRunningIds = new Set(liveActivityTurns.map((turn) => String(turn.id)));
    const availableTurns = Array.isArray(turns) ? turns.filter(Boolean) : [];
    availableTurns.forEach((turn) => {
      const state = getLiveActivityState(turn.id);
      const previousStatus = state.status;
      getLiveActivityState(turn);
      if (
        root.dataset.codexPage === 'turn' &&
        turn.status === 'running' &&
        previousStatus &&
        previousStatus !== 'running'
      ) {
        state.detailsOpen = true;
        root.querySelectorAll(`[data-events-for="${CSS.escape(turn.id)}"]`).forEach((container) => {
          container.hidden = false;
        });
      }
      if (previousRunningIds.has(String(turn.id)) && turn.status !== 'running') {
        window.setTimeout(() => loadTurnActivity(turn.id), 500);
      }
      updateLiveActivityIndicators(turn.id);
    });
    liveActivityTurns = availableTurns.filter((turn) => turn.status === 'running');
    if (liveActivityTurns.length) {
      startLiveActivityPolling();
    } else {
      stopLiveActivityPolling();
    }
  }

  function captureInitialProcessDetailState() {
    root.querySelectorAll('[data-events-for]').forEach((container) => {
      const state = getLiveActivityState(container.dataset.eventsFor);
      state.detailsOpen = !container.hidden;
      updateProcessDetailButtons(state.turnId);
    });
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

  function healthLabel(key) {
    if (HEALTH_LABELS[key]) return HEALTH_LABELS[key];
    return String(key || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^./, (character) => character.toUpperCase());
  }

  function healthValue(key, value) {
    if (value === null || value === undefined) {
      return { text: 'Not reported', tone: 'muted' };
    }
    if (typeof value === 'boolean') {
      return {
        text: key === 'ok' || key === 'apiOk' ? (value ? 'Healthy' : 'Unhealthy') : (value ? 'Yes' : 'No'),
        tone: value ? 'success' : (key === 'ok' || key === 'apiOk' || key === 'available' ? 'danger' : 'muted'),
      };
    }
    if (Array.isArray(value)) {
      return {
        text: value.length ? value.map((entry) => String(entry)).join(', ') : 'None',
        tone: value.length ? '' : 'muted',
      };
    }
    if (typeof value === 'number') {
      return {
        text: key.endsWith('Ms') ? formatDuration(value) : formatNumber(value),
        tone: '',
      };
    }
    if (key.endsWith('At')) {
      return { text: formatDate(value), tone: value ? '' : 'muted' };
    }
    if ((key === 'error' || key === 'lastError') && !String(value).trim()) {
      return { text: 'None', tone: 'muted' };
    }
    return {
      text: String(value),
      tone: key === 'error' || key === 'lastError' ? 'danger' : '',
      code: key === 'path' || key.endsWith('Id'),
    };
  }

  function healthEntries(source) {
    return Object.entries(source || {}).filter(([key, value]) => (
      !HEALTH_OMITTED_KEYS.has(key) && (value === null || typeof value !== 'object' || Array.isArray(value))
    ));
  }

  function renderHealthSection(container, title, source, note) {
    const entries = healthEntries(source);
    if (!entries.length) return;
    const section = createEl('section', { className: 'codex-health-section' });
    section.appendChild(createEl('h3', { text: title }));
    const list = createEl('dl', { className: 'codex-health-grid' });
    entries.forEach(([key, value]) => {
      const item = createEl('div', { className: 'codex-health-item' });
      item.appendChild(createEl('dt', { text: healthLabel(key) }));
      const formatted = healthValue(key, value);
      const valueClass = [
        'codex-health-value',
        formatted.tone ? `codex-health-value--${formatted.tone}` : '',
        formatted.code ? 'codex-health-value--code' : '',
      ].filter(Boolean).join(' ');
      item.appendChild(createEl('dd', { className: valueClass, text: formatted.text }));
      list.appendChild(item);
    });
    section.appendChild(list);
    if (note) {
      section.appendChild(createEl('p', { className: 'codex-health-note', text: note }));
    }
    container.appendChild(section);
  }

  function renderHealth(payload, container, summary) {
    const health = payload && payload.health && typeof payload.health === 'object' ? payload.health : {};
    const healthy = Boolean(payload && payload.ok === true && health.ok === true);
    container.innerHTML = '';

    const banner = createEl('div', {
      className: `codex-health-banner codex-health-banner--${healthy ? 'success' : 'danger'}`,
    });
    banner.appendChild(createEl('strong', { text: healthy ? 'All systems healthy' : 'Health check needs attention' }));
    banner.appendChild(createEl('span', { text: `Checked ${new Date().toLocaleString()}` }));
    container.appendChild(banner);

    renderHealthSection(container, 'Overview', {
      apiOk: payload ? payload.ok : undefined,
      ok: health.ok,
      queuedCount: health.queuedCount,
      runningCount: health.runningCount,
      staleLockCount: health.staleLockCount,
      workspaceCount: health.workspaceCount,
    });
    renderHealthSection(container, 'Codex binary', health.binary);
    renderHealthSection(container, 'Queue worker', health.worker);
    renderHealthSection(
      container,
      'Configuration',
      health.config,
      'Reasoning effort and model option lists are omitted to keep this view compact.',
    );

    Object.entries(health).forEach(([key, value]) => {
      if (
        !['binary', 'worker', 'config'].includes(key) &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        renderHealthSection(container, healthLabel(key), value);
      }
    });

    summary.textContent = healthy
      ? 'The Codex service is responding normally.'
      : 'One or more Codex health checks reported a problem.';
  }

  function initHealthModal() {
    const trigger = document.getElementById('codex-health-button');
    const modal = document.getElementById('codex-health-modal');
    const loadingState = document.getElementById('codex-health-loading');
    const errorState = document.getElementById('codex-health-error');
    const content = document.getElementById('codex-health-content');
    const summary = document.getElementById('codex-health-summary');
    const refresh = document.getElementById('codex-health-refresh');
    if (!trigger || !modal || !loadingState || !errorState || !content || !summary || !refresh) return;

    let loading = false;

    function openModal() {
      if (modal.open) return;
      if (typeof modal.showModal === 'function') {
        modal.showModal();
      } else {
        modal.setAttribute('open', '');
      }
    }

    function closeModal() {
      if (typeof modal.close === 'function') {
        modal.close();
      } else {
        modal.removeAttribute('open');
      }
    }

    async function loadHealth() {
      if (loading) return;
      loading = true;
      trigger.disabled = true;
      refresh.disabled = true;
      loadingState.hidden = false;
      errorState.hidden = true;
      content.hidden = true;
      summary.textContent = 'Checking current server, binary, and worker status…';
      openModal();
      try {
        const payload = await requestJson('/codex/api/health');
        renderHealth(payload, content, summary);
        content.hidden = false;
      } catch (error) {
        summary.textContent = 'The Codex health check could not be loaded.';
        errorState.textContent = error.message || 'Unable to load Codex health.';
        errorState.hidden = false;
      } finally {
        loadingState.hidden = true;
        loading = false;
        trigger.disabled = false;
        refresh.disabled = false;
      }
    }

    trigger.addEventListener('click', loadHealth);
    refresh.addEventListener('click', loadHealth);
    modal.querySelectorAll('[data-codex-health-close]').forEach((button) => {
      button.addEventListener('click', closeModal);
    });
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

  function applyCommitPushDefaults(form) {
    if (!form) return;
    const selectedMode = form.querySelector('[name="mode"]:checked');
    if (!selectedMode || selectedMode.value !== COMMIT_PUSH_MODE) {
      return;
    }

    const prompt = form.querySelector('[name="prompt"]');
    if (prompt && !prompt.value.trim()) {
      prompt.value = COMMIT_PUSH_DEFAULT_PROMPT;
    }

    const permission = form.querySelector('[name="permissionMode"]');
    if (permission) {
      permission.value = 'yolo';
    }

    const profile = form.querySelector('[name="requestProfileId"]');
    if (profile) {
      profile.value = COMMIT_PUSH_DEFAULT_PROFILE_ID;
    }

    const confirmInput = form.querySelector('.codex-yolo-confirm input[type="checkbox"]');
    if (confirmInput) {
      confirmInput.checked = true;
    }
    syncPermissionVisibility(form);
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
    const row = createEl('article', {
      className: 'codex-job-row',
      'data-turn-id': turn.id,
    });
    const main = createEl('div', { className: 'codex-job-row__main' });
    main.appendChild(createEl('span', { className: statusClass(turn.status), text: turn.status }));
    main.appendChild(createEl('a', {
      href: `/codex/turns/${encodeURIComponent(turn.id)}`,
      text: turn.workspace ? turn.workspace.name : 'Workspace',
    }));
    main.appendChild(createEl('small', {
      text: turn.status === 'running' ? `Started ${formatDate(turn.startedAt)}` : `Queued ${formatDate(turn.queuedAt)}`,
    }));
    if (turn.status === 'running') {
      main.appendChild(renderLiveActivity(turn));
    }
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
          row.appendChild(tableCell('Month', { text: month.label || month.key || '-' }));
          row.appendChild(tableCell('Turns', { text: formatNumber(month.turnCount) }));
          row.appendChild(tableCell('Sessions', { text: formatNumber(month.sessionCount) }));
          const tokens = normalizeTokens(month.tokens);
          TOKEN_TYPES.forEach((type) => row.appendChild(tableCell(TOKEN_LABELS[type], { text: formatNumber(tokens[type]) })));
          row.appendChild(tableCell('Cost', { text: formatMoney(month.cost) }));
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
          const nameCell = tableCell('Workspace');
          nameCell.appendChild(createEl('strong', { text: workspace.workspaceName || workspace.label || 'Workspace' }));
          if (workspace.rootPath) {
            nameCell.appendChild(createEl('small', { text: workspace.rootPath }));
          }
          row.appendChild(nameCell);
          row.appendChild(tableCell('Turns', { text: formatNumber(workspace.turnCount) }));
          row.appendChild(tableCell('Sessions', { text: formatNumber(workspace.sessionCount) }));
          const tokens = normalizeTokens(workspace.tokens);
          TOKEN_TYPES.forEach((type) => row.appendChild(tableCell(TOKEN_LABELS[type], { text: formatNumber(tokens[type]) })));
          row.appendChild(tableCell('Avg Time', { text: formatDuration(workspace.avgDurationMs) }));
          row.appendChild(tableCell('Success', { text: formatPercent(workspace.successRate) }));
          row.appendChild(tableCell('Cost', { text: formatMoney(workspace.cost) }));
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
      const titleCell = tableCell('Title');
      titleCell.appendChild(createEl('a', {
        href: `/codex/sessions/${encodeURIComponent(session.id)}`,
        text: session.title,
      }));
      if (session.lastResponsePreview) {
        titleCell.appendChild(createEl('small', { text: session.lastResponsePreview }));
      }
      row.appendChild(titleCell);
      row.appendChild(tableCell('Workspace', { text: session.workspace ? session.workspace.name : '-' }));
      const statusCell = tableCell('Status');
      statusCell.appendChild(createEl('span', { className: statusClass(session.status), text: session.status }));
      row.appendChild(statusCell);
      row.appendChild(tableCell('Updated', { text: formatDate(session.updatedAt) }));
      tbody.appendChild(row);
    });
  }

  async function refreshDashboard() {
    const [queue, sessions, statsPayload] = await Promise.all([
      requestJson('/codex/api/queue'),
      requestJson('/codex/api/sessions?limit=12'),
      requestJson('/codex/api/stats'),
    ]);
    syncLiveActivityTurns([...(queue.runningTurns || []), ...(queue.queuedTurns || [])]);
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
    const activityState = getLiveActivityState(turn);
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
      turn.requestProfileName ? `Profile ${turn.requestProfileName}` : '',
      turn.model ? `Model ${turn.model}` : '',
      turn.reasoningEffort ? `Reasoning ${turn.reasoningEffort}` : '',
      `Queued ${formatDate(turn.queuedAt)}`,
      `Duration ${formatDuration(turn.durationMs)}`,
      `Turn cost ${formatMoney(turn.costEstimate && turn.costEstimate.total)}`,
    ].filter(Boolean).forEach((text) => meta.appendChild(createEl('span', { text })));
    card.appendChild(meta);
    if (turn.status === 'running') {
      card.appendChild(renderLiveActivity(turn));
    }
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
      'aria-controls': `codex-events-${turn.id}`,
      'aria-expanded': activityState.detailsOpen ? 'true' : 'false',
      text: 'Process details',
    }));
    const eventsContainer = createEl('div', {
      id: `codex-events-${turn.id}`,
      className: 'codex-events',
      hidden: !activityState.detailsOpen,
      'data-events-for': turn.id,
    });
    if (activityState.detailsOpen) {
      renderEvents(eventsContainer, activityState.events, {
        errorMessage: activityState.errorMessage,
        isRunning: turn.status === 'running',
        loaded: activityState.loaded,
      });
    }
    eventPanel.appendChild(eventsContainer);
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
    turns.forEach((turn) => updateProcessDetailButtons(turn.id));
  }

  async function refreshSession() {
    const sessionId = root.dataset.sessionId;
    if (!sessionId) return null;
    const payload = await requestJson(`/codex/api/sessions/${encodeURIComponent(sessionId)}`);
    syncLiveActivityTurns(payload.turns || []);
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
    const activityState = getLiveActivityState(turn);
    renderTurnActions(turn);
    const activitySlot = root.querySelector('[data-live-activity-slot]');
    if (activitySlot) {
      activitySlot.innerHTML = '';
      if (turn.status === 'running') {
        activitySlot.appendChild(renderLiveActivity(turn));
      }
    }
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
        ['Profile', turn.requestProfileName || '-'],
        ['Model', turn.model || '-'],
        ['Reasoning', turn.reasoningEffort || '-'],
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
    root.querySelectorAll(`[data-events-for="${CSS.escape(turn.id)}"]`).forEach((eventsContainer) => {
      if (!eventsContainer.hidden && activityState.detailsOpen) {
        renderEvents(eventsContainer, activityState.events, {
          errorMessage: activityState.errorMessage,
          isRunning: turn.status === 'running',
          loaded: activityState.loaded,
        });
      }
    });
    updateProcessDetailButtons(turn.id);
  }

  async function refreshTurn() {
    const turnId = root.dataset.turnId;
    if (!turnId) return null;
    const payload = await requestJson(`/codex/api/turns/${encodeURIComponent(turnId)}`);
    syncLiveActivityTurns([payload.turn]);
    renderTurnDetail(payload.turn, payload.workspace);
    return payload;
  }

  function renderEvents(container, events, options = {}) {
    container.innerHTML = '';
    if (!events || events.length === 0) {
      let message = 'No process details stored.';
      if (!options.loaded) {
        message = 'Loading process details…';
      } else if (options.isRunning) {
        message = 'Listening for the first process detail…';
      }
      container.appendChild(createEl('p', { className: 'codex-empty', text: message }));
    } else {
      events.forEach((event) => {
        const eventSeq = Number(event.seq) || 0;
        const isNew = Boolean(options.newSeqs && options.newSeqs.has(eventSeq));
        const wrapper = createEl('article', {
          className: `codex-event${isNew ? ' codex-event--new' : ''}`,
          'data-event-seq': eventSeq,
        });
        const header = createEl('div', { className: 'codex-event__header' });
        header.appendChild(createEl('strong', { text: `#${event.seq} ${event.eventType}` }));
        const eventMeta = [
          event.stream,
          event.severity,
          event.createdAt ? formatDate(event.createdAt) : '',
        ].filter(Boolean).join(' / ');
        header.appendChild(createEl('span', { text: eventMeta }));
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
    if (options.errorMessage) {
      container.appendChild(createEl('p', {
        className: 'codex-events__notice codex-error-text',
        text: options.isRunning
          ? `${options.errorMessage} Retrying automatically.`
          : options.errorMessage,
      }));
    }
    if (options.isRunning) {
      const listener = createEl('div', {
        className: 'codex-events__live',
        'aria-label': 'Listening for more process details',
      });
      listener.appendChild(createEl('span', {
        className: 'codex-events__live-dot',
        'aria-hidden': 'true',
      }));
      listener.appendChild(createEl('span', { text: 'Live · listening for more details' }));
      container.appendChild(listener);
    }
    const latestEvent = events && events.length ? events[events.length - 1] : null;
    container.dataset.renderedSeq = latestEvent ? String(latestEvent.seq) : '0';
  }

  async function toggleEvents(turnId) {
    const container = root.querySelector(`[data-events-for="${CSS.escape(turnId)}"]`);
    if (!container) return;
    const state = getLiveActivityState(turnId);
    state.detailsOpen = container.hidden;
    container.hidden = !state.detailsOpen;
    updateProcessDetailButtons(turnId);
    if (!state.detailsOpen) return;
    renderEvents(container, state.events, {
      errorMessage: state.errorMessage,
      isRunning: state.status === 'running',
      loaded: state.loaded,
    });
    if (!state.loaded) {
      await loadTurnActivity(turnId);
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
        } else if (action === 'disable-profile') {
          await requestJson(`/codex/api/profiles/${encodeURIComponent(button.dataset.profileId)}`, { method: 'DELETE', body: '{}' });
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
    initHealthModal();
    const form = document.getElementById('codex-new-session-form');
    const status = document.getElementById('codex-new-session-status');
    if (form) {
      const modeInputs = form.querySelectorAll('[name="mode"]');
      modeInputs.forEach((input) => {
        input.addEventListener('change', () => applyCommitPushDefaults(form));
      });
      form.addEventListener('reset', () => {
        setTimeout(() => {
          applyCommitPushDefaults(form);
        }, 0);
      });
      applyCommitPushDefaults(form);
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
    syncLiveActivityTurns([...(bootstrap.runningTurns || []), ...(bootstrap.queuedTurns || [])]);
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
      const modeInputs = form.querySelectorAll('[name="mode"]');
      modeInputs.forEach((input) => {
        input.addEventListener('change', () => applyCommitPushDefaults(form));
      });
      applyCommitPushDefaults(form);
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
    syncLiveActivityTurns(bootstrap.turns || []);
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
    syncLiveActivityTurns(bootstrap.turn ? [bootstrap.turn] : []);
    if (bootstrap.turn) {
      updateLiveActivityIndicators(bootstrap.turn.id, { renderEventPanels: true });
    }
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

  function initProfiles() {
    const createForm = document.getElementById('codex-profile-create');
    const status = document.getElementById('codex-profile-status');
    if (createForm) {
      createForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = createForm.querySelector('[type="submit"]');
        submit.disabled = true;
        setStatus(status, 'Saving...', '');
        try {
          await requestJson('/codex/api/profiles', {
            method: 'POST',
            body: JSON.stringify(formToPayload(createForm)),
          });
          setStatus(status, 'Profile added.', 'success');
          window.location.reload();
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      });
    }

    root.querySelectorAll('[data-profile-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          await requestJson(`/codex/api/profiles/${encodeURIComponent(form.dataset.profileForm)}`, {
            method: 'PATCH',
            body: JSON.stringify(formToPayload(form)),
          });
          window.location.reload();
        } catch (error) {
          alert(error.message || 'Unable to save profile.');
        } finally {
          submit.disabled = false;
        }
      });
    });
  }

  captureInitialProcessDetailState();
  bindPermissionControls(root);
  bindGlobalActions();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      pollLiveActivities().catch(() => {});
    }
  });

  if (root.dataset.codexPage === 'dashboard') {
    initDashboard();
  } else if (root.dataset.codexPage === 'session') {
    initSession();
  } else if (root.dataset.codexPage === 'turn') {
    initTurn();
  } else if (root.dataset.codexPage === 'workspaces') {
    initWorkspaces();
  } else if (root.dataset.codexPage === 'profiles') {
    initProfiles();
  }
})();
