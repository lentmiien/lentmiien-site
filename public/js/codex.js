(function () {
  function getPromptLengthState(value, maxCharacters) {
    const parsedMaximum = Number(maxCharacters);
    const maximum = Number.isFinite(parsedMaximum) && parsedMaximum > 0
      ? Math.floor(parsedMaximum)
      : 20000;
    const count = String(value === null || value === undefined ? '' : value).length;
    return {
      count,
      maximum,
      overLimit: count > maximum,
      label: `${count.toLocaleString()} / ${maximum.toLocaleString()} characters`,
    };
  }

  function canSubmitAdditionalMessage(turn) {
    return Boolean(
      turn &&
      turn.status === 'running' &&
      !turn.cancelRequestedAt &&
      turn.canAddMessage === true
    );
  }

  function filterPromptTemplatesByWorkspace(templates, workspaceId) {
    const selectedWorkspaceId = String(workspaceId || '').trim();
    return (Array.isArray(templates) ? templates : []).filter((template) => {
      const templateWorkspaceId = String(template?.workspaceId || '').trim();
      return !templateWorkspaceId ||
        (Boolean(selectedWorkspaceId) && templateWorkspaceId === selectedWorkspaceId);
    });
  }

  function extractEventItem(event) {
    const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
    if (payload.item && typeof payload.item === 'object') {
      return payload.item;
    }
    if (payload.payload?.item && typeof payload.payload.item === 'object') {
      return payload.payload.item;
    }
    return null;
  }

  function eventItemType(event) {
    const presentedType = event?.kind || event?.presentation?.kind || event?.presentation?.itemType;
    const item = extractEventItem(event);
    return String(presentedType || item?.type || '').trim().toLowerCase();
  }

  function normalizeFileChangeKind(value) {
    const kind = value && typeof value === 'object' ? value.type : value;
    return String(kind || '').trim().toLowerCase();
  }

  function isFocusedProcessEvent(event) {
    if (event?.category) {
      return event.category !== 'telemetry';
    }
    return ['agent_message', 'reasoning', 'todo_list', 'user_message'].includes(eventItemType(event));
  }

  function hasRenderedHtmlContent(value) {
    const html = String(value || '').trim();
    if (!html) {
      return false;
    }

    const text = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&(?:nbsp|#0*160|#x0*a0);/gi, ' ')
      .trim();
    return Boolean(text) || /<hr\b/i.test(html);
  }

  function hasFocusedProcessEventContent(event) {
    if (event?.summary || event?.details) {
      return Boolean(String(event.summary || '').trim()) || Object.keys(event.details || {}).length > 0;
    }
    const itemType = eventItemType(event);
    const item = extractEventItem(event);
    const presentation = event?.presentation && typeof event.presentation === 'object'
      ? event.presentation
      : {};

    if (itemType === 'agent_message' || itemType === 'reasoning') {
      return typeof presentation.html === 'string'
        ? hasRenderedHtmlContent(presentation.html)
        : Boolean(String(item?.text || '').trim());
    }

    if (itemType === 'user_message') {
      return Boolean(String(presentation.text || item?.text || '').trim());
    }

    if (itemType === 'todo_list') {
      const todos = Array.isArray(presentation.items)
        ? presentation.items
        : (Array.isArray(item?.items) ? item.items : []);
      return todos.some((todo) => Boolean(String(todo?.text || '').trim()));
    }

    return false;
  }

  function selectFocusedProcessEvents(events) {
    const messages = [];
    let latestTodo = null;

    (Array.isArray(events) ? events : []).forEach((event) => {
      const itemType = eventItemType(event);
      if (itemType === 'todo_list') {
        latestTodo = event;
      } else if (isFocusedProcessEvent(event) && hasFocusedProcessEventContent(event)) {
        messages.push(event);
      }
    });

    if (latestTodo && hasFocusedProcessEventContent(latestTodo)) {
      messages.push(latestTodo);
    }
    return messages;
  }

  function summarizeEditedFiles(events) {
    const filesByPath = new Map();

    (Array.isArray(events) ? events : []).forEach((event) => {
      if (!['file_change', 'files'].includes(eventItemType(event))) {
        return;
      }
      const item = extractEventItem(event);
      const presentation = event?.presentation && typeof event.presentation === 'object'
        ? event.presentation
        : {};
      const changes = Array.isArray(event?.details?.changes)
        ? event.details.changes
        : (Array.isArray(presentation.changes)
        ? presentation.changes
        : (Array.isArray(item?.changes) ? item.changes : []));

      changes.forEach((change) => {
        const filePath = String(change?.path || '').trim();
        if (!filePath) {
          return;
        }
        if (!filesByPath.has(filePath)) {
          filesByPath.set(filePath, {
            path: filePath,
            destination: String(change?.destination || '').trim(),
            kinds: [],
            additions: 0,
            deletions: 0,
          });
        }
        const kind = normalizeFileChangeKind(change?.kind);
        const file = filesByPath.get(filePath);
        if (kind && !file.kinds.includes(kind)) {
          file.kinds.push(kind);
        }
        file.destination = String(change?.destination || file.destination || '').trim();
        file.additions += Number(change?.additions) || 0;
        file.deletions += Number(change?.deletions) || 0;
      });
    });

    return Array.from(filesByPath.values())
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  function isErrorProcessEvent(event) {
    if (event?.isIssue === true) {
      return true;
    }
    const eventType = String(event?.eventType || '').trim().toLowerCase();
    const stream = String(event?.stream || '').trim().toLowerCase();
    const severity = String(event?.severity || '').trim().toLowerCase();

    if (eventType === 'stderr.line' || stream === 'stderr') {
      return true;
    }
    if (['error', 'fatal', 'critical'].includes(severity)) {
      return true;
    }

    const errorEventTokens = new Set(['error', 'failed', 'failure', 'fatal', 'panic']);
    if (eventType.split(/[._:-]+/).some((token) => errorEventTokens.has(token))) {
      return true;
    }

    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const nestedPayload = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
    const item = extractEventItem(event) || {};
    const errorStatuses = new Set(['error', 'failed', 'failure', 'fatal', 'blocked', 'rejected', 'timed_out']);
    return [event?.status, payload.status, nestedPayload.status, item.status]
      .some((status) => errorStatuses.has(String(status || '').trim().toLowerCase()));
  }

  function selectErrorProcessEvents(events) {
    return (Array.isArray(events) ? events : []).filter(isErrorProcessEvent);
  }

  function activityEventKey(event) {
    const itemId = String(event?.itemId || '');
    const kind = String(event?.kind || eventItemType(event) || 'event');
    return itemId ? `${kind}:${itemId}` : `seq:${Number(event?.seq) || 0}`;
  }

  function mergeActivityEvents(currentEvents, incomingEvents) {
    const merged = Array.isArray(currentEvents) ? currentEvents.map((event) => ({ ...event })) : [];
    const bySequence = new Map(merged.map((event, index) => [Number(event.seq) || 0, index]));
    const activeByItem = new Map();
    merged.forEach((event, index) => {
      if (event?.itemId && event.phase === 'started') {
        activeByItem.set(activityEventKey(event), index);
      }
    });

    (Array.isArray(incomingEvents) ? incomingEvents : []).forEach((event) => {
      const sequence = Number(event?.seq) || 0;
      if (bySequence.has(sequence)) {
        merged[bySequence.get(sequence)] = { ...merged[bySequence.get(sequence)], ...event };
        return;
      }
      const key = activityEventKey(event);
      if (event?.itemId && event.phase !== 'started' && activeByItem.has(key)) {
        const index = activeByItem.get(key);
        const started = merged[index];
        const startedAt = started.startedAt || started.timestamp || null;
        const completedAt = event.completedAt || event.timestamp || null;
        let durationMs = event.durationMs;
        if ((durationMs === null || durationMs === undefined) && startedAt && completedAt) {
          const calculated = new Date(completedAt).getTime() - new Date(startedAt).getTime();
          if (Number.isFinite(calculated) && calculated >= 0) durationMs = calculated;
        }
        merged[index] = {
          ...started,
          ...event,
          startedSeq: started.seq,
          startedAt,
          completedAt,
          durationMs,
          details: { ...(started.details || {}), ...(event.details || {}) },
        };
        activeByItem.delete(key);
        bySequence.set(sequence, index);
        return;
      }
      const index = merged.length;
      merged.push({ ...event });
      bySequence.set(sequence, index);
      if (event?.itemId && event.phase === 'started') activeByItem.set(key, index);
    });

    return merged.sort((left, right) => (Number(left.seq) || 0) - (Number(right.seq) || 0));
  }

  function summarizeActivityEvents(events) {
    const list = Array.isArray(events) ? events : [];
    return {
      activity: list.length,
      issues: list.filter((event) => event?.isIssue).length,
      messages: list.filter((event) => event?.category === 'message').length,
      actions: list.filter((event) => ['work', 'collaboration'].includes(event?.category)).length,
    };
  }

  function unexpectedResponseMessage(response, text) {
    const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
    const responseUrl = String(response?.url || '');
    if (response?.redirected && /\/login(?:[?#]|$)/i.test(responseUrl)) {
      return 'Your session expired. Reload the page and sign in again.';
    }
    if (contentType.includes('text/html') || /^\s*(?:<!doctype\s+html|<html\b)/i.test(String(text || ''))) {
      return 'The server returned a page instead of an API response. Reload this page and try again.';
    }
    return text || 'Unexpected server response.';
  }

  if (typeof module === 'object' && module.exports && typeof document === 'undefined') {
    module.exports = {
      canSubmitAdditionalMessage,
      buildActivityRows,
      filterPromptTemplatesByWorkspace,
      getPromptLengthState,
      mergeActivityEvents,
      selectErrorProcessEvents,
      selectFocusedProcessEvents,
      summarizeActivityEvents,
      summarizeEditedFiles,
      unexpectedResponseMessage,
    };
    return;
  }

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
  const HEALTH_OMITTED_KEYS = new Set([
    'reasoningEfforts',
    'codexModelOptions',
    'localModelOptions',
    'modelProviderOptions',
  ]);
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
    ollamaReservation: 'Ollama GPU reservation',
    held: 'Held',
    service: 'Service',
    reservationId: 'Reservation ID',
    idleTimeoutSec: 'Reservation idle timeout',
  };
  const LIVE_ACTIVITY_POLL_MS = 2000;
  const LIVE_ACTIVITY_HIGHLIGHT_MS = 1400;
  const RAW_EVENT_PAGE_SIZE = 100;
  const EVENT_ORDER_STORAGE_KEY = 'codex.turn.activityOrder';
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
    if (value < 10000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}s`;
    if (value < 60000) return `${Math.round(value / 1000)}s`;
    if (value < 3600000) {
      const minutes = Math.floor(value / 60000);
      const seconds = Math.floor((value % 60000) / 1000);
      return `${minutes}m${seconds ? ` ${seconds}s` : ''}`;
    }
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

  function modelProviderLabel(turn) {
    if (turn && turn.modelProviderLabel) return turn.modelProviderLabel;
    const provider = String(turn && turn.modelProvider || '').trim();
    if (provider === 'ollama') return 'Ollama';
    if (provider === 'runpod-qwen') return 'Qwen (Runpod)';
    if (provider === 'runpod-glm') return 'GLM-5.3 Flash (Runpod)';
    return 'OpenAI';
  }

  function usageProviderLabel(turn) {
    const provider = String(
      turn && (turn.usageProvider || turn.costEstimate?.provider || turn.modelProvider) || ''
    ).trim();
    return provider === 'openai' ? 'OpenAI' : 'Ollama';
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
      return { ok: false, error: unexpectedResponseMessage(response, text) };
    }
  }

  async function requestJson(url, options) {
    const method = String(options && options.method || 'GET').toUpperCase();
    const csrfHeaders = !['GET', 'HEAD'].includes(method) && bootstrap.csrfToken
      ? { 'X-CSRF-Token': bootstrap.csrfToken }
      : {};
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options && options.headers ? options.headers : {}),
        ...csrfHeaders,
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
        viewMode: 'activity',
        order: readStoredEventOrder(),
        paused: false,
        pendingNewCount: 0,
        rawEvents: [],
        rawLoaded: false,
        rawLoading: false,
        rawHasMore: false,
        rawBeforeSeq: null,
        rawErrorMessage: '',
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
    if (event?.summary) return String(event.summary);
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

  function normalizeEventViewMode(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'focused') return 'activity';
    if (normalized === 'errors') return 'issues';
    if (normalized === 'all') return 'raw';
    return ['activity', 'issues', 'raw'].includes(normalized) ? normalized : 'activity';
  }

  function readStoredEventOrder() {
    try {
      return window.localStorage.getItem(EVENT_ORDER_STORAGE_KEY) === 'chronological'
        ? 'chronological'
        : 'newest';
    } catch (_error) {
      return 'newest';
    }
  }

  function storeEventOrder(order) {
    try {
      window.localStorage.setItem(EVENT_ORDER_STORAGE_KEY, order);
    } catch (_error) {
      // A private browsing policy may disable local storage.
    }
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
    const latestTimestamp = latest && (latest.timestamp || latest.completedAt || latest.startedAt);
    let heading = 'Codex is working';
    if (state.failureCount >= 2) {
      heading = 'Reconnecting to activity feed';
    } else if (state.highlightUntil > Date.now()) {
      heading = 'New process detail';
    } else if (latest) {
      const eventTime = new Date(latestTimestamp || 0).getTime();
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
      summary: `Detail #${latest.seq} · ${describeProcessEvent(latest)} · ${formatActivityAge(latestTimestamp)}`,
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

  function updateEventViewButtons(turnId, viewMode) {
    const selectedMode = normalizeEventViewMode(viewMode);
    root.querySelectorAll(`[data-action="set-event-view"][data-turn-id="${CSS.escape(turnId)}"]`).forEach((button) => {
      const selected = button.dataset.eventViewMode === selectedMode;
      if (button.getAttribute('role') === 'tab') {
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
      } else {
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      }
    });
  }

  function setEventViewMode(turnId, viewMode) {
    const selectedMode = normalizeEventViewMode(viewMode);
    const state = getLiveActivityState(turnId);
    state.viewMode = selectedMode;
    if (root.dataset.codexPage === 'turn') {
      root.querySelectorAll('[data-process-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.processPanel !== selectedMode;
      });
      updateEventViewButtons(turnId, selectedMode);
      if (selectedMode === 'raw') {
        renderRawEvents(turnId);
        if (!state.rawLoaded) loadRawTurnEvents(turnId).catch(() => {});
      } else {
        renderOperationalPanels(turnId, { force: true });
      }
      return;
    }
    root.querySelectorAll(`[data-events-for="${CSS.escape(turnId)}"]`).forEach((container) => {
      container.dataset.eventViewMode = selectedMode;
      renderEvents(container, state.events, {
        errorMessage: state.errorMessage,
        isRunning: state.status === 'running',
        loaded: state.loaded,
      });
    });
    updateEventViewButtons(turnId, selectedMode);
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
      const latestTimestamp = state.latestEvent && (
        state.latestEvent.timestamp || state.latestEvent.completedAt || state.latestEvent.startedAt
      );
      if (latestTimestamp) {
        indicator.title = `Latest process detail: ${formatDate(latestTimestamp)}`;
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
      if (root.dataset.codexPage === 'turn') {
        renderOperationalPanels(turnId, {
          force: options.force,
          newSeqs: options.newSeqs,
        });
        return;
      }
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
      const knownSeqs = new Set(state.events.flatMap((event) => [
        Number(event.seq) || 0,
        Number(event.startedSeq) || 0,
      ]));
      const incoming = (payload.events || [])
        .filter((event) => !knownSeqs.has(Number(event.seq) || 0))
        .sort((left, right) => Number(left.seq) - Number(right.seq));
      const newSeqs = new Set(initialLoad ? [] : incoming.map((event) => Number(event.seq) || 0));
      if (incoming.length) {
        state.events = mergeActivityEvents(state.events, incoming);
        state.latestEvent = state.events.reduce((latest, event) => (
          !latest || Number(event.seq) > Number(latest.seq) ? event : latest
        ), null);
        state.lastSeq = Math.max(
          state.lastSeq,
          Number(payload.lastSeq) || 0,
          ...incoming.map((event) => Number(event.seq) || 0)
        );
        state.reportedCount = Math.max(state.reportedCount, state.lastSeq);
        state.highlightUntil = Date.now() + LIVE_ACTIVITY_HIGHLIGHT_MS;
        if (!initialLoad && root.dataset.codexPage === 'turn' && turnFeedIsInspectingHistory(turnId)) {
          state.pendingNewCount += incoming.length;
        }
      } else if (state.events.length) {
        state.latestEvent = state.events.reduce((latest, event) => (
          !latest || Number(event.seq) > Number(latest.seq) ? event : latest
        ), null);
        state.lastSeq = Math.max(state.lastSeq, Number(payload.lastSeq) || 0, Number(state.latestEvent.seq) || 0);
      }
      state.lastSeq = Math.max(state.lastSeq, Number(payload.lastSeq) || 0);
      if (payload.counts?.raw) state.reportedCount = Math.max(state.reportedCount, Number(payload.counts.raw) || 0);
      state.loaded = true;
      state.failureCount = 0;
      state.errorMessage = '';
      updateLiveActivityIndicators(turnId, {
        announce: incoming.length > 0,
        newSeqs,
        renderEventPanels: initialLoad || (incoming.length > 0 && state.pendingNewCount === 0),
        force: initialLoad,
      });
      updateOperationalSummary(turnId);
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
    await Promise.all(liveActivityTurns
      .filter((turn) => !getLiveActivityState(turn.id).paused)
      .map((turn) => loadTurnActivity(turn.id)));
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
      container.dataset.eventViewMode = normalizeEventViewMode(container.dataset.eventViewMode);
      state.viewMode = container.dataset.eventViewMode;
      updateProcessDetailButtons(state.turnId);
      updateEventViewButtons(state.turnId, container.dataset.eventViewMode);
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

  function bindPromptLengthControl(form) {
    if (!form) return null;
    const prompt = form.querySelector('[data-codex-prompt-input]');
    const counter = form.querySelector('[data-codex-character-count]');
    const submit = form.querySelector('[data-codex-prompt-submit]');
    if (!prompt) return null;

    const initiallyDisabled = Boolean(submit && submit.disabled);
    let submitting = false;

    function sync() {
      const state = getPromptLengthState(
        prompt.value,
        prompt.dataset.maxCharacters || prompt.maxLength,
      );
      if (counter) {
        counter.textContent = state.label;
        if (state.overLimit) {
          counter.dataset.tone = 'error';
        } else {
          delete counter.dataset.tone;
        }
      }

      const validationMessage = state.overLimit
        ? `Prompt is too long. Maximum length is ${state.maximum.toLocaleString()} characters.`
        : '';
      prompt.setCustomValidity(validationMessage);
      if (state.overLimit) {
        prompt.setAttribute('aria-invalid', 'true');
      } else {
        prompt.removeAttribute('aria-invalid');
      }
      if (submit) {
        submit.disabled = initiallyDisabled || submitting || state.overLimit;
      }
      return state;
    }

    prompt.addEventListener('input', sync);
    form.addEventListener('reset', () => {
      setTimeout(sync, 0);
    });
    sync();

    return {
      sync,
      setSubmitting(value) {
        submitting = Boolean(value);
        sync();
      },
    };
  }

  function initNewRequestMaximize() {
    const panel = document.getElementById('codex-new-request-panel');
    const button = document.getElementById('codex-new-request-maximize');
    if (!panel || !button) return;

    button.addEventListener('click', () => {
      const maximized = !panel.classList.contains('codex-panel--maximized');
      panel.classList.toggle('codex-panel--maximized', maximized);
      button.setAttribute('aria-pressed', maximized ? 'true' : 'false');
      button.textContent = maximized ? 'Restore' : 'Maximize';
      button.title = maximized ? 'Restore the default panel size' : 'Maximize the New Request panel';
    });
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

  function availablePromptTemplates() {
    const templates = Array.isArray(bootstrap.promptTemplates)
      ? bootstrap.promptTemplates
      : bootstrap.templates;
    return Array.isArray(templates) ? templates : [];
  }

  function promptTemplateOptionCount(select) {
    if (!select) return 0;
    return Array.from(select.options).filter((option) => Boolean(option.value)).length;
  }

  function syncPromptTemplateHelp(select) {
    if (!select) return;
    const help = select.closest('.codex-field')?.querySelector('[data-codex-template-help]');
    if (!help) return;
    help.textContent = promptTemplateOptionCount(select)
      ? 'Choose a template to copy it into the prompt.'
      : 'Save a global or workspace-specific prompt in the Prompt Library.';
  }

  function renderPromptTemplateOptions(select, templates) {
    if (!select) return;
    const availableTemplates = Array.isArray(templates) ? templates : [];
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = availableTemplates.length
      ? 'Select a template…'
      : 'No templates available for this workspace';
    select.appendChild(placeholder);

    availableTemplates.forEach((template) => {
      const option = document.createElement('option');
      option.value = String(template.id || '');
      option.textContent = template.name || 'Untitled template';
      select.appendChild(option);
    });
    select.disabled = availableTemplates.length === 0;
    syncPromptTemplateHelp(select);
  }

  function bindDashboardPromptTemplateFilter() {
    const workspaceSelect = document.getElementById('codex-workspace');
    if (!workspaceSelect) return;

    const sync = () => {
      const templates = filterPromptTemplatesByWorkspace(
        availablePromptTemplates(),
        workspaceSelect.value,
      );
      root.querySelectorAll('[data-codex-template-select]').forEach((select) => {
        renderPromptTemplateOptions(select, templates);
      });
    };

    workspaceSelect.addEventListener('change', sync);
    sync();
  }

  function resetPromptTemplateSelection(form) {
    if (!form) return;
    form.querySelectorAll('[data-codex-template-select]').forEach((select) => {
      select.value = '';
      syncPromptTemplateHelp(select);
    });
  }

  function bindPromptTemplateSelectors(scope) {
    const templateById = new Map(availablePromptTemplates().map((template) => [String(template.id), template]));
    scope.querySelectorAll('[data-codex-template-select]').forEach((select) => {
      select.addEventListener('change', () => {
        const template = templateById.get(String(select.value || ''));
        const help = select.closest('.codex-field')?.querySelector('[data-codex-template-help]');
        if (!template) {
          syncPromptTemplateHelp(select);
          return;
        }

        const prompt = document.getElementById(select.dataset.promptTarget || '');
        if (!prompt) return;
        prompt.value = template.prompt || '';
        prompt.dispatchEvent(new Event('input', { bubbles: true }));
        prompt.focus();
        prompt.setSelectionRange(prompt.value.length, prompt.value.length);
        if (help) {
          help.textContent = template.description || `Copied “${template.name}” into the prompt.`;
        }
      });
    });
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

  function syncModelProviderControls(form) {
    if (!form) return;
    const provider = form.querySelector('[data-codex-model-provider]');
    if (!provider) return;
    const selectedOption = provider.options[provider.selectedIndex];
    const controlMode = selectedOption?.dataset.controlMode || (
      provider.value === 'ollama' ? 'local-model' : 'openai-profile'
    );
    const usesOpenAiProfile = controlMode === 'openai-profile';
    const usesLocalModel = controlMode === 'local-model';
    const openaiControls = form.querySelector('[data-codex-openai-model-controls]');
    const localControls = form.querySelector('[data-codex-local-model-controls]');
    const providerHelp = form.querySelector('[data-codex-model-provider-help]');
    if (openaiControls) {
      openaiControls.hidden = !usesOpenAiProfile;
      openaiControls.querySelectorAll('input, select, textarea').forEach((control) => {
        control.disabled = !usesOpenAiProfile;
      });
    }
    if (localControls) {
      localControls.hidden = !usesLocalModel;
      localControls.querySelectorAll('input, select, textarea').forEach((control) => {
        control.disabled = !usesLocalModel;
        if (control.name === 'model') {
          control.required = usesLocalModel;
        }
      });
    }
    if (providerHelp && selectedOption?.dataset.description) {
      providerHelp.textContent = selectedOption.dataset.description;
    }
  }

  function bindModelProviderControls(scope) {
    scope.querySelectorAll('form').forEach((form) => {
      const provider = form.querySelector('[data-codex-model-provider]');
      if (!provider) return;
      provider.addEventListener('change', () => syncModelProviderControls(form));
      syncModelProviderControls(form);
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
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
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
      grid.appendChild(renderMetricCard('OpenAI Cost', formatMoney(summary.cost), (pricing?.openai?.currency || pricing?.currency) || 'USD'));
      grid.appendChild(renderMetricCard('Ollama Cost', formatMoney(summary.ollamaCost), pricing?.ollama?.currency || 'USD'));
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
        row.appendChild(createEl('td', { colspan: '9', text: 'No token usage recorded for the last 3 months.' }));
        monthlyBody.appendChild(row);
      } else {
        months.forEach((month) => {
          const row = createEl('tr');
          row.appendChild(tableCell('Month', { text: month.label || month.key || '-' }));
          row.appendChild(tableCell('Turns', { text: formatNumber(month.turnCount) }));
          row.appendChild(tableCell('Sessions', { text: formatNumber(month.sessionCount) }));
          const tokens = normalizeTokens(month.tokens);
          TOKEN_TYPES.forEach((type) => row.appendChild(tableCell(TOKEN_LABELS[type], { text: formatNumber(tokens[type]) })));
          row.appendChild(tableCell('OpenAI Cost', { text: formatMoney(month.cost) }));
          row.appendChild(tableCell('Ollama Cost', { text: formatMoney(month.ollamaCost) }));
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
        row.appendChild(createEl('td', { colspan: '11', text: 'No workspace activity recorded for the last 3 months.' }));
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
          row.appendChild(tableCell('OpenAI Cost', { text: formatMoney(workspace.cost) }));
          row.appendChild(tableCell('Ollama Cost', { text: formatMoney(workspace.ollamaCost) }));
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
    const costs = createEl('div', { className: 'codex-panel__header-actions' });
    costs.appendChild(createEl('span', { className: 'codex-chip', text: `OpenAI ${formatMoney(current.cost)}` }));
    costs.appendChild(createEl('span', { className: 'codex-chip', text: `Ollama ${formatMoney(current.ollamaCost)}` }));
    header.appendChild(costs);
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
    renderDashboardStats(statsPayload.stats, statsPayload.pricingByProvider || statsPayload.pricing);
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
      turn.requestProfileName || turn.profile ? `Profile ${turn.requestProfileName || turn.profile}` : '',
      `Provider ${modelProviderLabel(turn)}`,
      turn.model ? `Model ${turn.model}` : '',
      turn.reasoningEffort ? `Reasoning ${turn.reasoningEffort}` : '',
      `Queued ${formatDate(turn.queuedAt)}`,
      `Duration ${formatDuration(turn.durationMs)}`,
      `${usageProviderLabel(turn)} cost ${formatMoney(turn.costEstimate && turn.costEstimate.total)}`,
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
    syncAdditionalMessageForm(turn);
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
    const errorText = root.querySelector('[data-turn-error]');
    if (errorText) {
      errorText.textContent = turn.errorMessage || '';
      errorText.hidden = !turn.errorMessage;
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
        ['Profile', turn.requestProfileName || turn.profile || '-'],
        ['Provider', modelProviderLabel(turn)],
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
        [`Turn ${usageProviderLabel(turn)} Estimated Cost`, formatMoney(turn.costEstimate && turn.costEstimate.total)],
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
    if (root.dataset.codexPage === 'turn') {
      renderOperationalPanels(turn.id, { force: activityState.pendingNewCount === 0 });
    } else {
      root.querySelectorAll(`[data-events-for="${CSS.escape(turn.id)}"]`).forEach((eventsContainer) => {
        if (!eventsContainer.hidden && activityState.detailsOpen) {
          renderEvents(eventsContainer, activityState.events, {
            errorMessage: activityState.errorMessage,
            isRunning: turn.status === 'running',
            loaded: activityState.loaded,
          });
        }
      });
    }
    updateProcessDetailButtons(turn.id);
  }

  async function refreshTurn() {
    const turnId = root.dataset.turnId;
    if (!turnId) return null;
    const payload = await requestJson(`/codex/api/turns/${encodeURIComponent(turnId)}`);
    bootstrap.turn = payload.turn;
    syncLiveActivityTurns([payload.turn]);
    renderTurnDetail(payload.turn, payload.workspace);
    return payload;
  }

  function syncAdditionalMessageForm(turn) {
    const panel = root.querySelector('[data-additional-message-panel]');
    if (!panel) return;
    const form = panel.querySelector('#codex-additional-message-form');
    const field = form && form.querySelector('[name="message"]');
    const submit = form && form.querySelector('[type="submit"]');
    const state = panel.querySelector('[data-additional-message-state]');
    const available = canSubmitAdditionalMessage(turn);
    const submitting = form?.dataset.submitting === 'true';

    panel.hidden = !available;
    if (field) field.disabled = !available || submitting;
    if (submit) submit.disabled = !available || submitting;
    if (state) {
      state.textContent = available ? 'Running' : 'Closed';
    }
  }

  function activityDate(event) {
    const value = event?.timestamp || event?.completedAt || event?.startedAt;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function formatActivityClock(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '--:--:--';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatActivityOffset(value) {
    const startValue = bootstrap.turn?.startedAt || bootstrap.turn?.queuedAt;
    const start = startValue ? new Date(startValue).getTime() : NaN;
    const current = value ? new Date(value).getTime() : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(current)) return '';
    const seconds = Math.max(0, Math.round((current - start) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `+${minutes}:${String(remainder).padStart(2, '0')}`;
  }

  function activityStatusGlyph(status) {
    if (status === 'running') return '●';
    if (status === 'succeeded') return '✓';
    if (['failed', 'timed_out'].includes(status)) return '×';
    if (['blocked', 'warning'].includes(status)) return '!';
    if (status === 'cancelled') return '–';
    return '·';
  }

  function activityRowKey(event) {
    return `activity:${activityEventKey(event)}`;
  }

  function buildActivityRows(events, mode, order) {
    const visible = (Array.isArray(events) ? events : [])
      .filter((event) => mode !== 'issues' || event?.isIssue)
      .sort((left, right) => {
        const leftTime = activityDate(left)?.getTime() || 0;
        const rightTime = activityDate(right)?.getTime() || 0;
        return leftTime - rightTime || (Number(left.seq) || 0) - (Number(right.seq) || 0);
      });
    const rows = [];
    visible.forEach((event, index) => {
      rows.push({ type: 'activity', key: activityRowKey(event), event });
      const next = visible[index + 1];
      if (!next) return;
      const currentTime = activityDate(event)?.getTime();
      const nextTime = activityDate(next)?.getTime();
      const gapMs = Number.isFinite(currentTime) && Number.isFinite(nextTime) ? nextTime - currentTime : 0;
      if (mode !== 'issues' && gapMs >= 10000) {
        rows.push({
          type: 'gap',
          key: `gap:${Number(event.seq) || 0}:${Number(next.seq) || 0}`,
          gapMs,
        });
      }
    });
    return order === 'chronological' ? rows : rows.reverse();
  }

  function appendDefinitionRow(list, label, value, code) {
    if (value === null || value === undefined || String(value) === '') return;
    const row = createEl('div', { className: 'codex-activity-detail__row' });
    row.appendChild(createEl('dt', { text: label }));
    const description = createEl('dd');
    description.appendChild(createEl(code ? 'code' : 'span', { text: String(value) }));
    row.appendChild(description);
    list.appendChild(row);
  }

  function safeBrowserUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
    } catch (_error) {
      return '';
    }
  }

  function appendLinkDefinitionRow(list, label, value) {
    const href = safeBrowserUrl(value);
    if (!href) return;
    const row = createEl('div', { className: 'codex-activity-detail__row' });
    row.appendChild(createEl('dt', { text: label }));
    const description = createEl('dd');
    description.appendChild(createEl('a', {
      href,
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
      text: href,
    }));
    row.appendChild(description);
    list.appendChild(row);
  }

  function appendStructuredPre(container, label, value) {
    if (value === null || value === undefined || value === '' ||
      (typeof value === 'object' && Object.keys(value).length === 0)) return;
    container.appendChild(createEl('h4', { text: label }));
    container.appendChild(createEl('pre', {
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }));
  }

  function appendActivityDetails(container, event) {
    const details = event?.details || {};
    const metadata = createEl('dl', { className: 'codex-activity-detail__meta' });
    appendDefinitionRow(metadata, 'Working directory', details.cwd, true);
    appendDefinitionRow(metadata, 'Exit code', details.exitCode, false);
    appendDefinitionRow(metadata, 'Tool', details.toolName, true);
    appendDefinitionRow(metadata, 'Source', details.source, false);
    appendDefinitionRow(metadata, 'Plugin', details.plugin, true);
    appendDefinitionRow(metadata, 'Artifact', details.artifact, true);
    appendDefinitionRow(metadata, 'Model', details.model, false);
    appendDefinitionRow(metadata, 'Effort', details.reasoningEffort, false);
    appendDefinitionRow(metadata, 'Agent', details.agentPath, true);
    appendDefinitionRow(metadata, 'Delivery', details.delivery, false);
    appendDefinitionRow(metadata, 'Access', details.readOnly === true ? 'Read-only' : '', false);
    appendDefinitionRow(metadata, 'Query', details.query, false);
    appendLinkDefinitionRow(metadata, 'Page', details.url);
    appendDefinitionRow(metadata, 'Pattern', details.pattern, false);
    if (metadata.hasChildNodes()) container.appendChild(metadata);

    appendStructuredPre(container, 'Command', details.command);
    appendStructuredPre(container, 'Output', details.output);
    appendStructuredPre(container, 'Arguments', details.arguments);
    appendStructuredPre(container, 'Result', details.result);
    appendStructuredPre(container, 'Error', details.error || details.failure || details.message);
    appendStructuredPre(container, 'Agent prompt', details.prompt);
    appendStructuredPre(container, 'Review', details.review);
    appendStructuredPre(container, 'Plan note', details.explanation);

    if (Array.isArray(details.actions) && details.actions.length) {
      const section = createEl('div', { className: 'codex-activity-actions' });
      section.appendChild(createEl('h4', { text: 'Detected actions' }));
      const list = createEl('ul');
      details.actions.forEach((action) => {
        list.appendChild(createEl('li', {
          text: [action.type, action.path || action.name, action.query].filter(Boolean).join(' · '),
        }));
      });
      section.appendChild(list);
      container.appendChild(section);
    }

    if (Array.isArray(details.changes) && details.changes.length) {
      const section = createEl('div', { className: 'codex-activity-changes' });
      section.appendChild(createEl('h4', { text: 'Changed files' }));
      const list = createEl('ul');
      details.changes.forEach((change) => {
        const row = createEl('li');
        row.appendChild(createEl('code', { text: change.path || 'File' }));
        const changeSummary = [
          change.kind || 'update',
          change.destination ? `→ ${change.destination}` : '',
          change.additions || change.deletions ? `+${change.additions || 0} / −${change.deletions || 0}` : '',
        ].filter(Boolean).join(' · ');
        row.appendChild(createEl('span', { text: changeSummary }));
        if (change.diff) {
          const diff = createEl('details');
          diff.appendChild(createEl('summary', { text: 'Diff' }));
          diff.appendChild(createEl('pre', { text: change.diff }));
          row.appendChild(diff);
        }
        list.appendChild(row);
      });
      section.appendChild(list);
      container.appendChild(section);
    }

    if (Array.isArray(details.agents) && details.agents.length) {
      const section = createEl('div', { className: 'codex-activity-agents' });
      section.appendChild(createEl('h4', { text: 'Agents' }));
      const list = createEl('ul');
      details.agents.forEach((agent) => {
        list.appendChild(createEl('li', {
          text: [agent.path || 'Agent', agent.status, agent.message].filter(Boolean).join(' · '),
        }));
      });
      section.appendChild(list);
      container.appendChild(section);
    }

    if (Array.isArray(details.results) && details.results.length) {
      const section = createEl('div', { className: 'codex-activity-results' });
      section.appendChild(createEl('h4', { text: 'Results' }));
      const list = createEl('ul');
      details.results.forEach((result) => {
        const row = createEl('li');
        const href = safeBrowserUrl(result.url);
        if (href) {
          row.appendChild(createEl('a', {
            href,
            target: '_blank',
            rel: 'noopener noreferrer nofollow',
            text: result.title || result.domain || result.url,
          }));
        } else {
          row.textContent = result.title || result.domain || 'Result';
        }
        if (result.domain) row.appendChild(createEl('small', { text: result.domain }));
        list.appendChild(row);
      });
      section.appendChild(list);
      container.appendChild(section);
    }

    if (Array.isArray(details.questions) && details.questions.length) {
      const questionSection = createEl('div', { className: 'codex-activity-questions' });
      questionSection.appendChild(createEl('h4', { text: 'Questions' }));
      details.questions.forEach((question) => {
        const card = createEl('section');
        if (question.header) card.appendChild(createEl('strong', { text: question.header }));
        if (question.question) card.appendChild(createEl('p', { text: question.question }));
        if (Array.isArray(question.options) && question.options.length) {
          const list = createEl('ul');
          question.options.forEach((option) => {
            list.appendChild(createEl('li', {
              text: [option.label, option.description].filter(Boolean).join(' — '),
            }));
          });
          card.appendChild(list);
        }
        questionSection.appendChild(card);
      });
      container.appendChild(questionSection);
    }

    if (Array.isArray(details.memoryCitation) && details.memoryCitation.length) {
      const citations = createEl('div', { className: 'codex-activity-citations' });
      citations.appendChild(createEl('h4', { text: 'Memory citations' }));
      const list = createEl('ul');
      details.memoryCitation.forEach((citation) => {
        const lines = citation.lineStart === null
          ? ''
          : `:${citation.lineStart}${citation.lineEnd !== null && citation.lineEnd !== citation.lineStart ? `–${citation.lineEnd}` : ''}`;
        list.appendChild(createEl('li', {
          text: `${citation.path || 'Memory'}${lines}${citation.note ? ` — ${citation.note}` : ''}`,
        }));
      });
      citations.appendChild(list);
      container.appendChild(citations);
    }
  }

  function hasExpandableActivityDetails(event) {
    const details = event?.details || {};
    return [
      details.cwd, details.command, details.output, details.arguments, details.result, details.error,
      details.failure, details.message, details.prompt, details.review, details.artifact, details.model,
      details.agentPath, details.delivery, details.explanation, details.query, details.url, details.pattern,
    ].some((value) => value !== null && value !== undefined && value !== '' &&
      (typeof value !== 'object' || Object.keys(value).length > 0)) ||
      ['actions', 'agents', 'changes', 'results', 'questions', 'memoryCitation']
        .some((key) => Array.isArray(details[key]) && details[key].length);
  }

  function createActivityCard(event, isNew) {
    const status = String(event?.status || 'info');
    const wrapper = createEl('article', {
      className: [
        'codex-activity-card',
        `codex-activity-card--${String(event?.tone || 'neutral').replace(/[^a-z0-9_-]/gi, '-')}`,
        event?.isIssue ? 'codex-activity-card--issue' : '',
        isNew ? 'codex-event--new' : '',
      ].filter(Boolean).join(' '),
      'data-activity-row-key': activityRowKey(event),
      'data-activity-signature': JSON.stringify([
        event.seq, event.status, event.summary, event.durationMs, event.repeatCount, event.details,
      ]),
    });
    const time = createEl('div', { className: 'codex-activity-card__time' });
    if (status === 'running') {
      time.appendChild(createEl('strong', { text: 'NOW' }));
    } else {
      time.appendChild(createEl('time', {
        datetime: event.timestamp || '',
        title: event.timestamp ? formatDate(event.timestamp) : '',
        text: formatActivityClock(event.timestamp),
      }));
    }
    const offset = formatActivityOffset(event.timestamp);
    if (offset) time.appendChild(createEl('small', { text: offset }));
    wrapper.appendChild(time);

    const body = createEl('div', { className: 'codex-activity-card__body' });
    const eyebrow = createEl('div', { className: 'codex-activity-card__eyebrow' });
    eyebrow.appendChild(createEl('span', {
      className: `codex-activity-status codex-activity-status--${status}`,
      'aria-label': status.replace('_', ' '),
      text: activityStatusGlyph(status),
    }));
    eyebrow.appendChild(createEl('strong', { text: event.label || 'Process update' }));
    if (event.durationMs !== null && event.durationMs !== undefined) {
      eyebrow.appendChild(createEl('span', { text: formatDuration(event.durationMs) }));
    }
    if (event.repeatCount > 1) eyebrow.appendChild(createEl('span', { text: `×${event.repeatCount}` }));
    if (event.truncated) eyebrow.appendChild(createEl('span', { className: 'codex-truncated-badge', text: 'Truncated' }));
    body.appendChild(eyebrow);

    if (event.kind === 'agent_message' || event.kind === 'reasoning') {
      const markdown = createEl('div', { className: 'codex-event__markdown' });
      if (event.details?.html) {
        // This HTML is generated and allowlist-sanitized by the events API.
        markdown.innerHTML = event.details.html;
      } else {
        markdown.appendChild(createEl('p', { text: event.summary || '' }));
      }
      body.appendChild(markdown);
    } else if (event.kind === 'user_message') {
      body.appendChild(createEl('p', { className: 'codex-event__user-message', text: event.details?.text || event.summary || '' }));
    } else if (event.kind === 'file_change' && root.dataset.codexPage === 'turn') {
      body.appendChild(createEl('a', {
        className: 'codex-activity-card__summary codex-activity-card__summary-link',
        href: `#codex-changed-files-${bootstrap.turn.id}`,
        text: event.summary || 'File changes completed',
      }));
    } else {
      body.appendChild(createEl('p', { className: 'codex-activity-card__summary', text: event.summary || 'Process update' }));
    }

    if (hasExpandableActivityDetails(event)) {
      const disclosure = createEl('details', { className: 'codex-activity-detail' });
      disclosure.appendChild(createEl('summary', { text: 'Details' }));
      const detailsBody = createEl('div', { className: 'codex-activity-detail__body' });
      appendActivityDetails(detailsBody, event);
      disclosure.appendChild(detailsBody);
      body.appendChild(disclosure);
    }
    wrapper.appendChild(body);
    return wrapper;
  }

  function createGapRow(row) {
    const seconds = Math.round(row.gapMs / 1000);
    return createEl('div', {
      className: `codex-activity-gap${row.gapMs >= 30000 ? ' codex-activity-gap--long' : ''}`,
      'data-activity-row-key': row.key,
      'data-activity-signature': String(seconds),
    }, [createEl('span', { text: `No reported detail for ${seconds}s` })]);
  }

  function reconcileActivityRows(container, rows, newSeqs) {
    const existing = new Map(Array.from(container.children)
      .filter((child) => child.dataset?.activityRowKey)
      .map((child) => [child.dataset.activityRowKey, child]));
    const desiredNodes = rows.map((row) => {
      const current = existing.get(row.key);
      const signature = row.type === 'gap'
        ? String(Math.round(row.gapMs / 1000))
        : JSON.stringify([
          row.event.seq, row.event.status, row.event.summary, row.event.durationMs,
          row.event.repeatCount, row.event.details,
        ]);
      if (current && current.dataset.activitySignature === signature) {
        existing.delete(row.key);
        return current;
      }
      const replacement = row.type === 'gap'
        ? createGapRow(row)
        : createActivityCard(row.event, Boolean(newSeqs?.has(Number(row.event.seq) || 0)));
      if (current) {
        current.replaceWith(replacement);
        existing.delete(row.key);
      }
      return replacement;
    });
    existing.forEach((node) => node.remove());
    desiredNodes.forEach((node, index) => {
      const currentAtIndex = container.children[index];
      if (currentAtIndex !== node) container.insertBefore(node, currentAtIndex || null);
    });
  }

  function renderActivityFeed(container, events, options = {}) {
    const rows = buildActivityRows(events, options.mode || 'activity', options.order || 'newest');
    Array.from(container.children).filter((child) => !child.dataset?.activityRowKey).forEach((child) => child.remove());
    if (!rows.length) {
      const message = !options.loaded
        ? 'Loading activity…'
        : (options.mode === 'issues'
          ? 'No warnings, failures, cancellations, or truncation were reported.'
          : (options.isRunning ? 'Waiting for the first activity update…' : 'No readable activity was stored.'));
      container.appendChild(createEl('p', { className: 'codex-empty', text: message }));
    } else {
      reconcileActivityRows(container, rows, options.newSeqs);
    }
    if (options.errorMessage) {
      container.appendChild(createEl('p', {
        className: 'codex-events__notice codex-error-text',
        text: options.isRunning ? `${options.errorMessage} Retrying automatically.` : options.errorMessage,
      }));
    }
    if (options.isRunning && !options.paused) {
      const listener = createEl('div', {
        className: 'codex-events__live',
        'aria-label': 'Listening for more activity',
      });
      listener.appendChild(createEl('span', { className: 'codex-events__live-dot', 'aria-hidden': 'true' }));
      listener.appendChild(createEl('span', { text: 'Live · listening for work updates' }));
      container.appendChild(listener);
    }
  }

  function turnFeedIsInspectingHistory(turnId) {
    const state = getLiveActivityState(turnId);
    const container = root.querySelector(`[data-events-for="${CSS.escape(turnId)}"]`);
    if (!container || container.clientHeight === 0 || container.scrollHeight <= container.clientHeight + 20) return false;
    if (state.order === 'chronological') {
      return container.scrollHeight - container.scrollTop - container.clientHeight > 80;
    }
    return container.scrollTop > 80;
  }

  function updateNewUpdatesButton(turnId) {
    const state = getLiveActivityState(turnId);
    const button = root.querySelector(`[data-action="show-new-updates"][data-turn-id="${CSS.escape(turnId)}"]`);
    if (!button) return;
    button.hidden = state.pendingNewCount <= 0;
    button.textContent = `${state.pendingNewCount} new ${state.pendingNewCount === 1 ? 'update' : 'updates'}`;
  }

  function renderPlanSidebar(state) {
    const card = root.querySelector('[data-plan-sidebar]');
    if (!card) return;
    const content = card.querySelector('[data-plan-content]');
    const progress = card.querySelector('[data-plan-progress]');
    const latest = state.events.filter((event) => event.kind === 'plan').sort((a, b) => Number(b.seq) - Number(a.seq))[0];
    const items = latest?.details?.items || [];
    const complete = items.filter((item) => item.status === 'completed').length;
    progress.textContent = items.length ? `${complete} / ${items.length} complete` : 'Not reported';
    content.innerHTML = '';
    if (!items.length) {
      content.appendChild(createEl('p', { className: 'codex-empty', text: 'No plan reported.' }));
      return;
    }
    const list = createEl('ol', { className: 'codex-side-plan' });
    items.forEach((item) => {
      const row = createEl('li', { className: `codex-side-plan__item codex-side-plan__item--${item.status}` });
      row.appendChild(createEl('span', { 'aria-hidden': 'true', text: item.status === 'completed' ? '✓' : (item.status === 'inProgress' ? '●' : '○') }));
      row.appendChild(createEl('span', { text: item.text }));
      list.appendChild(row);
    });
    content.appendChild(list);
  }

  function renderFilesSidebar(state) {
    const card = root.querySelector('[data-files-sidebar]');
    if (!card) return;
    const content = card.querySelector('[data-files-content]');
    const count = card.querySelector('[data-files-count]');
    const files = summarizeEditedFiles(state.events);
    count.textContent = String(files.length);
    content.innerHTML = '';
    if (!files.length) {
      content.appendChild(createEl('p', { className: 'codex-empty', text: 'No file changes reported.' }));
      return;
    }
    const list = createEl('ul', { className: 'codex-side-files' });
    files.forEach((file) => {
      const row = createEl('li');
      const main = createEl('div');
      main.appendChild(createEl('code', { text: file.path }));
      if (file.destination) main.appendChild(createEl('small', { text: `→ ${file.destination}` }));
      row.appendChild(main);
      const meta = createEl('span', { className: 'codex-side-files__meta' });
      meta.appendChild(createEl('strong', { text: (file.kinds[0] || 'update').toUpperCase() }));
      if (file.additions || file.deletions) {
        meta.appendChild(createEl('small', { text: `+${file.additions} / −${file.deletions}` }));
      }
      row.appendChild(meta);
      list.appendChild(row);
    });
    content.appendChild(list);
  }

  function renderAgentsSidebar(state) {
    const card = root.querySelector('[data-agents-sidebar]');
    if (!card) return;
    const agentsByPath = new Map();
    state.events.filter((event) => event.kind === 'collaboration').forEach((event) => {
      (event.details?.agents || []).forEach((agent) => agentsByPath.set(agent.path, agent));
      if (event.details?.agentPath) {
        agentsByPath.set(event.details.agentPath, {
          path: event.details.agentPath,
          status: event.status,
        });
      }
    });
    const activeAgents = Array.from(agentsByPath.values()).filter((agent) => ['pending', 'running'].includes(agent.status));
    card.hidden = activeAgents.length === 0;
    if (!activeAgents.length) return;
    card.querySelector('[data-agents-count]').textContent = String(activeAgents.length);
    const content = card.querySelector('[data-agents-content]');
    content.innerHTML = '';
    const list = createEl('ul', { className: 'codex-side-agents' });
    activeAgents.forEach((agent) => {
      list.appendChild(createEl('li', {}, [
        createEl('code', { text: agent.path || 'Agent' }),
        createEl('span', { text: agent.status }),
      ]));
    });
    content.appendChild(list);
  }

  function renderActivityRibbon(state) {
    const ribbon = root.querySelector('[data-activity-ribbon]');
    const track = ribbon?.querySelector('.codex-activity-ribbon__track');
    if (!track) return;
    track.innerHTML = '';
    const start = new Date(bootstrap.turn?.startedAt || bootstrap.turn?.queuedAt || Date.now()).getTime();
    const end = new Date(bootstrap.turn?.completedAt || Date.now()).getTime();
    const span = Math.max(1, end - start);
    state.events.forEach((event) => {
      if (!['message', 'work', 'collaboration', 'issue'].includes(event.category) && !event.isIssue) return;
      let eventEnd = event.status === 'running'
        ? Date.now()
        : new Date(event.completedAt || event.timestamp || start).getTime();
      let eventStart = new Date(event.startedAt || event.timestamp || eventEnd).getTime();
      if (!event.startedAt && Number.isFinite(Number(event.durationMs)) && Number(event.durationMs) > 0) {
        eventStart = eventEnd - Number(event.durationMs);
      }
      if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) return;
      if (eventEnd < eventStart) eventEnd = eventStart;
      const left = Math.max(0, Math.min(100, ((eventStart - start) / span) * 100));
      const width = Math.max(event.category === 'message' || event.isIssue ? 0.45 : 0.8, Math.min(100 - left, ((eventEnd - eventStart) / span) * 100));
      const type = event.isIssue ? 'issue' : (event.category === 'message' ? 'message' : 'work');
      const marker = createEl('span', {
        className: `codex-activity-ribbon__segment codex-activity-ribbon__segment--${type}`,
        title: event.summary || event.label || 'Activity',
        'aria-hidden': 'true',
      });
      marker.style.left = `${left}%`;
      marker.style.width = `${width}%`;
      track.appendChild(marker);
    });
  }

  function updateOperationalSummary(turnId) {
    if (root.dataset.codexPage !== 'turn') return;
    const state = getLiveActivityState(turnId);
    const counts = summarizeActivityEvents(state.events);
    const setText = (selector, value) => {
      const element = root.querySelector(selector);
      if (element) element.textContent = value;
    };
    setText('[data-activity-count]', String(counts.activity));
    setText('[data-issue-count]', String(counts.issues));
    setText('[data-raw-count]', String(Math.max(state.reportedCount, Number(bootstrap.turn?.eventCount) || 0)));
    setText(
      '[data-process-count-summary]',
      `${counts.messages} ${counts.messages === 1 ? 'message' : 'messages'} · ${counts.actions} ${counts.actions === 1 ? 'action' : 'actions'} · ${counts.issues} ${counts.issues === 1 ? 'issue' : 'issues'}`
    );
    const orderButton = root.querySelector(`[data-action="toggle-event-order"][data-turn-id="${CSS.escape(turnId)}"]`);
    if (orderButton) orderButton.textContent = state.order === 'chronological' ? 'Chronological' : 'Newest first';
    const pauseButton = root.querySelector(`[data-action="toggle-live-pause"][data-turn-id="${CSS.escape(turnId)}"]`);
    if (pauseButton) {
      pauseButton.hidden = state.status !== 'running';
      pauseButton.textContent = state.paused ? 'Resume live' : 'Pause live';
      pauseButton.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
    }
    updateNewUpdatesButton(turnId);
    renderPlanSidebar(state);
    renderFilesSidebar(state);
    renderAgentsSidebar(state);
    renderActivityRibbon(state);
  }

  function updateTurnElapsedDisplay() {
    if (root.dataset.codexPage !== 'turn' || !bootstrap.turn) return;
    const element = root.querySelector('[data-process-duration]');
    if (!element) return;
    const liveCluster = root.querySelector('[data-process-live-cluster]');
    if (liveCluster) liveCluster.hidden = bootstrap.turn.status !== 'running';
    let durationMs = bootstrap.turn.durationMs === null || bootstrap.turn.durationMs === undefined
      ? NaN
      : Number(bootstrap.turn.durationMs);
    if (bootstrap.turn.status === 'running' && bootstrap.turn.startedAt) {
      durationMs = Math.max(0, Date.now() - new Date(bootstrap.turn.startedAt).getTime());
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      element.textContent = '-';
      return;
    }
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    element.textContent = [
      hours ? `${hours}h` : '',
      minutes || hours ? `${minutes}m` : '',
      `${seconds}s`,
    ].filter(Boolean).join(' ');
  }

  function renderOperationalPanels(turnId, options = {}) {
    if (root.dataset.codexPage !== 'turn') return;
    const state = getLiveActivityState(turnId);
    if (state.pendingNewCount > 0 && !options.force) {
      updateOperationalSummary(turnId);
      return;
    }
    const common = {
      errorMessage: state.errorMessage,
      isRunning: state.status === 'running',
      loaded: state.loaded,
      newSeqs: options.newSeqs,
      order: state.order,
      paused: state.paused,
    };
    const activity = root.querySelector(`[data-events-for="${CSS.escape(turnId)}"]`);
    const issues = root.querySelector(`[data-issues-for="${CSS.escape(turnId)}"]`);
    if (activity) renderActivityFeed(activity, state.events, { ...common, mode: 'activity' });
    if (issues) renderActivityFeed(issues, state.events, { ...common, mode: 'issues' });
    updateOperationalSummary(turnId);
  }

  function rawEventMatchesFilters(event, panel) {
    const filters = Object.fromEntries(Array.from(panel.querySelectorAll('[data-raw-filter]'))
      .map((control) => [control.dataset.rawFilter, String(control.value || '').trim().toLowerCase()]));
    if (filters.category && String(event.category).toLowerCase() !== filters.category) return false;
    if (filters.stream && String(event.stream).toLowerCase() !== filters.stream) return false;
    if (filters.severity && String(event.severity).toLowerCase() !== filters.severity) return false;
    if (filters.eventType && !String(event.eventType).toLowerCase().includes(filters.eventType)) return false;
    if (filters.text) {
      const searchable = `${event.summary || ''}\n${event.text || ''}\n${JSON.stringify(event.payload || {})}`.toLowerCase();
      if (!searchable.includes(filters.text)) return false;
    }
    return true;
  }

  function groupRawEvents(events) {
    const groups = [];
    (Array.isArray(events) ? events : []).forEach((event) => {
      const previous = groups[groups.length - 1];
      const canGroup = event.category === 'telemetry' || event.severity === 'warning' || event.severity === 'error';
      if (canGroup && previous && previous.eventType === event.eventType && previous.summary === event.summary) {
        previous.repeatCount = (previous.repeatCount || 1) + 1;
        previous.groupedEvents.push(event);
        return;
      }
      groups.push({ ...event, groupedEvents: [event], repeatCount: 1 });
    });
    return groups;
  }

  function populateRawEventDetails(body, event) {
    if (body.dataset.loaded === 'true') return;
    body.dataset.loaded = 'true';
    if (event.text) {
      body.appendChild(createEl('h4', { text: 'Event text' }));
      body.appendChild(createEl('pre', { text: event.text }));
    }
    body.appendChild(createEl('h4', { text: 'Payload' }));
    body.appendChild(createEl('pre', { text: JSON.stringify(event.payload || {}, null, 2) }));
    const copy = createEl('button', { type: 'button', className: 'codex-small-button', text: 'Copy event' });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify({
          seq: event.seq,
          eventType: event.eventType,
          stream: event.stream,
          severity: event.severity,
          createdAt: event.createdAt,
          text: event.text,
          payload: event.payload,
        }, null, 2));
        copy.textContent = 'Copied';
      } catch (_error) {
        copy.textContent = 'Copy failed';
      }
    });
    body.appendChild(copy);
  }

  function createRawEventRow(event) {
    const disclosure = createEl('details', { className: 'codex-raw-event' });
    const summary = createEl('summary');
    const identity = createEl('span', { className: 'codex-raw-event__identity' });
    identity.appendChild(createEl('strong', { text: `#${event.seq} ${event.eventType}` }));
    identity.appendChild(createEl('small', { text: event.summary || 'No summary' }));
    summary.appendChild(identity);
    const meta = createEl('span', { className: 'codex-raw-event__meta' });
    meta.appendChild(createEl('span', { text: [event.stream, event.severity].filter(Boolean).join(' · ') }));
    meta.appendChild(createEl('time', { datetime: event.createdAt || '', text: formatActivityClock(event.createdAt) }));
    if (event.repeatCount > 1) meta.appendChild(createEl('b', { text: `×${event.repeatCount}` }));
    if (event.truncated) meta.appendChild(createEl('b', { className: 'codex-truncated-badge', text: 'Truncated' }));
    summary.appendChild(meta);
    disclosure.appendChild(summary);
    const body = createEl('div', { className: 'codex-raw-event__body' });
    disclosure.appendChild(body);
    disclosure.addEventListener('toggle', () => {
      if (disclosure.open) populateRawEventDetails(body, event);
    });
    return disclosure;
  }

  function renderRawEvents(turnId) {
    const state = getLiveActivityState(turnId);
    const container = root.querySelector(`[data-raw-events-for="${CSS.escape(turnId)}"]`);
    const panel = container?.closest('[data-process-panel="raw"]');
    if (!container || !panel) return;
    container.innerHTML = '';
    if (!state.rawLoaded && state.rawLoading) {
      container.appendChild(createEl('p', { className: 'codex-empty', text: 'Loading raw events…' }));
      return;
    }
    const filtered = state.rawEvents
      .filter((event) => rawEventMatchesFilters(event, panel))
      .sort((left, right) => state.order === 'chronological'
        ? Number(left.seq) - Number(right.seq)
        : Number(right.seq) - Number(left.seq));
    const grouped = groupRawEvents(filtered);
    if (!grouped.length) {
      container.appendChild(createEl('p', {
        className: 'codex-empty',
        text: state.rawLoaded ? 'No loaded raw events match these filters.' : 'Raw events load only when this tab is opened.',
      }));
    } else {
      grouped.forEach((event) => container.appendChild(createRawEventRow(event)));
    }
    if (state.rawErrorMessage) {
      container.appendChild(createEl('p', {
        className: 'codex-events__notice codex-error-text',
        text: state.rawErrorMessage,
      }));
    }
    const more = root.querySelector(`[data-action="load-more-raw-events"][data-turn-id="${CSS.escape(turnId)}"]`);
    if (more) {
      more.hidden = !state.rawHasMore;
      more.disabled = state.rawLoading;
      more.textContent = state.rawLoading ? 'Loading…' : 'Load older events';
    }
  }

  async function loadRawTurnEvents(turnId) {
    const state = getLiveActivityState(turnId);
    if (state.rawLoading || (state.rawLoaded && !state.rawHasMore)) return;
    state.rawLoading = true;
    renderRawEvents(turnId);
    try {
      const before = state.rawBeforeSeq ? `&beforeSeq=${encodeURIComponent(state.rawBeforeSeq)}` : '';
      const payload = await requestJson(
        `/codex/api/turns/${encodeURIComponent(turnId)}/raw-events?limit=${RAW_EVENT_PAGE_SIZE}${before}`,
        { cache: 'no-store' }
      );
      const known = new Set(state.rawEvents.map((event) => Number(event.seq) || 0));
      (payload.events || []).forEach((event) => {
        if (!known.has(Number(event.seq) || 0)) state.rawEvents.push(event);
      });
      state.rawEvents.sort((left, right) => Number(right.seq) - Number(left.seq));
      state.rawLoaded = true;
      state.rawHasMore = Boolean(payload.page?.hasMore);
      state.rawBeforeSeq = payload.page?.nextBeforeSeq || null;
      state.rawErrorMessage = '';
      state.reportedCount = Math.max(state.reportedCount, Number(payload.page?.total) || 0);
    } catch (error) {
      state.rawErrorMessage = error.message || 'Unable to load raw events.';
    } finally {
      state.rawLoading = false;
      renderRawEvents(turnId);
      updateOperationalSummary(turnId);
    }
  }

  function renderFocusedEventContent(wrapper, event) {
    const itemType = eventItemType(event);
    const item = extractEventItem(event);
    const presentation = event.presentation && typeof event.presentation === 'object'
      ? event.presentation
      : {};

    if (itemType === 'user_message') {
      wrapper.appendChild(createEl('p', {
        className: 'codex-event__user-message',
        text: String(presentation.text || item?.text || ''),
      }));
      if (presentation.deliveryStatus === 'failed') {
        wrapper.appendChild(createEl('p', {
          className: 'codex-form-status',
          'data-tone': 'error',
          text: 'Codex did not accept this message.',
        }));
      }
      return;
    }

    if (itemType === 'agent_message' || itemType === 'reasoning') {
      const content = createEl('div', { className: 'codex-event__markdown' });
      if (typeof presentation.html === 'string') {
        // The events API renders this with marked and sanitizes it before returning it.
        content.innerHTML = presentation.html;
      } else {
        content.appendChild(createEl('p', { text: String(item?.text || '') }));
      }
      if (!content.hasChildNodes()) {
        content.appendChild(createEl('p', {
          className: 'codex-empty',
          text: itemType === 'reasoning' ? 'Empty reasoning update.' : 'Empty agent message.',
        }));
      }
      wrapper.appendChild(content);
      return;
    }

    const todos = Array.isArray(presentation.items)
      ? presentation.items
      : (Array.isArray(item?.items) ? item.items : []);
    if (todos.length === 0) {
      wrapper.appendChild(createEl('p', { className: 'codex-empty', text: 'No todo items.' }));
      return;
    }

    const list = createEl('ul', { className: 'codex-event__todo-list' });
    todos.forEach((todo) => {
      const completed = todo?.completed === true;
      const row = createEl('li', {
        className: completed ? 'codex-event__todo codex-event__todo--completed' : 'codex-event__todo',
      });
      const label = createEl('label');
      const checkbox = createEl('input', { type: 'checkbox' });
      checkbox.checked = completed;
      checkbox.disabled = true;
      label.appendChild(checkbox);
      label.appendChild(createEl('span', { text: String(todo?.text || '') }));
      row.appendChild(label);
      list.appendChild(row);
    });
    wrapper.appendChild(list);
  }

  function renderEditedFilesSummary(container, files) {
    const wrapper = createEl('article', {
      className: 'codex-event codex-event--file-changes',
    });
    const header = createEl('div', { className: 'codex-event__header' });
    header.appendChild(createEl('strong', { text: 'Edited files' }));
    header.appendChild(createEl('span', {
      text: `${files.length} ${files.length === 1 ? 'file' : 'files'}`,
    }));
    wrapper.appendChild(header);

    const tableWrapper = createEl('div', { className: 'codex-event__file-table-wrap' });
    const table = createEl('table', { className: 'codex-event__file-table' });
    const tableHead = createEl('thead');
    const headingRow = createEl('tr');
    headingRow.appendChild(createEl('th', { scope: 'col', text: 'File' }));
    headingRow.appendChild(createEl('th', { scope: 'col', text: 'Changes' }));
    tableHead.appendChild(headingRow);
    table.appendChild(tableHead);

    const tableBody = createEl('tbody');
    files.forEach((file) => {
      const row = createEl('tr');
      const fileCell = tableCell('File');
      const lastSeparator = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'));
      const fileName = lastSeparator >= 0 ? file.path.slice(lastSeparator + 1) : file.path;
      const directory = lastSeparator >= 0 ? file.path.slice(0, lastSeparator + 1) : '';
      fileCell.appendChild(createEl('code', {
        className: 'codex-event__file-name',
        title: file.path,
        text: fileName || file.path,
      }));
      if (directory) {
        fileCell.appendChild(createEl('small', {
          className: 'codex-event__file-directory',
          title: file.path,
          text: directory,
        }));
      }
      row.appendChild(fileCell);

      const kindCell = tableCell('Changes');
      const kinds = file.kinds.length ? file.kinds : ['change'];
      const kindList = createEl('div', { className: 'codex-event__file-kinds' });
      kinds.forEach((kind) => {
        const modifier = kind.replace(/[^a-z0-9_-]+/g, '-');
        kindList.appendChild(createEl('span', {
          className: `codex-event__file-kind codex-event__file-kind--${modifier}`,
          text: kind,
        }));
      });
      kindCell.appendChild(kindList);
      row.appendChild(kindCell);
      tableBody.appendChild(row);
    });
    table.appendChild(tableBody);
    tableWrapper.appendChild(table);
    wrapper.appendChild(tableWrapper);
    container.appendChild(wrapper);
  }

  function renderEvents(container, events, options = {}) {
    container.innerHTML = '';
    const eventList = Array.isArray(events) ? events : [];
    const viewMode = normalizeEventViewMode(container.dataset.eventViewMode);
    if (eventList.some((event) => event?.category || event?.summary)) {
      renderActivityFeed(container, eventList, {
        ...options,
        mode: viewMode === 'issues' ? 'issues' : 'activity',
        order: root.dataset.codexPage === 'turn' ? getLiveActivityState(container.dataset.eventsFor).order : 'chronological',
      });
      return;
    }
    const editedFiles = viewMode === 'focused' ? summarizeEditedFiles(eventList) : [];
    const visibleEvents = viewMode === 'focused'
      ? selectFocusedProcessEvents(eventList)
      : (viewMode === 'errors' ? selectErrorProcessEvents(eventList) : eventList);

    if (visibleEvents.length === 0 && editedFiles.length === 0) {
      let message = 'No process details stored.';
      if (viewMode === 'focused') {
        message = 'No user or agent messages, reasoning updates, todo lists, or edited files stored.';
      } else if (viewMode === 'errors') {
        message = 'No error outputs stored.';
      }
      if (!options.loaded && eventList.length === 0) {
        message = 'Loading process details…';
      } else if (options.isRunning) {
        if (viewMode === 'focused') {
          message = 'Waiting for a message, reasoning update, todo list, or file change…';
        } else if (viewMode === 'errors') {
          message = 'No error output recorded yet.';
        } else {
          message = 'Listening for the first process detail…';
        }
      }
      container.appendChild(createEl('p', { className: 'codex-empty', text: message }));
    } else {
      visibleEvents.forEach((event) => {
        const eventSeq = Number(event.seq) || 0;
        const isNew = Boolean(options.newSeqs && options.newSeqs.has(eventSeq));
        const itemType = eventItemType(event);
        const eventVariant = viewMode === 'focused'
          ? ` codex-event--${itemType.replace(/_/g, '-')}`
          : (viewMode === 'errors' ? ' codex-event--error' : '');
        const wrapper = createEl('article', {
          className: `codex-event${eventVariant}${isNew ? ' codex-event--new' : ''}`,
          'data-event-seq': eventSeq,
        });
        const header = createEl('div', { className: 'codex-event__header' });
        const focusedLabels = {
          agent_message: 'Agent message',
          reasoning: 'Reasoning',
          todo_list: 'Current todo list',
          user_message: 'Your additional message',
        };
        const focusedLabel = focusedLabels[itemType] || humanizeEventName(itemType);
        header.appendChild(createEl('strong', {
          text: `#${event.seq} ${viewMode === 'focused' ? focusedLabel : event.eventType}`,
        }));
        const eventMeta = [
          event.stream,
          event.severity,
          event.createdAt ? formatDate(event.createdAt) : '',
        ].filter(Boolean).join(' / ');
        header.appendChild(createEl('span', { text: eventMeta }));
        wrapper.appendChild(header);
        if (viewMode === 'focused') {
          renderFocusedEventContent(wrapper, event);
        } else if (event.text) {
          wrapper.appendChild(createEl('pre', { text: event.text }));
        } else if (event.payload && Object.keys(event.payload).length) {
          wrapper.appendChild(createEl('pre', { text: JSON.stringify(event.payload, null, 2) }));
        } else {
          wrapper.appendChild(createEl('p', { className: 'codex-empty', text: 'No event payload.' }));
        }
        container.appendChild(wrapper);
      });
      if (editedFiles.length) {
        renderEditedFilesSummary(container, editedFiles);
      }
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
      listener.appendChild(createEl('span', {
        text: viewMode === 'focused'
          ? 'Live · listening for user and agent messages, reasoning, todos and file changes'
          : (viewMode === 'errors'
            ? 'Live · listening for error output'
            : 'Live · listening for more details'),
      }));
      container.appendChild(listener);
    }
    const latestSeq = eventList.reduce(
      (maximum, event) => Math.max(maximum, Number(event.seq) || 0),
      0,
    );
    container.dataset.renderedSeq = String(latestSeq);
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
        } else if (action === 'set-event-view') {
          setEventViewMode(button.dataset.turnId, button.dataset.eventViewMode);
        } else if (action === 'toggle-event-order') {
          const state = getLiveActivityState(button.dataset.turnId);
          state.order = state.order === 'newest' ? 'chronological' : 'newest';
          state.pendingNewCount = 0;
          storeEventOrder(state.order);
          renderOperationalPanels(button.dataset.turnId, { force: true });
          if (state.rawLoaded) renderRawEvents(button.dataset.turnId);
          const feed = root.querySelector(`[data-events-for="${CSS.escape(button.dataset.turnId)}"]`);
          if (feed) feed.scrollTop = state.order === 'newest' ? 0 : feed.scrollHeight;
        } else if (action === 'toggle-live-pause') {
          const state = getLiveActivityState(button.dataset.turnId);
          state.paused = !state.paused;
          renderOperationalPanels(button.dataset.turnId, { force: true });
          if (!state.paused) loadTurnActivity(button.dataset.turnId).catch(() => {});
        } else if (action === 'show-new-updates') {
          const state = getLiveActivityState(button.dataset.turnId);
          state.pendingNewCount = 0;
          renderOperationalPanels(button.dataset.turnId, { force: true });
          const feed = root.querySelector(`[data-events-for="${CSS.escape(button.dataset.turnId)}"]`);
          if (feed) feed.scrollTop = state.order === 'newest' ? 0 : feed.scrollHeight;
        } else if (action === 'load-more-raw-events') {
          await loadRawTurnEvents(button.dataset.turnId);
        } else if (action === 'archive-session') {
          await requestJson(`/codex/api/sessions/${encodeURIComponent(button.dataset.sessionId)}/archive`, { method: 'POST', body: '{}' });
          window.location.href = '/codex';
        } else if (action === 'disable-workspace') {
          await requestJson(`/codex/api/workspaces/${encodeURIComponent(button.dataset.workspaceId)}`, { method: 'DELETE', body: '{}' });
          window.location.reload();
        } else if (action === 'disable-profile') {
          await requestJson(`/codex/api/profiles/${encodeURIComponent(button.dataset.profileId)}`, { method: 'DELETE', body: '{}' });
          window.location.reload();
        } else if (action === 'delete-template') {
          const templateName = button.dataset.templateName || 'this template';
          if (!window.confirm(`Delete “${templateName}”?`)) {
            return;
          }
          await requestJson(`/codex/api/templates/${encodeURIComponent(button.dataset.templateId)}`, { method: 'DELETE', body: '{}' });
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
    initNewRequestMaximize();
    bindDashboardPromptTemplateFilter();
    const form = document.getElementById('codex-new-session-form');
    const status = document.getElementById('codex-new-session-status');
    if (form) {
      const promptControl = bindPromptLengthControl(form);
      const modeInputs = form.querySelectorAll('[name="mode"]');
      modeInputs.forEach((input) => {
        input.addEventListener('change', () => applyCommitPushDefaults(form));
      });
      form.addEventListener('reset', () => {
        setTimeout(() => {
          applyCommitPushDefaults(form);
          syncModelProviderControls(form);
        }, 0);
      });
      applyCommitPushDefaults(form);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        const promptState = promptControl && promptControl.sync();
        if (promptState && promptState.overLimit) {
          setStatus(
            status,
            `Prompt is too long. Maximum length is ${promptState.maximum.toLocaleString()} characters.`,
            'error',
          );
          return;
        }
        setStatus(status, 'Submitting...', '');
        if (promptControl) {
          promptControl.setSubmitting(true);
        } else {
          submit.disabled = true;
        }
        try {
          const payload = await requestJson('/codex/api/sessions', {
            method: 'POST',
            body: JSON.stringify(formToPayload(form)),
          });
          setStatus(status, `Accepted. Turn ${payload.turn.id} is queued.`, 'success');
          form.querySelector('[name="prompt"]').value = '';
          if (promptControl) promptControl.sync();
          resetPromptTemplateSelection(form);
          clearYoloConfirmation(form);
          await refreshDashboard();
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          if (promptControl) {
            promptControl.setSubmitting(false);
          } else {
            submit.disabled = false;
          }
        }
      });
    }
    root.querySelectorAll('[data-codex-pricing-form]').forEach((pricingForm) => {
      const pricingStatus = pricingForm.querySelector('[data-codex-pricing-status]');
      pricingForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = pricingForm.querySelector('[type="submit"]');
        setStatus(pricingStatus, 'Saving...', '');
        submit.disabled = true;
        try {
          const payload = { provider: pricingForm.dataset.provider || 'openai' };
          TOKEN_TYPES.forEach((type) => {
            const input = pricingForm.querySelector(`[name="${type}"]`);
            payload[type] = input ? input.value : 0;
          });
          const response = await requestJson('/codex/api/pricing', {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          setStatus(pricingStatus, 'Prices saved.', 'success');
          renderDashboardStats(response.stats, response.pricingByProvider || response.pricing);
        } catch (error) {
          setStatus(pricingStatus, error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      });
    });
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
      const promptControl = bindPromptLengthControl(form);
      const modeInputs = form.querySelectorAll('[name="mode"]');
      modeInputs.forEach((input) => {
        input.addEventListener('change', () => applyCommitPushDefaults(form));
      });
      applyCommitPushDefaults(form);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        const promptState = promptControl && promptControl.sync();
        if (promptState && promptState.overLimit) {
          setStatus(
            status,
            `Prompt is too long. Maximum length is ${promptState.maximum.toLocaleString()} characters.`,
            'error',
          );
          return;
        }
        setStatus(status, 'Submitting...', '');
        if (promptControl) {
          promptControl.setSubmitting(true);
        } else {
          submit.disabled = true;
        }
        try {
          const payload = await requestJson(`/codex/api/sessions/${encodeURIComponent(form.dataset.sessionId)}/turns`, {
            method: 'POST',
            body: JSON.stringify(formToPayload(form)),
          });
          setStatus(status, `Accepted. Turn ${payload.turn.id} is queued.`, 'success');
          form.querySelector('[name="prompt"]').value = '';
          if (promptControl) promptControl.sync();
          resetPromptTemplateSelection(form);
          clearYoloConfirmation(form);
          const state = await refreshSession();
          syncAutoRefresh(state);
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          if (promptControl) {
            promptControl.setSubmitting(false);
          } else {
            submit.disabled = false;
          }
        }
      });
    }
    syncPageAutoRefresh = syncAutoRefresh;
    syncLiveActivityTurns(bootstrap.turns || []);
    syncAutoRefresh({ turns: bootstrap.turns });
  }

  function initTurn() {
    let refreshTimer = null;
    const additionalMessageForm = document.getElementById('codex-additional-message-form');
    const additionalMessageStatus = document.getElementById('codex-additional-message-status');

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

    if (additionalMessageForm) {
      const messageControl = bindPromptLengthControl(additionalMessageForm);
      additionalMessageForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const messageField = additionalMessageForm.querySelector('[name="message"]');
        const messageState = messageControl && messageControl.sync();
        if (messageState && messageState.overLimit) {
          setStatus(
            additionalMessageStatus,
            `Message is too long. Maximum length is ${messageState.maximum.toLocaleString()} characters.`,
            'error',
          );
          return;
        }
        if (!messageField || !messageField.value.trim()) {
          setStatus(additionalMessageStatus, 'Message is required.', 'error');
          return;
        }

        additionalMessageForm.dataset.submitting = 'true';
        if (messageControl) messageControl.setSubmitting(true);
        syncAdditionalMessageForm(bootstrap.turn);
        setStatus(additionalMessageStatus, 'Queueing message…', '');
        try {
          await requestJson(
            `/codex/api/turns/${encodeURIComponent(additionalMessageForm.dataset.turnId)}/messages`,
            {
              method: 'POST',
              body: JSON.stringify({ message: messageField.value }),
            }
          );
          messageField.value = '';
          if (messageControl) messageControl.sync();
          setStatus(additionalMessageStatus, 'Message queued for this running turn.', 'success');
          window.setTimeout(() => loadTurnActivity(additionalMessageForm.dataset.turnId), 500);
          try {
            const payload = await refreshTurn();
            bootstrap.turn = payload.turn;
            syncAutoRefresh(payload);
          } catch (_refreshError) {
            // Submission succeeded; ordinary page polling will retry the refresh.
          }
        } catch (error) {
          setStatus(additionalMessageStatus, error.message, 'error');
        } finally {
          delete additionalMessageForm.dataset.submitting;
          if (messageControl) messageControl.setSubmitting(false);
          syncAdditionalMessageForm(bootstrap.turn);
        }
      });
    }

    root.querySelectorAll('[data-raw-filter]').forEach((control) => {
      control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => {
        renderRawEvents(root.dataset.turnId);
      });
    });
    const tabList = root.querySelector('.codex-process-tabs');
    if (tabList) {
      tabList.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
        const current = tabs.indexOf(document.activeElement);
        if (current < 0) return;
        event.preventDefault();
        let next = event.key === 'Home' ? 0 : (event.key === 'End' ? tabs.length - 1 : current + (event.key === 'ArrowRight' ? 1 : -1));
        next = (next + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      });
    }

    syncPageAutoRefresh = syncAutoRefresh;
    syncLiveActivityTurns(bootstrap.turn ? [bootstrap.turn] : []);
    if (bootstrap.turn) {
      updateLiveActivityIndicators(bootstrap.turn.id, { renderEventPanels: true });
      syncAdditionalMessageForm(bootstrap.turn);
      updateOperationalSummary(bootstrap.turn.id);
      updateTurnElapsedDisplay();
      loadTurnActivity(bootstrap.turn.id).catch(() => {});
    }
    window.setInterval(updateTurnElapsedDisplay, 1000);
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

  function initTemplates() {
    const createForm = document.getElementById('codex-template-create');
    const status = document.getElementById('codex-template-status');
    if (createForm) {
      createForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = createForm.querySelector('[type="submit"]');
        submit.disabled = true;
        setStatus(status, 'Saving...', '');
        try {
          await requestJson('/codex/api/templates', {
            method: 'POST',
            body: JSON.stringify(formToPayload(createForm)),
          });
          setStatus(status, 'Template saved.', 'success');
          window.location.reload();
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          submit.disabled = false;
        }
      });
    }

    root.querySelectorAll('[data-template-form]').forEach((form) => {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          await requestJson(`/codex/api/templates/${encodeURIComponent(form.dataset.templateForm)}`, {
            method: 'PATCH',
            body: JSON.stringify(formToPayload(form)),
          });
          window.location.reload();
        } catch (error) {
          alert(error.message || 'Unable to save prompt template.');
        } finally {
          submit.disabled = false;
        }
      });
    });
  }

  captureInitialProcessDetailState();
  bindPermissionControls(root);
  bindModelProviderControls(root);
  bindPromptTemplateSelectors(root);
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
  } else if (root.dataset.codexPage === 'templates') {
    initTemplates();
  }
})();
