const path = require('path');

const marked = require('marked');
const sanitizeHtml = require('sanitize-html');

const ACTIVITY_DETAIL_TEXT_LIMIT = 6000;
const RAW_TEXT_LIMIT = 12000;
const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|session[_-]?token|token)$/i;
const BINARY_VALUE_KEY_PATTERN = /^(?:audio_?url|base64|binary|blob|bytes|data|image_?url)$/i;
const TELEMETRY_EVENT_PATTERN = /(?:tokenusage|token_usage|rate.?limit|usage[./_]updated|mcp.*startup|remote.?control|thread[./_](?:started|status)|session_meta|process.?id)/i;
const ISSUE_STATUSES = new Set([
  'blocked', 'cancelled', 'declined', 'failed', 'timed_out', 'warning',
]);
const START_RETAINED_ITEM_TYPES = new Set([
  'collab_agent_tool_call',
  'command_execution',
  'dynamic_tool_call',
  'file_change',
  'image_generation',
  'mcp_tool_call',
  'sleep',
  'sub_agent_activity',
  'web_search',
]);

const ITEM_TYPE_ALIASES = Object.freeze({
  agentmessage: 'agent_message',
  agent_message: 'agent_message',
  collabagenttoolcall: 'collab_agent_tool_call',
  collab_agent_tool_call: 'collab_agent_tool_call',
  commandexecution: 'command_execution',
  command_execution: 'command_execution',
  contextcompaction: 'context_compaction',
  context_compaction: 'context_compaction',
  dynamictoolcall: 'dynamic_tool_call',
  dynamic_tool_call: 'dynamic_tool_call',
  enteredreviewmode: 'entered_review_mode',
  entered_review_mode: 'entered_review_mode',
  exitedreviewmode: 'exited_review_mode',
  exited_review_mode: 'exited_review_mode',
  filechange: 'file_change',
  file_change: 'file_change',
  functioncalloutput: 'function_call_output',
  function_call_output: 'function_call_output',
  hookprompt: 'hook_prompt',
  hook_prompt: 'hook_prompt',
  imagegeneration: 'image_generation',
  image_generation: 'image_generation',
  imageview: 'image_view',
  image_view: 'image_view',
  mcptoolcall: 'mcp_tool_call',
  mcp_tool_call: 'mcp_tool_call',
  plan: 'reasoning',
  reasoning: 'reasoning',
  sleep: 'sleep',
  subagentactivity: 'sub_agent_activity',
  sub_agent_activity: 'sub_agent_activity',
  todolist: 'todo_list',
  todo_list: 'todo_list',
  usermessage: 'user_message',
  user_message: 'user_message',
  websearch: 'web_search',
  web_search: 'web_search',
});

