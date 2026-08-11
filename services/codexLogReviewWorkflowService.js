const AppSetting = require('../models/app_setting');
const CodexLogReviewRun = require('../models/codex_log_review_run');
const CodexSession = require('../models/codex_session');
const CodexTurn = require('../models/codex_turn');
const codexToolService = require('./codexToolService');
const logger = require('../utils/logger');
const {
  PUSHOVER_PRIORITIES,
  sendPushoverNotification,
} = require('../utils/pushover');
const { APP_SETTING_KEYS } = require('./data/defaultAppSettings');

const ANALYSIS_WORKSPACE_ID = '4ef51c48-3ecd-4ab1-ba3b-d8fe767f884b';
const FIX_WORKSPACE_ID = '3b73bde5-4b30-4731-a0e4-45c4180864f2';
const ANALYSIS_PROFILE_ID = 'max';
const FIX_PROFILE_ID = 'max';
const COMMIT_PROFILE_ID = 'fastest';
const INITIAL_LAST_RUN_AT = '2026-08-11T03:00:00.000Z';
const TOKYO_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
const TOKYO_MIDDAY_UTC_HOUR = 3;
const SCHEDULE_INTERVAL_DAYS = 10;
const LOG_WINDOW_DAYS = 7;
const USER_NOTES_MAX_LENGTH = 5000;
const DEFAULT_RETRY_DELAY_MS = 15 * 60 * 1000;
const FAILURE_NOTIFICATION_THRESHOLD = 3;
const TERMINAL_TURN_STATUSES = new Set([
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'blocked',
]);

const SYSTEM_USER = Object.freeze({
  _id: 'codex-log-review-workflow',
  name: 'Codex log review workflow',
});

const PHASE_CONFIG = Object.freeze({
  analysis: Object.freeze({
    workspaceId: ANALYSIS_WORKSPACE_ID,
    mode: 'question',
    permissionMode: 'yolo',
    requestProfileId: ANALYSIS_PROFILE_ID,
    pendingStatus: 'analysis_pending',
    activeStatus: 'analyzing',
    readyStatus: 'awaiting_fix',
  }),
  fix: Object.freeze({
    workspaceId: FIX_WORKSPACE_ID,
    mode: 'action',
    permissionMode: 'yolo',
    requestProfileId: FIX_PROFILE_ID,
    pendingStatus: 'fix_pending',
    activeStatus: 'fixing',
    readyStatus: 'awaiting_commit',
  }),
  commit: Object.freeze({
    workspaceId: FIX_WORKSPACE_ID,
    mode: 'action',
    permissionMode: 'yolo',
    requestProfileId: COMMIT_PROFILE_ID,
    pendingStatus: 'commit_pending',
    activeStatus: 'committing',
    readyStatus: 'completed',
  }),
});

const PENDING_PHASE_BY_STATUS = Object.freeze(Object.values(PHASE_CONFIG).reduce((result, config) => {
  result[config.pendingStatus] = Object.keys(PHASE_CONFIG).find((name) => PHASE_CONFIG[name] === config);
  return result;
}, {}));

const ACTIVE_PHASE_BY_STATUS = Object.freeze(Object.values(PHASE_CONFIG).reduce((result, config) => {
  result[config.activeStatus] = Object.keys(PHASE_CONFIG).find((name) => PHASE_CONFIG[name] === config);
  return result;
}, {}));

const STATUS_LABELS = Object.freeze({
  analysis_pending: 'Analysis waiting to start',
  analyzing: 'Analyzing logs',
  awaiting_fix: 'Your review is needed',
  fix_pending: 'Fix session waiting to start',
  fixing: 'Fixing reported issues',
  awaiting_commit: 'Your commit approval is needed',
  commit_pending: 'Commit turn waiting to start',
  committing: 'Committing and pushing',
  completed: 'Completed',
});

function asDate(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function tokyoMiddayDaysAfter(value, days = SCHEDULE_INTERVAL_DAYS) {
  const date = asDate(value);
  if (!date) {
    throw new TypeError('A valid date is required to calculate the next log review.');
  }
  const tokyoDate = new Date(date.getTime() + TOKYO_UTC_OFFSET_MS);
  return new Date(Date.UTC(
    tokyoDate.getUTCFullYear(),
    tokyoDate.getUTCMonth(),
    tokyoDate.getUTCDate() + days,
    TOKYO_MIDDAY_UTC_HOUR,
    0,
    0,
    0
  ));
}

function formatTokyoTimestamp(value) {
  const date = asDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(date);
}

function markdownFenceFor(text) {
  let fence = '```';
  const value = String(text || '');
  while (value.includes(fence)) {
    fence += '`';
  }
  return fence;
}

function buildAnalysisPrompt({ logWindowStart, logWindowEnd, runId }) {
  return [
    'Please have a look at the production app logs from the last 7 days and explain to me what you see.',
    '',
    `Review the precise window from ${formatTokyoTimestamp(logWindowStart)} through ${formatTokyoTimestamp(logWindowEnd)}.`,
    '',
    'If you see errors, repeated warnings, suspicious behavior, regressions, or other concerning content, inspect the relevant application code to determine the likely cause. Correlate related messages, distinguish actionable application issues from expected operational noise, and explain the evidence for each conclusion.',
    '',
    'Do not edit any files, change configuration, restart services, or attempt fixes. This is a read-only investigation even though the Codex turn has Yolo permission. Give concrete, prioritized suggestions for fixes instead.',
    '',
    'Structure the response as:',
    '1. Executive summary',
    '2. Findings, ordered by severity, with log evidence and likely code path',
    '3. Recommended fixes and verification steps',
    '4. Benign or expected noise worth noting',
    '',
    'If there are no concerning findings, say so clearly and summarize what was reviewed. Keep the report focused and under 12,000 characters so it can be passed verbatim into the implementation step.',
    '',
    `Workflow run reference: ${runId}`,
  ].join('\n');
}

function buildFixPrompt({ analysisResponse, userNotes, runId }) {
  const report = String(analysisResponse || '').trim();
  const notes = String(userNotes || '').trim();
  const reportFence = markdownFenceFor(report);
  const noteSection = notes
    ? `My notes and comments:\n\n${notes}`
    : 'My notes and comments:\n\nI have no additional guidance; use the report and your inspection of the current code.';

  return [
    'I have generated a production app log report below:',
    '',
    `${reportFence}text`,
    report,
    reportFence,
    '',
    noteSection,
    '',
    'Before editing, verify each reported issue against the current code and do not change behavior for findings that are benign, stale, or unsupported. Add or update focused tests where practical, run relevant verification, and preserve unrelated work in the repository.',
    '',
    `Workflow run reference: ${runId}`,
    '',
    'Lastly, fix the remaining issues appropriately.',
  ].join('\n');
}

function buildCommitPrompt() {
  return 'Please commit the pending changes and push to the online repository.';
}

function makeActor(user) {
  return {
    id: user && (user._id || user.id) ? String(user._id || user.id) : null,
    name: user && user.name ? String(user.name).slice(0, 120) : '',
  };
}

function normalizeNotes(value) {
  const notes = String(value || '').trim();
  if (notes.length > USER_NOTES_MAX_LENGTH) {
    const error = new Error(`Notes must be ${USER_NOTES_MAX_LENGTH.toLocaleString()} characters or fewer.`);
    error.statusCode = 400;
    throw error;
  }
  return notes;
}

function phaseDefinition(phaseName, prompt, requestedAt, requestedBy = {}) {
  const config = PHASE_CONFIG[phaseName];
  return {
    workspaceId: config.workspaceId,
    sessionId: '',
    turnId: '',
    codexThreadId: '',
    mode: config.mode,
    permissionMode: config.permissionMode,
    requestProfileId: config.requestProfileId,
    status: 'pending',
    prompt,
    response: '',
    requestedBy,
    requestedAt,
    startedAt: null,
    completedAt: null,
    lastAttemptAt: null,
    nextAttemptAt: requestedAt,
    attemptCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    lastError: '',
    readyNotificationSentAt: null,
    errorNotificationSentAt: null,
  };
}

function toPlain(value) {
  if (!value) return null;
  if (typeof value.toObject === 'function') {
    return value.toObject({ versionKey: false });
  }
  return { ...value };
}

function phaseForRunStatus(status) {
  return PENDING_PHASE_BY_STATUS[status] || ACTIVE_PHASE_BY_STATUS[status] || '';
}

function nextAttemptIsDue(phase, now) {
  if (!phase || !phase.nextAttemptAt) return true;
  const nextAttemptAt = asDate(phase.nextAttemptAt);
  return !nextAttemptAt || nextAttemptAt.getTime() <= now.getTime();
}

function isDuplicateKeyError(error) {
  return Boolean(error && (error.code === 11000 || error.code === 11001));
}

function shortError(error) {
  return String(error && error.message ? error.message : error || 'Unknown workflow error')
    .trim()
    .slice(0, 4000);
}

function serializeRun(runInput) {
  const run = toPlain(runInput);
  if (!run) return null;
  const status = run.status || 'analysis_pending';
  return {
    ...run,
    id: String(run._id || run.id || ''),
    status,
    statusLabel: STATUS_LABELS[status] || status.replace(/_/g, ' '),
    actionRequired: status === 'awaiting_fix' || status === 'awaiting_commit',
    processing: Boolean(PENDING_PHASE_BY_STATUS[status] || ACTIVE_PHASE_BY_STATUS[status]),
    pendingPhase: phaseForRunStatus(status),
  };
}

class CodexLogReviewWorkflowService {
  constructor({
    RunModel = CodexLogReviewRun,
    TurnModel = CodexTurn,
    SessionModel = CodexSession,
    AppSettingModel = AppSetting,
    codexService = codexToolService,
    notificationSender = sendPushoverNotification,
    log = logger,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = {}) {
    this.RunModel = RunModel;
    this.TurnModel = TurnModel;
    this.SessionModel = SessionModel;
    this.AppSettingModel = AppSettingModel;
    this.codexService = codexService;
    this.notificationSender = notificationSender;
    this.log = log;
    this.retryDelayMs = retryDelayMs;
  }

  publicConfig() {
    return {
      analysisWorkspaceId: ANALYSIS_WORKSPACE_ID,
      fixWorkspaceId: FIX_WORKSPACE_ID,
      analysisProfileId: ANALYSIS_PROFILE_ID,
      fixProfileId: FIX_PROFILE_ID,
      commitProfileId: COMMIT_PROFILE_ID,
      initialLastRunAt: INITIAL_LAST_RUN_AT,
      intervalDays: SCHEDULE_INTERVAL_DAYS,
      logWindowDays: LOG_WINDOW_DAYS,
      timeZone: 'Asia/Tokyo',
      scheduledHour: 12,
      userNotesMaxLength: USER_NOTES_MAX_LENGTH,
    };
  }

  async ensureScheduleSetting() {
    const key = APP_SETTING_KEYS.CODEX_LOG_REVIEW_LAST_RUN_AT;
    let setting = await this.AppSettingModel.findOne({ key }).lean().exec();
    if (!setting) {
      try {
        await this.AppSettingModel.updateOne(
          { key },
          {
            $setOnInsert: {
              key,
              value: INITIAL_LAST_RUN_AT,
              description: 'Last successful scheduled start for the Codex production log review workflow. The initial value anchors the first run at 2026-08-21 12:00 JST.',
              createdBy: 'codex-log-review',
              updatedBy: 'codex-log-review',
            },
          },
          { upsert: true }
        ).exec();
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      setting = await this.AppSettingModel.findOne({ key }).lean().exec();
    }

    const lastRunAt = asDate(setting && setting.value);
    if (!lastRunAt) {
      throw new Error(`App setting "${key}" must contain a valid ISO date.`);
    }
    return { setting, lastRunAt };
  }

  async recordLastRunAt(value) {
    const date = asDate(value);
    if (!date) throw new TypeError('Cannot store an invalid log review run date.');
    const key = APP_SETTING_KEYS.CODEX_LOG_REVIEW_LAST_RUN_AT;
    await this.AppSettingModel.updateOne(
      { key },
      {
        $set: {
          value: date.toISOString(),
          updatedBy: 'codex-log-review',
        },
        $setOnInsert: {
          key,
          description: 'Last successful scheduled start for the Codex production log review workflow.',
          createdBy: 'codex-log-review',
        },
      },
      { upsert: true }
    ).exec();
    return date;
  }

  async getNextScheduledAt() {
    const { lastRunAt } = await this.ensureScheduleSetting();
    return tokyoMiddayDaysAfter(lastRunAt);
  }

  async ensureDueRun(nowInput = new Date()) {
    const now = asDate(nowInput, new Date());
    const { lastRunAt } = await this.ensureScheduleSetting();
    const scheduledFor = tokyoMiddayDaysAfter(lastRunAt);
    if (scheduledFor.getTime() > now.getTime()) {
      return null;
    }

    let existing = await this.RunModel.findOne({ scheduledFor }).exec();
    if (existing) {
      if (existing.analysis && existing.analysis.sessionId && existing.startedAt) {
        await this.recordLastRunAt(existing.startedAt);
      }
      return existing;
    }

    const logWindowEnd = now;
    const logWindowStart = new Date(now.getTime() - (LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    const run = new this.RunModel({
      status: 'analysis_pending',
      scheduledFor,
      logWindowStart,
      logWindowEnd,
    });
    run.analysis = phaseDefinition('analysis', buildAnalysisPrompt({
      logWindowStart,
      logWindowEnd,
      runId: String(run._id),
    }), now, makeActor(SYSTEM_USER));

    try {
      await run.save();
      await this.log.notice('Scheduled Codex log review run created', {
        category: 'codex_log_review',
        metadata: { runId: String(run._id), scheduledFor },
      });
      return run;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      existing = await this.RunModel.findOne({ scheduledFor }).exec();
      return existing;
    }
  }

  async tick(nowInput = new Date()) {
    const now = asDate(nowInput, new Date());
    const dueRun = await this.ensureDueRun(now);
    await this.reconcileActiveRuns(now);
    await this.startPendingRuns(now);
    await this.deliverNotifications();
    return {
      dueRunId: dueRun ? String(dueRun._id) : null,
      nextScheduledAt: await this.getNextScheduledAt(),
    };
  }

  async reconcileActiveRuns(nowInput = new Date()) {
    const now = asDate(nowInput, new Date());
    const runs = await this.RunModel.find({
      status: { $in: Object.keys(ACTIVE_PHASE_BY_STATUS) },
    }).lean().exec();

    for (const run of runs) {
      try {
        await this.reconcileRun(run, now);
      } catch (error) {
        await this.log.error('Unable to reconcile a Codex log review run', {
          category: 'codex_log_review',
          metadata: { runId: String(run._id), error: shortError(error) },
        });
      }
    }
  }

  async reconcileRun(runInput, nowInput = new Date()) {
    const run = toPlain(runInput);
    const now = asDate(nowInput, new Date());
    const phaseName = ACTIVE_PHASE_BY_STATUS[run.status];
    if (!phaseName) return serializeRun(run);
    const config = PHASE_CONFIG[phaseName];
    const phase = run[phaseName] || {};

    if (!phase.turnId) {
      await this.recordPhaseFailure(run._id, phaseName, 'The workflow lost its Codex turn reference.', now);
      return null;
    }

    const turn = await this.TurnModel.findById(phase.turnId).lean().exec();
    if (!turn) {
      await this.recordPhaseFailure(run._id, phaseName, 'The referenced Codex turn no longer exists.', now);
      return null;
    }

    if (!TERMINAL_TURN_STATUSES.has(turn.status)) {
      if (phase.status !== turn.status) {
        await this.RunModel.updateOne(
          { _id: run._id, status: config.activeStatus },
          { $set: { [`${phaseName}.status`]: turn.status } }
        ).exec();
      }
      return serializeRun(run);
    }

    if (turn.status !== 'succeeded') {
      const errorMessage = turn.errorMessage || `Codex turn ended with status ${turn.status}.`;
      await this.recordPhaseFailure(run._id, phaseName, errorMessage, now, turn.status);
      return null;
    }

    let codexThreadId = turn.codexThreadIdSeen || phase.codexThreadId || '';
    if (!codexThreadId && phase.sessionId) {
      const session = await this.SessionModel.findById(phase.sessionId).lean().exec();
      codexThreadId = session && session.codexThreadId ? session.codexThreadId : '';
    }

    const set = {
      status: config.readyStatus,
      [`${phaseName}.status`]: 'succeeded',
      [`${phaseName}.response`]: turn.finalResponse || '',
      [`${phaseName}.codexThreadId`]: codexThreadId,
      [`${phaseName}.completedAt`]: turn.completedAt || now,
      [`${phaseName}.nextAttemptAt`]: null,
      [`${phaseName}.consecutiveFailures`]: 0,
      [`${phaseName}.lastError`]: '',
    };
    if (phaseName === 'commit') {
      set.completedAt = turn.completedAt || now;
    }

    await this.RunModel.updateOne(
      { _id: run._id, status: config.activeStatus, [`${phaseName}.turnId`]: phase.turnId },
      { $set: set }
    ).exec();
    await this.log.notice('Codex log review phase completed', {
      category: 'codex_log_review',
      metadata: { runId: String(run._id), phase: phaseName, turnId: String(turn._id) },
    });
    return null;
  }

  async startPendingRuns(nowInput = new Date()) {
    const now = asDate(nowInput, new Date());
    const runs = await this.RunModel.find({
      status: { $in: Object.keys(PENDING_PHASE_BY_STATUS) },
    }).lean().exec();

    for (const run of runs) {
      const phaseName = PENDING_PHASE_BY_STATUS[run.status];
      if (!nextAttemptIsDue(run[phaseName], now)) continue;
      await this.startPendingRun(String(run._id), now);
    }
  }

  async startPendingRun(runId, nowInput = new Date()) {
    const now = asDate(nowInput, new Date());
    const snapshot = await this.RunModel.findById(runId).lean().exec();
    if (!snapshot) return null;
    const phaseName = PENDING_PHASE_BY_STATUS[snapshot.status];
    if (!phaseName || !nextAttemptIsDue(snapshot[phaseName], now)) return serializeRun(snapshot);
    const config = PHASE_CONFIG[phaseName];
    const nextAttemptAt = new Date(now.getTime() + this.retryDelayMs);
    const nextAttemptPath = `${phaseName}.nextAttemptAt`;

    const claimed = await this.RunModel.findOneAndUpdate(
      {
        _id: runId,
        status: config.pendingStatus,
        $or: [
          { [nextAttemptPath]: null },
          { [nextAttemptPath]: { $lte: now } },
        ],
      },
      {
        $set: {
          [`${phaseName}.lastAttemptAt`]: now,
          [nextAttemptPath]: nextAttemptAt,
        },
        $inc: { [`${phaseName}.attemptCount`]: 1 },
      },
      { returnDocument: 'after' }
    ).lean().exec();
    if (!claimed) return null;

    try {
      const recovered = await this.recoverOrRetryCodexTurn(claimed, phaseName);
      const result = recovered || await this.submitCodexPhase(claimed, phaseName);
      const acceptedAt = asDate(result.turn && (result.turn.queuedAt || result.turn.createdAt), now);
      const isFirstAnalysisStart = phaseName === 'analysis' && !asDate(claimed.startedAt);
      const update = {
        status: config.activeStatus,
        [`${phaseName}.sessionId`]: String(result.session && result.session.id || result.turn.sessionId || ''),
        [`${phaseName}.turnId`]: String(result.turn && result.turn.id || result.turn._id || ''),
        [`${phaseName}.codexThreadId`]: String(result.session && result.session.codexThreadId || ''),
        [`${phaseName}.status`]: result.turn && result.turn.status || 'queued',
        [`${phaseName}.startedAt`]: acceptedAt,
        [`${phaseName}.nextAttemptAt`]: null,
      };
      if (isFirstAnalysisStart) {
        update.startedAt = acceptedAt;
      }

      const updated = await this.RunModel.findOneAndUpdate(
        { _id: runId, status: config.pendingStatus },
        { $set: update },
        { returnDocument: 'after' }
      ).lean().exec();

      if (updated && isFirstAnalysisStart) {
        await this.recordLastRunAt(acceptedAt);
      }
      if (updated) {
        await this.log.notice('Codex log review phase queued', {
          category: 'codex_log_review',
          metadata: {
            runId,
            phase: phaseName,
            sessionId: update[`${phaseName}.sessionId`],
            turnId: update[`${phaseName}.turnId`],
            recovered: Boolean(recovered),
          },
        });
      }
      return serializeRun(updated);
    } catch (error) {
      await this.recordPhaseFailure(runId, phaseName, error, now);
      return null;
    }
  }

  async recoverOrRetryCodexTurn(runInput, phaseName) {
    const run = toPlain(runInput);
    const phase = run && run[phaseName] || {};
    if (phase.turnId) {
      const turn = await this.TurnModel.findById(phase.turnId).lean().exec();
      if (turn && TERMINAL_TURN_STATUSES.has(turn.status) && turn.status !== 'succeeded') {
        return this.codexService.retryTurn(phase.turnId, SYSTEM_USER);
      }
      if (turn) {
        const session = await this.SessionModel.findById(turn.sessionId).lean().exec();
        return {
          accepted: true,
          session: session ? this.codexService.serializeSession(session) : { id: String(turn.sessionId || '') },
          turn: this.codexService.serializeTurn(turn),
        };
      }
    }
    return this.findExistingCodexTurn(run, phaseName);
  }

  async findExistingCodexTurn(runInput, phaseName) {
    const run = toPlain(runInput);
    const phase = run[phaseName] || {};
    const requestedAt = asDate(phase.requestedAt || run.createdAt, new Date(0));
    const query = {
      prompt: phase.prompt,
      queuedAt: { $gte: new Date(requestedAt.getTime() - 60 * 1000) },
    };
    if (phaseName === 'commit') {
      query.sessionId = run.fix && run.fix.sessionId;
      query.kind = 'followup_action';
    } else {
      query.workspaceId = phase.workspaceId;
      query.kind = phaseName === 'analysis' ? 'question' : 'action';
    }

    const turn = await this.TurnModel.findOne(query).sort({ createdAt: -1 }).lean().exec();
    if (!turn) return null;
    const session = await this.SessionModel.findById(turn.sessionId).lean().exec();
    return {
      accepted: true,
      session: session ? this.codexService.serializeSession(session) : { id: String(turn.sessionId || '') },
      turn: this.codexService.serializeTurn(turn),
    };
  }

  async submitCodexPhase(runInput, phaseName) {
    const run = toPlain(runInput);
    const phase = run && run[phaseName];
    const config = PHASE_CONFIG[phaseName];
    if (!run || !phase || !config) {
      throw new Error('Unknown Codex log review phase.');
    }
    const payload = {
      prompt: phase.prompt,
      mode: config.mode,
      permissionMode: config.permissionMode,
      confirmYolo: true,
      requestProfileId: config.requestProfileId,
      modelProvider: 'openai',
    };

    if (phaseName === 'commit') {
      const fixSessionId = run.fix && run.fix.sessionId;
      if (!fixSessionId) {
        throw new Error('The fix Codex session is missing, so the commit follow-up cannot start.');
      }
      return this.codexService.createFollowupTurn(fixSessionId, payload, SYSTEM_USER);
    }

    return this.codexService.createSession({
      ...payload,
      workspaceId: config.workspaceId,
    }, SYSTEM_USER);
  }

  async recordPhaseFailure(runId, phaseName, error, nowInput = new Date(), turnStatus = 'failed') {
    const now = asDate(nowInput, new Date());
    const config = PHASE_CONFIG[phaseName];
    if (!config) return null;
    const message = shortError(error);
    const update = await this.RunModel.findOneAndUpdate(
      {
        _id: runId,
        status: { $in: [config.pendingStatus, config.activeStatus] },
      },
      {
        $set: {
          status: config.pendingStatus,
          [`${phaseName}.status`]: turnStatus === 'queued' || turnStatus === 'running' ? 'failed' : turnStatus,
          [`${phaseName}.lastError`]: message,
          [`${phaseName}.nextAttemptAt`]: new Date(now.getTime() + this.retryDelayMs),
        },
        $inc: {
          [`${phaseName}.failureCount`]: 1,
          [`${phaseName}.consecutiveFailures`]: 1,
        },
      },
      { returnDocument: 'after' }
    ).lean().exec();
    await this.log.warning('Codex log review phase will retry', {
      category: 'codex_log_review',
      metadata: { runId: String(runId), phase: phaseName, error: message },
    });
    return serializeRun(update);
  }

  async requestFix(runId, notesInput, user, nowInput = new Date()) {
    const now = asDate(nowInput, new Date());
    const run = await this.RunModel.findById(runId).lean().exec();
    if (!run) {
      const error = new Error('Log review run not found.');
      error.statusCode = 404;
      throw error;
    }
    if (run.status !== 'awaiting_fix') {
      const error = new Error('This run is not waiting for fix guidance.');
      error.statusCode = 409;
      throw error;
    }
    if (!String(run.analysis && run.analysis.response || '').trim()) {
      const error = new Error('The analysis response is empty, so a fix session cannot be prepared.');
      error.statusCode = 409;
      throw error;
    }

    const userNotes = normalizeNotes(notesInput);
    const prompt = buildFixPrompt({
      analysisResponse: run.analysis.response,
      userNotes,
      runId: String(run._id),
    });
    this.assertPromptFits(prompt);
    const updated = await this.RunModel.findOneAndUpdate(
      { _id: runId, status: 'awaiting_fix' },
      {
        $set: {
          status: 'fix_pending',
          userNotes,
          fix: phaseDefinition('fix', prompt, now, makeActor(user)),
        },
      },
      { returnDocument: 'after' }
    ).lean().exec();
    if (!updated) {
      const error = new Error('The run changed while the fix request was being prepared. Refresh and try again.');
      error.statusCode = 409;
      throw error;
    }
    await this.startPendingRun(runId, now);
    return this.getRun(runId);
  }

  async requestCommit(runId, user, nowInput = new Date()) {
    const now = asDate(nowInput, new Date());
    const run = await this.RunModel.findById(runId).lean().exec();
    if (!run) {
      const error = new Error('Log review run not found.');
      error.statusCode = 404;
      throw error;
    }
    if (run.status !== 'awaiting_commit') {
      const error = new Error('This run is not waiting for commit approval.');
      error.statusCode = 409;
      throw error;
    }
    if (!run.fix || !run.fix.sessionId) {
      const error = new Error('The fix Codex session is missing.');
      error.statusCode = 409;
      throw error;
    }

    const prompt = buildCommitPrompt();
    const updated = await this.RunModel.findOneAndUpdate(
      { _id: runId, status: 'awaiting_commit' },
      {
        $set: {
          status: 'commit_pending',
          commit: phaseDefinition('commit', prompt, now, makeActor(user)),
        },
      },
      { returnDocument: 'after' }
    ).lean().exec();
    if (!updated) {
      const error = new Error('The run changed while the commit request was being prepared. Refresh and try again.');
      error.statusCode = 409;
      throw error;
    }
    await this.startPendingRun(runId, now);
    return this.getRun(runId);
  }

  async retryNow(runId, nowInput = new Date()) {
    const now = asDate(nowInput, new Date());
    const run = await this.RunModel.findById(runId).lean().exec();
    if (!run) {
      const error = new Error('Log review run not found.');
      error.statusCode = 404;
      throw error;
    }
    const phaseName = PENDING_PHASE_BY_STATUS[run.status];
    if (!phaseName) {
      const error = new Error('This workflow phase is not waiting for an automatic retry.');
      error.statusCode = 409;
      throw error;
    }
    await this.RunModel.updateOne(
      { _id: runId, status: run.status },
      { $set: { [`${phaseName}.nextAttemptAt`]: now } }
    ).exec();
    await this.startPendingRun(runId, now);
    return this.getRun(runId);
  }

  assertPromptFits(prompt) {
    const maximum = this.codexService.getRuntimeConfig().maxPromptChars;
    if (String(prompt || '').length > maximum) {
      const error = new Error(`The combined report and notes exceed the Codex prompt limit of ${maximum.toLocaleString()} characters.`);
      error.statusCode = 400;
      throw error;
    }
  }

  async deliverNotifications() {
    const runs = await this.RunModel.find({ status: { $ne: 'completed' } }).lean().exec();
    for (const run of runs) {
      if (run.status === 'awaiting_fix' && !run.analysis?.readyNotificationSentAt) {
        await this.sendReadyNotification(run, 'analysis');
      }
      if (run.status === 'awaiting_commit' && !run.fix?.readyNotificationSentAt) {
        await this.sendReadyNotification(run, 'fix');
      }
      for (const phaseName of Object.keys(PHASE_CONFIG)) {
        const phase = run[phaseName];
        if (Number(phase && phase.consecutiveFailures) >= FAILURE_NOTIFICATION_THRESHOLD && !phase.errorNotificationSentAt) {
          await this.sendFailureNotification(run, phaseName);
        }
      }
    }
  }

  async sendReadyNotification(run, phaseName) {
    const isAnalysis = phaseName === 'analysis';
    try {
      await this.notificationSender({
        title: isAnalysis ? 'Production log report ready' : 'Production fixes ready for review',
        message: isAnalysis
          ? `The log report is ready. Review it and add any guidance before starting fixes in /codex-log-review/runs/${run._id}.`
          : `The fixes are ready. Review them before approving commit and push in /codex-log-review/runs/${run._id}.`,
        priority: PUSHOVER_PRIORITIES.MEDIUM,
      });
      await this.RunModel.updateOne(
        { _id: run._id, status: PHASE_CONFIG[phaseName].readyStatus },
        { $set: { [`${phaseName}.readyNotificationSentAt`]: new Date() } }
      ).exec();
    } catch (error) {
      await this.log.error('Unable to send Codex log review handoff notification', {
        category: 'codex_log_review',
        metadata: { runId: String(run._id), phase: phaseName, error: shortError(error) },
      });
    }
  }

  async sendFailureNotification(run, phaseName) {
    const phase = run[phaseName] || {};
    try {
      await this.notificationSender({
        title: 'Production log workflow needs attention',
        message: `The ${phaseName} phase has failed ${phase.consecutiveFailures} times and will keep retrying. Latest error: ${String(phase.lastError || 'Unknown error').slice(0, 500)}`,
        priority: PUSHOVER_PRIORITIES.MEDIUM,
      });
      await this.RunModel.updateOne(
        { _id: run._id, [`${phaseName}.errorNotificationSentAt`]: null },
        { $set: { [`${phaseName}.errorNotificationSentAt`]: new Date() } }
      ).exec();
    } catch (error) {
      await this.log.error('Unable to send repeated Codex log review error notification', {
        category: 'codex_log_review',
        metadata: { runId: String(run._id), phase: phaseName, error: shortError(error) },
      });
    }
  }

  async getDashboard() {
    const activeRuns = await this.RunModel.find({ status: { $ne: 'completed' } })
      .sort({ scheduledFor: 1 })
      .lean()
      .exec();
    const current = activeRuns.find((run) => run.status === 'awaiting_fix' || run.status === 'awaiting_commit')
      || activeRuns[0]
      || null;
    const historyQuery = current ? { _id: { $ne: current._id } } : {};
    const previousRuns = await this.RunModel.find(historyQuery)
      .sort({ scheduledFor: -1 })
      .limit(10)
      .lean()
      .exec();
    return {
      currentRun: serializeRun(current),
      previousRuns: previousRuns.map(serializeRun),
      nextScheduledAt: await this.getNextScheduledAt(),
      config: this.publicConfig(),
    };
  }

  async getRun(runId) {
    const run = await this.RunModel.findById(runId).lean().exec();
    if (!run) {
      const error = new Error('Log review run not found.');
      error.statusCode = 404;
      throw error;
    }
    return serializeRun(run);
  }
}

const codexLogReviewWorkflowService = new CodexLogReviewWorkflowService();

module.exports = {
  ANALYSIS_PROFILE_ID,
  ANALYSIS_WORKSPACE_ID,
  COMMIT_PROFILE_ID,
  CodexLogReviewWorkflowService,
  FAILURE_NOTIFICATION_THRESHOLD,
  FIX_PROFILE_ID,
  FIX_WORKSPACE_ID,
  INITIAL_LAST_RUN_AT,
  LOG_WINDOW_DAYS,
  PHASE_CONFIG,
  SCHEDULE_INTERVAL_DAYS,
  STATUS_LABELS,
  USER_NOTES_MAX_LENGTH,
  buildAnalysisPrompt,
  buildCommitPrompt,
  buildFixPrompt,
  codexLogReviewWorkflowService,
  formatTokyoTimestamp,
  markdownFenceFor,
  phaseDefinition,
  serializeRun,
  tokyoMiddayDaysAfter,
};