function clipText(value, maxLength = ACTIVITY_DETAIL_TEXT_LIMIT) {
  const text = String(value === null || value === undefined ? '' : value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 19))}\n[output truncated]`;
}

function clipTextWithTail(value, maxLength = ACTIVITY_DETAIL_TEXT_LIMIT) {
  const text = String(value === null || value === undefined ? '' : value);
  if (text.length <= maxLength) return text;
  const marker = '\n[output truncated]\n';
  const available = Math.max(0, maxLength - marker.length);
  const headLength = Math.ceil(available * 0.55);
  const tailLength = available - headLength;
  return `${text.slice(0, headLength)}${marker}${text.slice(text.length - tailLength)}`;
}

function stripAnsi(value) {
  return String(value === null || value === undefined ? '' : value)
    // CSI, OSC, and single-character terminal escape sequences.
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function redactText(value, maxLength = ACTIVITY_DETAIL_TEXT_LIMIT) {
  return clipText(stripAnsi(value)
    .replace(/\/(?:home|Users)\/[^/\s]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '~')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(/((?:["']?)(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|session[_-]?token|token)(?:["']?)\s*[:=]\s*)(["'])[^\r\n]*?\2/gi, '$1[redacted]')
    .replace(/\b((?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|session[_-]?token|token)\s*[:=]\s*)(["']?)[^\s"',;]+\2/gi, '$1[redacted]')
    .replace(/([?&](?:api[_-]?key|auth|password|secret|signature|token)=)[^&#\s]+/gi, '$1[redacted]'), maxLength);
}

function redactWorkspaceOutput(value, workspaceRoot, maxLength = ACTIVITY_DETAIL_TEXT_LIMIT) {
  const root = String(workspaceRoot || '').trim();
  const relative = root ? String(value || '').split(root).join('.') : value;
  const sanitized = redactText(relative, Number.MAX_SAFE_INTEGER);
  return clipTextWithTail(sanitized, maxLength);
}

function redactWorkspaceText(value, workspaceRoot, maxLength = ACTIVITY_DETAIL_TEXT_LIMIT) {
  const root = String(workspaceRoot || '').trim();
  const relative = root ? String(value || '').split(root).join('.') : value;
  return redactText(relative, maxLength);
}

function safeExternalUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    Array.from(parsed.searchParams.keys()).forEach((key) => {
      if (SENSITIVE_KEY_PATTERN.test(key) || /(?:auth|signature)/i.test(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    });
    parsed.hash = '';
    return clipText(parsed.toString(), 2000);
  } catch (_error) {
    return '';
  }
}

function canonicalItemType(value) {
  const original = String(value || '').trim();
  if (!original) return '';
  const underscored = original
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .toLowerCase();
  return ITEM_TYPE_ALIASES[underscored] || ITEM_TYPE_ALIASES[underscored.replaceAll('_', '')] || underscored;
}

function extractCodexItem(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidates = [
    payload.item,
    payload.payload?.item,
    payload.data?.item,
    payload.params?.item,
    payload.payload?.payload?.item,
    payload.payload?.data?.item,
  ];
  return candidates.find((item) => item && typeof item === 'object') || null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAgentMessageMarkdown(text) {
  const source = redactText(text, 50000);
  let rendered;
  try {
    rendered = marked.parse(source, { gfm: true });
  } catch (_error) {
    return `<p>${escapeHtml(source).replace(/\r?\n/g, '<br>')}</p>`;
  }

  return sanitizeHtml(rendered, {
    allowedTags: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      code: ['class'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'escape',
    transformTags: {
      a: (tagName, attribs) => {
        const attributes = { ...attribs };
        const href = String(attributes.href || '');
        const safeHref = safeExternalUrl(href);
        if (safeHref) {
          attributes.href = safeHref;
          attributes.target = '_blank';
          attributes.rel = 'noopener noreferrer nofollow';
        } else {
          delete attributes.href;
          delete attributes.target;
          delete attributes.rel;
        }
        return { tagName, attribs: attributes };
      },
    },
  });
}

function normalizeFileChangeKind(value) {
  const kind = value && typeof value === 'object' ? value.type : value;
  return String(kind || '').trim().toLowerCase();
}

function isAbsolutePath(value) {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function workspaceRelativePath(value, workspaceRoot = '') {
  const input = stripAnsi(value).trim();
  if (!input) return '';
  const root = String(workspaceRoot || '').trim();
  const windowsPath = path.win32.isAbsolute(input) || path.win32.isAbsolute(root);
  const pathApi = windowsPath ? path.win32 : path.posix;

  if (root && isAbsolutePath(input)) {
    const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(input));
    if (relative === '') return '.';
    if (relative && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !isAbsolutePath(relative)) {
      return relative.replaceAll('\\', '/');
    }
  }

  if (isAbsolutePath(input)) {
    const basename = pathApi.basename(input).replaceAll('\\', '/');
    return basename ? `[outside workspace]/${basename}` : '[outside workspace]';
  }

  const normalized = input.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../')) {
    return path.posix.basename(normalized);
  }
  return clipText(normalized, 1000);
}

function normalizeStatus(value, fallback = 'info') {
  const status = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]+/g, '_')
    .toLowerCase();
  if (['in_progress', 'running', 'started', 'active', 'pending_init'].includes(status)) return 'running';
  if (['complete', 'completed', 'delivered', 'sent', 'succeeded', 'success', 'ok', 'shutdown'].includes(status)) return 'succeeded';
  if (['failed', 'failure', 'error', 'errored', 'fatal', 'not_found'].includes(status)) return 'failed';
  if (['cancelled', 'canceled', 'interrupted'].includes(status)) return 'cancelled';
  if (['declined', 'rejected', 'blocked'].includes(status)) return 'blocked';
  if (['timed_out', 'timeout'].includes(status)) return 'timed_out';
  if (status === 'warning') return 'warning';
  if (['pending', 'queued'].includes(status)) return 'pending';
  return fallback;
}

function eventLifecyclePhase(event, item) {
  const eventType = String(event?.eventType || event?.type || '').toLowerCase();
  if (/(?:^|[./_-])started$/.test(eventType)) return 'started';
  if (/(?:^|[./_-])(?:completed|succeeded|failed|cancelled|canceled|timed_out)$/.test(eventType)) return 'completed';
  const status = normalizeStatus(item?.status || event?.status || '', '');
  return status === 'running' || status === 'pending' ? 'started' : (status ? 'completed' : 'update');
}

function eventTimestamp(event) {
  return event?.createdAt || event?.timestamp || event?.time || null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function basePresentation(event, overrides = {}) {
  const item = extractCodexItem(event?.payload) || {};
  const phase = eventLifecyclePhase(event, item);
  const timestamp = eventTimestamp(event);
  const status = normalizeStatus(
    item.status || event?.payload?.status || event?.status || event?.severity,
    phase === 'started' ? 'running' : 'info'
  );
  const durationMs = numberOrNull(item.durationMs ?? item.duration_ms ?? event?.payload?.durationMs ?? event?.durationMs);
  const severity = String(event?.severity || (ISSUE_STATUSES.has(status) ? 'warning' : 'info')).toLowerCase();
  const presentation = {
    id: String(event?.id || event?._id || ''),
    seq: Number(event?.seq) || 0,
    itemId: String(item.id || event?.payload?.itemId || event?.payload?.item_id || ''),
    category: 'system',
    kind: canonicalItemType(item.type) || 'event',
    label: 'Process update',
    summary: '',
    status,
    severity,
    phase,
    timestamp,
    startedAt: phase === 'started' ? timestamp : (item.startedAt || item.started_at || null),
    completedAt: phase === 'completed' ? timestamp : (item.completedAt || item.completed_at || null),
    durationMs,
    rawEventType: String(event?.eventType || event?.type || 'event'),
    stream: String(event?.stream || 'system'),
    tone: 'neutral',
    isIssue: severity === 'warning' || severity === 'error' || ISSUE_STATUSES.has(status),
    truncated: Boolean(event?.payload?.truncated || event?.truncated),
    details: {},
    ...overrides,
  };
  if (presentation.truncated || ['warning', 'error'].includes(presentation.severity)) {
    presentation.isIssue = true;
  }
  if (presentation.isIssue) {
    const terminalFailure = presentation.status === 'failed' || presentation.severity === 'error';
    presentation.severity = terminalFailure ? 'error' :
      (presentation.severity === 'info' ? 'warning' : presentation.severity);
    if (['neutral', 'read', 'work', 'write'].includes(presentation.tone)) {
      presentation.tone = terminalFailure ? 'danger' : 'warning';
    }
  }
  return presentation;
}

function quoteSummary(value, limit = 120) {
  const text = redactText(value, limit).replace(/\s+/g, ' ').trim();
  return text ? `“${text}”` : '';
}

function humanizeIdentifier(value) {
  const text = String(value || '')
    .replace(/^mcp__/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : '';
}

function actionVerb(actionType, phase) {
  const completed = phase === 'completed';
  const verbs = {
    listfiles: completed ? 'Listed files' : 'Listing files',
    read: completed ? 'Read file' : 'Reading file',
    search: completed ? 'Searched workspace' : 'Searching workspace',
  };
  return verbs[String(actionType || '').replaceAll('_', '').toLowerCase()] || '';
}

function unwrapShellCommand(command) {
  let value = stripAnsi(command).trim();
  for (let count = 0; count < 3; count += 1) {
    const match = value.match(/^(?:(?:\/usr\/bin\/env\s+)?(?:bash|sh|zsh)|\/bin\/(?:bash|sh|zsh))\s+(?:-[a-z]*c|--command)\s+(["'])([\s\S]*)\1$/i);
    if (!match) break;
    value = match[2].trim();
  }
  return value;
}

function deterministicCommandSummary(command, phase, commandActions = []) {
  const action = commandActions.find((entry) => entry && String(entry.type || '').toLowerCase() !== 'unknown');
  if (action) {
    const verb = actionVerb(action.type, phase);
    const subject = action.query
      ? quoteSummary(action.query, 90)
      : workspaceRelativePath(action.path || action.name || '');
    if (verb) return [verb, subject].filter(Boolean).join(' · ');
  }

  const clean = unwrapShellCommand(command);
  const completed = phase === 'completed';
  const rules = [
    { pattern: /(?:^|[;&|]\s*)(?:rg|grep|ag|ack)\b/i, text: completed ? 'Searched the workspace' : 'Searching the workspace' },
    { pattern: /(?:^|[;&|]\s*)(?:sed|cat|head|tail|less|bat)\b/i, text: completed ? 'Read project files' : 'Reading project files' },
    { pattern: /(?:^|[;&|]\s*)(?:ls|find|fd|tree)\b/i, text: completed ? 'Listed project files' : 'Listing project files' },
    { pattern: /\b(?:jest|pytest|vitest|mocha)\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test\b/i, text: completed ? 'Ran tests' : 'Running tests' },
    { pattern: /\bgit\s+(?:status|diff|log|show|branch)\b/i, text: completed ? 'Inspected Git state' : 'Inspecting Git state' },
    { pattern: /\bgit\s+commit\b/i, text: completed ? 'Created a Git commit' : 'Creating a Git commit' },
    { pattern: /\bgit\s+push\b/i, text: completed ? 'Pushed Git changes' : 'Pushing Git changes' },
    { pattern: /\b(?:apply_patch|patch)\b/i, text: completed ? 'Applied a code patch' : 'Applying a code patch' },
    { pattern: /\b(?:npm|pnpm|yarn)\s+(?:install|add|update)\b/i, text: completed ? 'Updated packages' : 'Updating packages' },
    { pattern: /\b(?:npm\s+(?:start|run\s+(?:dev|serve))|node\s+\S*(?:app|server))\b/i, text: completed ? 'Started the application server' : 'Starting the application server' },
    { pattern: /(?:^|[;&|]\s*)(?:curl|wget)\b/i, text: completed ? 'Requested a web resource' : 'Requesting a web resource' },
  ];
  const match = rules.find((rule) => rule.pattern.test(clean));
  if (match) return match.text;
  const firstLine = clean.split(/\r?\n/, 1)[0].replace(/\s+/g, ' ').trim();
  return firstLine
    ? `${completed ? 'Ran' : 'Running'} ${clipText(firstLine, 110)}`
    : (completed ? 'Terminal action completed' : 'Terminal action started');
}

function commandPresentation(event, item, options) {
  const phase = eventLifecyclePhase(event, item);
  const command = redactWorkspaceText(
    unwrapShellCommand(item.command || item.cmd || ''),
    options.workspaceRoot,
    4000
  );
  const actions = Array.isArray(item.commandActions || item.command_actions)
    ? (item.commandActions || item.command_actions).slice(0, 12).map((action) => ({
      type: canonicalItemType(action?.type || 'unknown'),
      name: redactWorkspaceText(action?.name || '', options.workspaceRoot, 200),
      path: workspaceRelativePath(action?.path || '', options.workspaceRoot),
      query: redactWorkspaceText(action?.query || '', options.workspaceRoot, 300),
    }))
    : [];
  const exitCode = item.exitCode ?? item.exit_code ?? null;
  const status = exitCode !== null && Number(exitCode) !== 0
    ? 'failed'
    : normalizeStatus(item.status, phase === 'started' ? 'running' : 'succeeded');
  const output = item.aggregatedOutput ?? item.aggregated_output ?? item.output ?? item.stdout ?? '';
  const presentation = basePresentation(event, {
    category: 'work',
    kind: 'command',
    label: 'Terminal',
    summary: deterministicCommandSummary(command, phase, actions),
    status,
    tone: /(?:apply_patch|\bgit\s+(?:commit|push|add)|\brm\b|\bmv\b|\bcp\b|\b(?:npm|pnpm|yarn)\s+(?:install|add|update))/i.test(command)
      ? 'write'
      : 'read',
    isIssue: status === 'failed' || status === 'blocked',
    details: {
      command,
      output: redactWorkspaceOutput(output, options.workspaceRoot, ACTIVITY_DETAIL_TEXT_LIMIT),
      cwd: workspaceRelativePath(item.cwd || '', options.workspaceRoot),
      exitCode: exitCode === null ? null : Number(exitCode),
      actions,
      plugin: redactText(item.pluginId || item.plugin_id || item.scriptPath || item.script_path || '', 300),
      source: redactText(item.source || '', 100),
    },
  });
  presentation.severity = status === 'failed' ? 'error' : presentation.severity;
  if (presentation.isIssue) presentation.tone = status === 'failed' ? 'danger' : 'warning';
  return presentation;
}

function countDiffLines(diff) {
  return String(diff || '').split(/\r?\n/).reduce((counts, line) => {
    if (line.startsWith('+') && !line.startsWith('+++')) counts.additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) counts.deletions += 1;
    return counts;
  }, { additions: 0, deletions: 0 });
}

function fileChangesPresentation(event, item, options) {
  let remainingDiffChars = 12000;
  let detailsTruncated = false;
  const changes = (Array.isArray(item.changes) ? item.changes : []).slice(0, 200)
    .map((change) => {
      const kindObject = change?.kind && typeof change.kind === 'object' ? change.kind : {};
      const rawDiff = String(change?.diff || '');
      const counts = countDiffLines(rawDiff);
      const diffLimit = Math.min(3000, remainingDiffChars);
      const diff = diffLimit > 40
        ? redactWorkspaceOutput(rawDiff, options.workspaceRoot, diffLimit)
        : '';
      if (rawDiff && (diff.includes('[output truncated]') || !diff)) detailsTruncated = true;
      remainingDiffChars = Math.max(0, remainingDiffChars - diff.length);
      return {
        path: workspaceRelativePath(change?.path || '', options.workspaceRoot),
        kind: normalizeFileChangeKind(change?.kind),
        destination: workspaceRelativePath(
          kindObject.movePath || kindObject.move_path || change?.movePath || change?.move_path || '',
          options.workspaceRoot
        ),
        ...counts,
        diff,
      };
    })
    .filter((change) => change.path);
  const status = normalizeStatus(item.status, eventLifecyclePhase(event, item) === 'started' ? 'running' : 'succeeded');
  return basePresentation(event, {
    category: 'work',
    kind: 'file_change',
    label: 'Files',
    summary: changes.length
      ? `Edited ${changes.length} ${changes.length === 1 ? 'file' : 'files'}`
      : (status === 'running' ? 'Applying file changes' : 'File changes completed'),
    status,
    tone: 'write',
    isIssue: status === 'failed' || status === 'blocked',
    truncated: Boolean(event?.payload?.truncated || event?.truncated || detailsTruncated),
    details: { changes },
  });
}

function normalizeQuestions(value, options = {}) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map((question) => ({
    header: redactWorkspaceText(question?.header || '', options.workspaceRoot, 120),
    question: redactWorkspaceText(question?.question || question?.prompt || '', options.workspaceRoot, 1000),
    options: (Array.isArray(question?.options) ? question.options : []).slice(0, 12).map((option) => ({
      label: redactWorkspaceText(option?.label || '', options.workspaceRoot, 160),
      description: redactWorkspaceText(option?.description || '', options.workspaceRoot, 500),
    })),
  })).filter((question) => question.question || question.header);
}

function textFromItem(item, includeSummary = false) {
  if (typeof item?.text === 'string') return item.text;
  const values = [];
  if (includeSummary && Array.isArray(item?.summary)) values.push(...item.summary);
  if (Array.isArray(item?.content)) values.push(...item.content);
  return values.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object') return entry.text || entry.content || '';
    return '';
  }).filter(Boolean).join(includeSummary ? '\n\n' : '\n');
}

function messagePresentation(event, item, options) {
  const itemType = canonicalItemType(item.type);
  const isUser = itemType === 'user_message';
  const text = redactWorkspaceText(textFromItem(item), options.workspaceRoot, 50000);
  const messagePhase = String(item.phase || '').toLowerCase();
  const deliveryStatus = normalizeStatus(
    event?.payload?.deliveryStatus || event?.payload?.delivery_status || item.delivery || '',
    'succeeded'
  );
  const citations = (Array.isArray(item.memoryCitation?.entries || item.memory_citation?.entries)
    ? (item.memoryCitation?.entries || item.memory_citation?.entries)
    : []).slice(0, 20).map((entry) => ({
    path: workspaceRelativePath(entry?.path || '', options.workspaceRoot),
    lineStart: numberOrNull(entry?.lineStart ?? entry?.line_start),
    lineEnd: numberOrNull(entry?.lineEnd ?? entry?.line_end),
    note: redactText(entry?.note || '', 500),
  }));
  const status = deliveryStatus === 'failed' ? 'failed' : 'succeeded';
  return basePresentation(event, {
    category: 'message',
    kind: itemType,
    label: isUser ? 'User message' : (messagePhase === 'final_answer' ? 'Final response' : 'Update'),
    summary: clipText(text.replace(/\s+/g, ' ').trim(), 220),
    status,
    tone: isUser ? 'user' : 'neutral',
    isIssue: status === 'failed',
    details: {
      text: isUser ? text : '',
      html: isUser ? '' : renderAgentMessageMarkdown(text),
      messagePhase: messagePhase || 'unknown',
      questions: normalizeQuestions(item.questions || event?.payload?.questions, options),
      delivery: redactText(item.delivery || event?.payload?.deliveryStatus || '', 100),
      memoryCitation: citations,
    },
  });
}

function reasoningPresentation(event, item, options) {
  const text = redactWorkspaceText(textFromItem(item, true), options.workspaceRoot, 50000).trim();
  if (!text) {
    return basePresentation(event, {
      category: 'model',
      kind: 'model_activity',
      label: 'Model activity',
      summary: 'Model activity',
      status: 'succeeded',
      tone: 'neutral',
      isPlaceholder: true,
    });
  }
  return basePresentation(event, {
    category: 'model',
    kind: 'reasoning',
    label: 'Reasoning',
    summary: clipText(text.replace(/\s+/g, ' '), 220),
    status: 'succeeded',
    tone: 'neutral',
    details: { html: renderAgentMessageMarkdown(text) },
  });
}

function planPresentation(event, item, options) {
  const items = (Array.isArray(item.items) ? item.items : []).slice(0, 100).map((todo) => {
    const normalized = normalizeStatus(todo?.status, todo?.completed === true ? 'succeeded' : 'pending');
    return {
      text: redactWorkspaceText(todo?.text || todo?.step || '', options.workspaceRoot, 1000),
      status: normalized === 'succeeded' ? 'completed' : (normalized === 'running' ? 'inProgress' : 'pending'),
      completed: normalized === 'succeeded',
    };
  }).filter((todo) => todo.text);
  const completed = items.filter((todo) => todo.status === 'completed').length;
  const current = items.find((todo) => todo.status === 'inProgress');
  return basePresentation(event, {
    category: 'plan',
    kind: 'plan',
    label: 'Plan',
    summary: items.length
      ? `Plan updated · ${completed}/${items.length} complete${current ? ` · ${current.text}` : ''}`
      : 'Plan updated',
    status: current ? 'running' : (items.length && completed === items.length ? 'succeeded' : 'pending'),
    tone: current ? 'live' : 'neutral',
    details: {
      items,
      explanation: redactWorkspaceText(event?.payload?.explanation || '', options.workspaceRoot, 2000),
    },
  });
}

function webPresentation(event, item, options) {
  const action = item.action && typeof item.action === 'object' ? item.action : {};
  const actionType = canonicalItemType(action.type || (item.query ? 'search' : 'other'));
  const query = redactWorkspaceText(
    action.query || item.query || (Array.isArray(action.queries) ? action.queries.join(', ') : ''),
    options.workspaceRoot,
    1000
  );
  const url = safeExternalUrl(action.url || item.url || '');
  const pattern = redactWorkspaceText(action.pattern || '', options.workspaceRoot, 500);
  const results = (Array.isArray(item.results) ? item.results : []).slice(0, 20).map((result) => {
    const resultUrl = safeExternalUrl(result?.url || result?.link || '');
    let domain = '';
    try {
      domain = resultUrl ? new URL(resultUrl).hostname : '';
    } catch (_error) {
      domain = '';
    }
    return {
      title: redactWorkspaceText(
        result?.title || result?.name || result?.text || '',
        options.workspaceRoot,
        300
      ),
      domain,
      url: resultUrl,
    };
  });
  let summary = 'Web activity completed';
  if (actionType === 'search') summary = `Searched for ${quoteSummary(query, 120) || 'a web query'}`;
  if (actionType === 'open_page') summary = `Opened ${url ? new URL(url).hostname : 'a web page'}`;
  if (actionType === 'find_in_page') summary = `Found ${quoteSummary(pattern, 100) || 'text'} in a page`;
  if (results.length) summary += ` · ${results.length} ${results.length === 1 ? 'result' : 'results'}`;
  const status = normalizeStatus(
    item.status,
    eventLifecyclePhase(event, item) === 'started' ? 'running' : 'succeeded'
  );
  return basePresentation(event, {
    category: 'work',
    kind: 'web_search',
    label: 'Web',
    summary,
    status,
    tone: 'read',
    isIssue: ISSUE_STATUSES.has(status),
    details: { action: actionType, query, url, pattern, results },
  });
}

function safeStructuredValue(value, options = {}, key = '', depth = 0, state = { entries: 0 }) {
  if (!Number.isFinite(state.remainingChars)) {
    state.remainingChars = options.totalTextLimit || 50000;
  }
  if (SENSITIVE_KEY_PATTERN.test(key) || /(?:auth|signature)/i.test(key)) return '[redacted]';
  if (BINARY_VALUE_KEY_PATTERN.test(key) && (typeof value === 'string' || Array.isArray(value))) {
    return '[binary data omitted]';
  }
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (state.remainingChars <= 40) return '[additional text omitted]';
    const textLimit = Math.min(options.textLimit || RAW_TEXT_LIMIT, state.remainingChars);
    let result;
    if (/(?:^|_)(?:path|cwd|directory|savedpath|scriptpath)$/i.test(key)) {
      result = clipText(workspaceRelativePath(value, options.workspaceRoot), textLimit);
    } else if (/(?:^|_)(?:url|uri|href)$/i.test(key)) {
      result = clipText(safeExternalUrl(value) || '[unsafe URL removed]', textLimit);
    } else {
      result = redactWorkspaceText(value, options.workspaceRoot, textLimit);
    }
    state.remainingChars = Math.max(0, state.remainingChars - result.length);
    return result;
  }
  if (depth >= (options.maxDepth || 8)) return '[nested data omitted]';
  if (Array.isArray(value)) {
    const limit = Math.min(value.length, options.arrayLimit || 100);
    const result = value.slice(0, limit).map((entry) => safeStructuredValue(entry, options, key, depth + 1, state));
    if (value.length > limit) result.push(`[${value.length - limit} more entries omitted]`);
    return result;
  }
  if (typeof value === 'object') {
    const result = {};
    const keys = Object.keys(value).slice(0, options.objectKeyLimit || 100);
    keys.forEach((childKey) => {
      state.entries += 1;
      if (state.entries > (options.entryLimit || 1000)) return;
      result[childKey] = safeStructuredValue(value[childKey], options, childKey, depth + 1, state);
    });
    if (Object.keys(value).length > keys.length || state.entries > (options.entryLimit || 1000)) {
      result._truncated = true;
    }
    return result;
  }
  return redactWorkspaceText(
    String(value),
    options.workspaceRoot,
    options.textLimit || RAW_TEXT_LIMIT
  );
}

function toolPresentation(event, item, options) {
  const appContext = item.appContext || item.app_context || {};
  const argumentsValue = item.arguments ?? {};
  const argumentObject = argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)
    ? argumentsValue
    : {};
  const title = redactWorkspaceText(
    argumentObject.title || appContext.actionName || appContext.action_name || item.actionName || '',
    options.workspaceRoot,
    240
  );
  const appName = redactText(appContext.appName || appContext.app_name || item.namespace || item.server || '', 160);
  const toolName = redactText(item.tool || item.name || '', 180);
  const errorMessage = redactWorkspaceText(
    item.error?.message || item.error || '',
    options.workspaceRoot,
    2000
  );
  const status = errorMessage || item.success === false
    ? 'failed'
    : normalizeStatus(item.status ?? item.success, eventLifecyclePhase(event, item) === 'started' ? 'running' : 'succeeded');
  const summary = title || [appName, humanizeIdentifier(toolName)].filter(Boolean).join(' · ') || 'Tool action';
  const presentation = basePresentation(event, {
    category: 'work',
    kind: canonicalItemType(item.type) === 'mcp_tool_call' ? 'mcp_tool' : 'tool',
    label: appName || 'Tool',
    summary,
    status,
    tone: item.readOnlyHint === true || item.read_only_hint === true ? 'read' : 'work',
    isIssue: status === 'failed' || status === 'blocked',
    details: {
      appName,
      toolName,
      arguments: safeStructuredValue(argumentsValue, {
        workspaceRoot: options.workspaceRoot,
        textLimit: 2000,
        totalTextLimit: 6000,
        arrayLimit: 30,
        objectKeyLimit: 50,
      }),
      result: safeStructuredValue(
        item.result ?? item.output ?? item.contentItems ?? item.content_items ?? null,
        {
          workspaceRoot: options.workspaceRoot,
          textLimit: ACTIVITY_DETAIL_TEXT_LIMIT,
          totalTextLimit: 12000,
          arrayLimit: 30,
          objectKeyLimit: 50,
        }
      ),
      error: errorMessage,
      readOnly: item.readOnlyHint === true || item.read_only_hint === true,
    },
  });
  if (presentation.isIssue) {
    presentation.severity = status === 'failed' ? 'error' : 'warning';
    presentation.tone = status === 'failed' ? 'danger' : 'warning';
  }
  return presentation;
}

function collaborationPresentation(event, item, options) {
  const itemType = canonicalItemType(item.type);
  const tool = String(item.tool || item.kind || '').trim();
  let status = normalizeStatus(
    item.status,
    eventLifecyclePhase(event, item) === 'started' ? 'running' : 'succeeded'
  );
  if (itemType === 'sub_agent_activity') {
    if (item.kind === 'started' || item.kind === 'interacted') status = 'running';
    if (item.kind === 'interrupted') status = 'cancelled';
    if (item.kind === 'completed') status = 'succeeded';
  }
  const labels = {
    closeAgent: 'Closed agent',
    followupTask: 'Sent agent follow-up',
    interruptAgent: 'Interrupted agent',
    listAgents: 'Checked active agents',
    resumeAgent: 'Resumed agent',
    sendInput: 'Sent agent input',
    sendMessage: 'Sent agent message',
    spawnAgent: 'Spawned agent',
    wait: 'Waited for agents',
    started: 'Agent started',
    interacted: 'Agent interaction',
    interrupted: 'Agent interrupted',
    completed: 'Agent completed',
  };
  const agents = Object.entries(item.agentsStates || item.agents_states || {}).slice(0, 50)
    .map(([agentPath, state]) => {
      const opaqueIdentifier = /^(?:thread[-_])?[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(agentPath) ||
        /^(?:thread[-_:])?[a-f\d]{20,}$/i.test(agentPath);
      return {
        path: opaqueIdentifier ? '' : redactWorkspaceText(agentPath, options.workspaceRoot, 300),
        status: normalizeStatus(state?.status || state, 'info'),
        message: redactWorkspaceText(state?.message || '', options.workspaceRoot, 500),
      };
    })
    .filter((agent) => agent.path);
  const agentPath = redactWorkspaceText(
    item.agentPath || item.agent_path || '',
    options.workspaceRoot,
    300
  );
  return basePresentation(event, {
    category: 'collaboration',
    kind: 'collaboration',
    label: 'Agents',
    summary: labels[tool] || (agentPath ? `Agent activity · ${agentPath}` : 'Agent activity'),
    status,
    tone: status === 'running' ? 'live' : 'work',
    isIssue: status === 'failed' || status === 'cancelled',
    details: {
      tool,
      agentPath,
      agents,
      model: redactText(item.model || '', 160),
      reasoningEffort: redactText(item.reasoningEffort || item.reasoning_effort || '', 80),
      prompt: redactWorkspaceText(item.prompt || '', options.workspaceRoot, 3000),
    },
  });
}

function mediaPresentation(event, item, options) {
  const type = canonicalItemType(item.type);
  const status = normalizeStatus(item.status, eventLifecyclePhase(event, item) === 'started' ? 'running' : 'succeeded');
  const labels = {
    image_generation: status === 'running' ? 'Generating image' : 'Generated image',
    image_view: 'Viewed image',
  };
  return basePresentation(event, {
    category: 'work',
    kind: type,
    label: 'Media',
    summary: labels[type] || 'Media activity',
    status,
    tone: 'read',
    isIssue: status === 'failed',
    details: {
      artifact: workspaceRelativePath(item.savedPath || item.saved_path || item.path || '', options.workspaceRoot),
      failure: redactWorkspaceText(
        item.failure?.message || item.failure?.type || '',
        options.workspaceRoot,
        1000
      ),
    },
  });
}

function lifecyclePresentation(event) {
  const eventType = String(event?.eventType || '').toLowerCase();
  const payloadStatus = event?.payload?.turn?.status || event?.payload?.status || '';
  let status = normalizeStatus(payloadStatus, 'info');
  let summary = 'Turn lifecycle updated';
  let phase = eventLifecyclePhase(event, {});
  if (/^process[./_]started$/.test(eventType) || /turn[./_]started/.test(eventType)) {
    summary = 'Turn started';
    status = 'running';
    phase = 'started';
  } else if (/(?:turn[./_])(?:completed|succeeded)$/.test(eventType)) {
    summary = 'Turn completed';
    status = status === 'failed' ? 'failed' : 'succeeded';
    phase = 'completed';
  } else if (/(?:turn[./_])(?:failed|blocked|cancelled|canceled|timed_out)$/.test(eventType)) {
    status = normalizeStatus(eventType.split(/[./_]/).slice(1).join('_'), 'failed');
    summary = `Turn ${status.replace('_', ' ')}`;
    phase = 'completed';
  }
  return basePresentation(event, {
    category: 'lifecycle',
    kind: phase === 'started' ? 'turn_started' : 'turn_completed',
    label: 'Turn',
    summary,
    status,
    phase,
    tone: status === 'running' ? 'live' : (status === 'succeeded' ? 'success' : 'danger'),
    isIssue: ISSUE_STATUSES.has(status),
    details: {},
  });
}

function genericIssuePresentation(event, options) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const item = extractCodexItem(payload) || {};
  const error = item.error?.message || item.error || payload.error?.message || payload.error || '';
  const message = redactWorkspaceText(
    event?.text || payload.message || payload.warning || error || event?.eventType || 'Issue',
    options.workspaceRoot,
    4000
  );
  const status = normalizeStatus(item.status || payload.status || event?.severity, event?.severity === 'error' ? 'failed' : 'warning');
  return basePresentation(event, {
    category: 'issue',
    kind: 'issue',
    label: status === 'failed' ? 'Failure' : (status === 'cancelled' ? 'Cancellation' : 'Warning'),
    summary: clipText(message.replace(/\s+/g, ' ').trim(), 300),
    status,
    tone: status === 'failed' || event?.severity === 'error' ? 'danger' : 'warning',
    isIssue: true,
    details: { message },
  });
}

function limitIsApproaching(payload) {
  let approaching = false;
  const visit = (value, depth = 0) => {
    if (approaching || !value || typeof value !== 'object' || depth > 6) return;
    Object.entries(value).forEach(([key, child]) => {
      const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
      const numeric = Number(child);
      if ((normalizedKey.includes('used_percent') && numeric >= 80) ||
        (normalizedKey.includes('remaining_percent') && numeric <= 20)) {
        approaching = true;
      } else {
        visit(child, depth + 1);
      }
    });
  };
  visit(payload);
  return approaching;
}

function buildCodexEventPresentation(event, options = {}) {
  const item = extractCodexItem(event?.payload) || {};
  const itemType = canonicalItemType(item.type);
  const eventType = String(event?.eventType || event?.type || '').trim();
  const eventTypeLower = eventType.toLowerCase();

  if (itemType === 'agent_message' || itemType === 'user_message') return messagePresentation(event, item, options);
  if (itemType === 'reasoning') return reasoningPresentation(event, item, options);
  if (itemType === 'todo_list') return planPresentation(event, item, options);
  if (itemType === 'command_execution') return commandPresentation(event, item, options);
  if (itemType === 'file_change') return fileChangesPresentation(event, item, options);
  if (itemType === 'web_search') return webPresentation(event, item, options);
  if (itemType === 'mcp_tool_call' || itemType === 'dynamic_tool_call' || itemType === 'function_call_output') {
    return toolPresentation(event, item, options);
  }
  if (itemType === 'collab_agent_tool_call' || itemType === 'sub_agent_activity') {
    return collaborationPresentation(event, item, options);
  }
  if (itemType === 'image_generation' || itemType === 'image_view') return mediaPresentation(event, item, options);
  if (itemType === 'sleep') {
    const durationMs = numberOrNull(item.durationMs ?? item.duration_ms);
    const status = normalizeStatus(
      item.status,
      eventLifecyclePhase(event, item) === 'started' ? 'running' : 'succeeded'
    );
    return basePresentation(event, {
      category: 'work',
      kind: 'sleep',
      label: 'Wait',
      summary: durationMs === null ? 'Waiting' : `Waiting ${Math.round(durationMs / 1000)}s`,
      status,
      tone: 'read',
      isIssue: ISSUE_STATUSES.has(status),
      durationMs,
    });
  }
  if (itemType === 'entered_review_mode' || itemType === 'exited_review_mode') {
    return basePresentation(event, {
      category: 'work',
      kind: 'review',
      label: 'Review',
      summary: itemType === 'entered_review_mode' ? 'Review started' : 'Review completed',
      status: itemType === 'entered_review_mode' ? 'running' : 'succeeded',
      tone: 'read',
      details: { review: redactWorkspaceText(item.review || '', options.workspaceRoot, 3000) },
    });
  }
  if (itemType === 'context_compaction' || /compaction/.test(eventTypeLower)) {
    return basePresentation(event, {
      category: 'system',
      kind: 'context_compaction',
      label: 'Context',
      summary: 'Context compacted',
      status: 'succeeded',
      tone: 'neutral',
    });
  }
  if (itemType === 'hook_prompt') {
    return basePresentation(event, {
      category: 'system',
      kind: 'hook_prompt',
      label: 'Hook',
      summary: 'Hook context loaded',
      rawOnly: true,
    });
  }
  if (/(?:^|[./_])process[./_]started$/.test(eventTypeLower) ||
    /(?:^|[./_])turn[./_](?:started|completed|succeeded|failed|blocked|cancelled|canceled|timed_out)$/.test(eventTypeLower)) {
    return lifecyclePresentation(event);
  }

  const eventStatus = normalizeStatus(
    item.status || event?.payload?.status || event?.status || event?.severity,
    'info'
  );
  const explicitIssue = event?.severity === 'warning' || event?.severity === 'error' ||
    /(?:warning|configwarning|config_warning|error|failed|failure|cancelled|canceled|truncated)/i.test(eventType) ||
    event?.payload?.truncated === true || event?.payload?._truncated === true ||
    ISSUE_STATUSES.has(eventStatus);
  if (explicitIssue) return genericIssuePresentation(event, options);

  if (TELEMETRY_EVENT_PATTERN.test(eventType)) {
    if (!limitIsApproaching(event?.payload)) {
      return basePresentation(event, {
        category: 'telemetry',
        kind: 'telemetry',
        label: 'Telemetry',
        summary: eventType.replace(/[._/-]+/g, ' '),
        rawOnly: true,
      });
    }
    return basePresentation(event, {
      category: 'issue',
      kind: 'limit',
      label: 'Usage limit',
      summary: 'A Codex usage limit is approaching',
      status: 'warning',
      tone: 'warning',
      isIssue: true,
    });
  }

  const fallbackText = redactWorkspaceText(
    event?.text || event?.payload?.message || event?.payload?.summary || '',
    options.workspaceRoot,
    2000
  ).trim();
  return basePresentation(event, {
    category: 'system',
    kind: itemType || 'event',
    label: 'Process update',
    summary: fallbackText || eventType.replace(/[._/-]+/g, ' ') || 'Process update',
    tone: 'neutral',
  });
}

function mergeCompletedActivity(started, completed) {
  const startedAt = started.startedAt || started.timestamp || null;
  const completedAt = completed.completedAt || completed.timestamp || null;
  let durationMs = completed.durationMs;
  if (durationMs === null && startedAt && completedAt) {
    const calculated = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (Number.isFinite(calculated) && calculated >= 0) durationMs = calculated;
  }
  return {
    ...started,
    ...completed,
    id: completed.id || started.id,
    seq: completed.seq || started.seq,
    startedSeq: started.seq,
    startedAt,
    completedAt,
    durationMs,
    details: { ...started.details, ...completed.details },
  };
}

function presentationFingerprint(presentation) {
  return `${presentation.kind}|${presentation.status}|${String(presentation.summary || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

function presentCodexEvents(events, options = {}) {
  const output = [];
  const activeItemIndexes = new Map();
  let lastPlanSignature = '';

  (Array.isArray(events) ? events : []).forEach((event) => {
    const presentation = buildCodexEventPresentation(event, options);
    if (!presentation || presentation.rawOnly) return;

    if (presentation.itemId && START_RETAINED_ITEM_TYPES.has(canonicalItemType(extractCodexItem(event?.payload)?.type))) {
      const actionKey = `${presentation.kind}:${presentation.itemId}`;
      if (presentation.phase === 'started') {
        activeItemIndexes.set(actionKey, output.length);
      } else if (activeItemIndexes.has(actionKey)) {
        const index = activeItemIndexes.get(actionKey);
        output[index] = mergeCompletedActivity(output[index], presentation);
        activeItemIndexes.delete(actionKey);
        return;
      }
    }

    if (presentation.kind === 'plan') {
      const signature = JSON.stringify(presentation.details.items || []);
      if (signature === lastPlanSignature) return;
      lastPlanSignature = signature;
    }

    const previous = output[output.length - 1];
    if (presentation.kind === 'model_activity' && previous?.kind === 'model_activity') {
      previous.repeatCount = (previous.repeatCount || 1) + 1;
      previous.startedAt = previous.startedAt || previous.timestamp;
      previous.completedAt = presentation.timestamp;
      const elapsed = previous.startedAt && previous.completedAt
        ? Math.max(0, new Date(previous.completedAt).getTime() - new Date(previous.startedAt).getTime())
        : 0;
      previous.summary = `Model activity · ${previous.repeatCount} updates${elapsed ? ` over ${Math.round(elapsed / 1000)}s` : ''}`;
      previous.seq = presentation.seq;
      return;
    }

    const canCoalesce = presentation.isIssue || presentation.category === 'lifecycle';
    if (canCoalesce && previous && presentationFingerprint(previous) === presentationFingerprint(presentation)) {
      previous.repeatCount = (previous.repeatCount || 1) + 1;
      previous.startedAt = previous.startedAt || previous.timestamp;
      previous.completedAt = presentation.timestamp;
      previous.timestamp = presentation.timestamp || previous.timestamp;
      previous.seq = presentation.seq;
      return;
    }

    output.push(presentation);
  });
  return output;
}

function addCodexEventPresentation(event, options = {}) {
  const presentation = buildCodexEventPresentation(event, options);
  return presentation ? { ...event, presentation } : event;
}

function sanitizeRawEvent(event, options = {}) {
  const presentation = buildCodexEventPresentation(event, options);
  const payload = safeStructuredValue(event?.payload || {}, {
    workspaceRoot: options.workspaceRoot,
    textLimit: RAW_TEXT_LIMIT,
    totalTextLimit: 50000,
    arrayLimit: 100,
    objectKeyLimit: 100,
    entryLimit: 1400,
  });
  const text = redactWorkspaceText(event?.text || '', options.workspaceRoot, RAW_TEXT_LIMIT);
  return {
    id: String(event?.id || event?._id || ''),
    seq: Number(event?.seq) || 0,
    eventType: String(event?.eventType || 'event'),
    stream: String(event?.stream || 'system'),
    severity: String(event?.severity || 'info'),
    category: presentation?.category || 'system',
    summary: redactWorkspaceText(
      presentation?.summary || String(event?.eventType || 'Process update'),
      options.workspaceRoot,
      2000
    ),
    text,
    payload,
    truncated: Boolean(
      event?.payload?.truncated ||
      event?.payload?._truncated ||
      payload?._truncated ||
      text.includes('[output truncated]') ||
      /\[(?:additional text omitted|output truncated)\]/.test(JSON.stringify(payload))
    ),
    createdAt: eventTimestamp(event),
  };
}

module.exports = {
  START_RETAINED_ITEM_TYPES,
  addCodexEventPresentation,
  buildCodexEventPresentation,
  canonicalItemType,
  deterministicCommandSummary,
  extractCodexItem,
  mergeCompletedActivity,
  normalizeFileChangeKind,
  normalizeStatus,
  presentCodexEvents,
  redactText,
  renderAgentMessageMarkdown,
  safeStructuredValue,
  sanitizeRawEvent,
  stripAnsi,
  workspaceRelativePath,
};
