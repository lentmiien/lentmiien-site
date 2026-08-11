const CodexLogReviewRun = require('../../models/codex_log_review_run');
const {
  ANALYSIS_PROFILE_ID,
  ANALYSIS_WORKSPACE_ID,
  COMMIT_PROFILE_ID,
  CodexLogReviewWorkflowService,
  FIX_PROFILE_ID,
  FIX_WORKSPACE_ID,
  INITIAL_LAST_RUN_AT,
  buildAnalysisPrompt,
  buildCommitPrompt,
  buildFixPrompt,
  markdownFenceFor,
  phaseDefinition,
  tokyoMiddayDaysAfter,
} = require('../../services/codexLogReviewWorkflowService');

describe('Codex production log review workflow', () => {
  function leanExec(value) {
    return {
      lean: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(value) })),
    };
  }

  function execResult(value = {}) {
    return { exec: jest.fn().mockResolvedValue(value) };
  }

  test('anchors the first run ten days later at noon in Tokyo', () => {
    expect(tokyoMiddayDaysAfter(INITIAL_LAST_RUN_AT).toISOString())
      .toBe('2026-08-21T03:00:00.000Z');
    expect(tokyoMiddayDaysAfter('2026-08-21T13:45:00.000Z').toISOString())
      .toBe('2026-08-31T03:00:00.000Z');
  });

  test('builds a bounded read-only investigation prompt with the exact log window', () => {
    const prompt = buildAnalysisPrompt({
      logWindowStart: new Date('2026-08-14T03:00:00.000Z'),
      logWindowEnd: new Date('2026-08-21T03:00:00.000Z'),
      runId: 'run-analysis',
    });

    expect(prompt).toContain('production app logs from the last 7 days');
    expect(prompt).toContain('2026-08-14');
    expect(prompt).toContain('2026-08-21');
    expect(prompt).toContain('Do not edit any files');
    expect(prompt).toContain('under 12,000 characters');
    expect(prompt).toContain('Workflow run reference: run-analysis');
  });

  test('copies the analysis and optional user guidance into a safe fix prompt', () => {
    const report = 'Finding with a nested fence:\n```js\nthrow new Error();\n```';
    const prompt = buildFixPrompt({
      analysisResponse: report,
      userNotes: 'Prioritize the retry bug.',
      runId: 'run-fix',
    });

    expect(markdownFenceFor(report)).toBe('````');
    expect(prompt).toContain('I have generated a production app log report below:');
    expect(prompt).toContain(report);
    expect(prompt).toContain('Prioritize the retry bug.');
    expect(prompt).toContain('Lastly, fix the remaining issues appropriately.');
    expect(prompt).toContain('Workflow run reference: run-fix');
  });

  test('submits all three phases through the Codex tool with the requested controls', async () => {
    const codexService = {
      createSession: jest.fn()
        .mockResolvedValueOnce({ session: { id: 'analysis-session' }, turn: { id: 'analysis-turn' } })
        .mockResolvedValueOnce({ session: { id: 'fix-session' }, turn: { id: 'fix-turn' } }),
      createFollowupTurn: jest.fn().mockResolvedValue({
        session: { id: 'fix-session' },
        turn: { id: 'commit-turn' },
      }),
      getRuntimeConfig: jest.fn(() => ({ maxPromptChars: 20000 })),
    };
    const service = new CodexLogReviewWorkflowService({ codexService });
    const now = new Date('2026-08-21T03:00:00.000Z');
    const run = {
      analysis: phaseDefinition('analysis', 'Analyze prompt', now),
      fix: {
        ...phaseDefinition('fix', 'Fix prompt', now),
        sessionId: 'fix-session',
      },
      commit: phaseDefinition('commit', buildCommitPrompt(), now),
    };

    await service.submitCodexPhase(run, 'analysis');
    await service.submitCodexPhase(run, 'fix');
    await service.submitCodexPhase(run, 'commit');

    expect(codexService.createSession).toHaveBeenNthCalledWith(1, {
      prompt: 'Analyze prompt',
      mode: 'question',
      permissionMode: 'yolo',
      confirmYolo: true,
      requestProfileId: ANALYSIS_PROFILE_ID,
      modelProvider: 'openai',
      workspaceId: ANALYSIS_WORKSPACE_ID,
    }, expect.objectContaining({ name: 'Codex log review workflow' }));
    expect(codexService.createSession).toHaveBeenNthCalledWith(2, {
      prompt: 'Fix prompt',
      mode: 'action',
      permissionMode: 'yolo',
      confirmYolo: true,
      requestProfileId: FIX_PROFILE_ID,
      modelProvider: 'openai',
      workspaceId: FIX_WORKSPACE_ID,
    }, expect.objectContaining({ name: 'Codex log review workflow' }));
    expect(codexService.createFollowupTurn).toHaveBeenCalledWith('fix-session', {
      prompt: 'Please commit the pending changes and push to the online repository.',
      mode: 'action',
      permissionMode: 'yolo',
      confirmYolo: true,
      requestProfileId: COMMIT_PROFILE_ID,
      modelProvider: 'openai',
    }, expect.objectContaining({ name: 'Codex log review workflow' }));
  });

  test('stores workflow session references, prompts, and copied responses', async () => {
    const run = new CodexLogReviewRun({
      scheduledFor: new Date('2026-08-21T03:00:00.000Z'),
      logWindowStart: new Date('2026-08-14T03:00:00.000Z'),
      logWindowEnd: new Date('2026-08-21T03:00:00.000Z'),
      analysis: {
        workspaceId: ANALYSIS_WORKSPACE_ID,
        sessionId: 'analysis-session',
        turnId: 'analysis-turn',
        prompt: 'Analysis input',
        response: 'Analysis output',
        status: 'succeeded',
      },
      fix: {
        workspaceId: FIX_WORKSPACE_ID,
        sessionId: 'fix-session',
        turnId: 'fix-turn',
        prompt: 'Fix input',
        response: 'Fix output',
        status: 'succeeded',
      },
    });

    await expect(run.validate()).resolves.toBeUndefined();
    expect(run.analysis.sessionId).toBe('analysis-session');
    expect(run.analysis.prompt).toBe('Analysis input');
    expect(run.analysis.response).toBe('Analysis output');
    expect(run.fix.sessionId).toBe('fix-session');
    expect(run.fix.response).toBe('Fix output');
  });

  test('copies a successful Codex response before exposing the human fix task', async () => {
    const completedAt = new Date('2026-08-21T03:05:00.000Z');
    const TurnModel = {
      findById: jest.fn(() => leanExec({
        _id: 'analysis-turn',
        sessionId: 'analysis-session',
        status: 'succeeded',
        finalResponse: 'Stored report output',
        codexThreadIdSeen: 'thread-1',
        completedAt,
      })),
    };
    const RunModel = {
      updateOne: jest.fn(() => execResult()),
    };
    const service = new CodexLogReviewWorkflowService({
      RunModel,
      TurnModel,
      SessionModel: {},
      log: { notice: jest.fn().mockResolvedValue(), warning: jest.fn(), error: jest.fn() },
    });
    const run = {
      _id: 'run-1',
      status: 'analyzing',
      analysis: {
        turnId: 'analysis-turn',
        sessionId: 'analysis-session',
        status: 'running',
      },
    };

    await service.reconcileRun(run, completedAt);

    expect(RunModel.updateOne).toHaveBeenCalledWith(
      { _id: 'run-1', status: 'analyzing', 'analysis.turnId': 'analysis-turn' },
      { $set: expect.objectContaining({
        status: 'awaiting_fix',
        'analysis.status': 'succeeded',
        'analysis.response': 'Stored report output',
        'analysis.codexThreadId': 'thread-1',
      }) }
    );
  });

  test('persists user notes and the generated fix prompt before attempting Codex', async () => {
    const now = new Date('2026-08-21T04:00:00.000Z');
    const run = {
      _id: 'run-fix-request',
      status: 'awaiting_fix',
      analysis: { response: 'Investigate the retry loop.' },
    };
    const updated = { ...run, status: 'fix_pending' };
    const RunModel = {
      findById: jest.fn(() => leanExec(run)),
      findOneAndUpdate: jest.fn(() => leanExec(updated)),
    };
    const service = new CodexLogReviewWorkflowService({
      RunModel,
      codexService: { getRuntimeConfig: jest.fn(() => ({ maxPromptChars: 20000 })) },
    });
    service.startPendingRun = jest.fn().mockResolvedValue();
    service.getRun = jest.fn().mockResolvedValue({ id: 'run-fix-request', status: 'fix_pending' });

    await service.requestFix('run-fix-request', 'Keep the API compatible.', { _id: 'user-1', name: 'Lennart' }, now);

    expect(RunModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'run-fix-request', status: 'awaiting_fix' },
      { $set: expect.objectContaining({
        status: 'fix_pending',
        userNotes: 'Keep the API compatible.',
        fix: expect.objectContaining({
          workspaceId: FIX_WORKSPACE_ID,
          requestProfileId: FIX_PROFILE_ID,
          prompt: expect.stringContaining('Investigate the retry loop.'),
          requestedBy: { id: 'user-1', name: 'Lennart' },
        }),
      }) },
      { returnDocument: 'after' }
    );
    expect(service.startPendingRun).toHaveBeenCalledWith('run-fix-request', now);
  });

  test('does not shift the ten-day cadence when retrying an existing analysis run', async () => {
    const initialStartedAt = new Date('2026-08-21T03:00:00.000Z');
    const retryAt = new Date('2026-08-21T04:00:00.000Z');
    const run = {
      _id: 'run-analysis-retry',
      status: 'analysis_pending',
      startedAt: initialStartedAt,
      analysis: {
        ...phaseDefinition('analysis', 'Analyze prompt', initialStartedAt),
        sessionId: 'analysis-session',
        turnId: 'failed-turn',
        nextAttemptAt: retryAt,
      },
    };
    const acceptedRun = {
      ...run,
      status: 'analyzing',
      analysis: { ...run.analysis, turnId: 'retry-turn', status: 'queued' },
    };
    const RunModel = {
      findById: jest.fn(() => leanExec(run)),
      findOneAndUpdate: jest.fn()
        .mockReturnValueOnce(leanExec(run))
        .mockReturnValueOnce(leanExec(acceptedRun)),
    };
    const TurnModel = {
      findById: jest.fn(() => leanExec({ _id: 'failed-turn', status: 'failed' })),
    };
    const codexService = {
      retryTurn: jest.fn().mockResolvedValue({
        session: { id: 'analysis-session' },
        turn: { id: 'retry-turn', sessionId: 'analysis-session', status: 'queued', queuedAt: retryAt },
      }),
    };
    const service = new CodexLogReviewWorkflowService({
      RunModel,
      TurnModel,
      codexService,
      log: { notice: jest.fn().mockResolvedValue(), warning: jest.fn(), error: jest.fn() },
    });
    service.recordLastRunAt = jest.fn().mockResolvedValue();

    await service.startPendingRun('run-analysis-retry', retryAt);

    expect(codexService.retryTurn).toHaveBeenCalledWith(
      'failed-turn',
      expect.objectContaining({ name: 'Codex log review workflow' })
    );
    expect(service.recordLastRunAt).not.toHaveBeenCalled();
    const activeUpdate = RunModel.findOneAndUpdate.mock.calls[1][1].$set;
    expect(activeUpdate).not.toHaveProperty('startedAt');
    expect(activeUpdate['analysis.startedAt']).toEqual(retryAt);
  });

  test('records the cadence anchor when the first analysis session is accepted', async () => {
    const acceptedAt = new Date('2026-08-21T03:00:05.000Z');
    const run = {
      _id: 'run-first-analysis',
      status: 'analysis_pending',
      startedAt: null,
      analysis: {
        ...phaseDefinition('analysis', 'Analyze prompt', acceptedAt),
        nextAttemptAt: acceptedAt,
      },
    };
    const activeRun = {
      ...run,
      status: 'analyzing',
      startedAt: acceptedAt,
      analysis: { ...run.analysis, sessionId: 'analysis-session', turnId: 'analysis-turn' },
    };
    const RunModel = {
      findById: jest.fn(() => leanExec(run)),
      findOneAndUpdate: jest.fn()
        .mockReturnValueOnce(leanExec(run))
        .mockReturnValueOnce(leanExec(activeRun)),
    };
    const service = new CodexLogReviewWorkflowService({
      RunModel,
      log: { notice: jest.fn().mockResolvedValue(), warning: jest.fn(), error: jest.fn() },
    });
    service.recoverOrRetryCodexTurn = jest.fn().mockResolvedValue(null);
    service.submitCodexPhase = jest.fn().mockResolvedValue({
      session: { id: 'analysis-session' },
      turn: { id: 'analysis-turn', sessionId: 'analysis-session', status: 'queued', queuedAt: acceptedAt },
    });
    service.recordLastRunAt = jest.fn().mockResolvedValue(acceptedAt);

    await service.startPendingRun('run-first-analysis', acceptedAt);

    expect(service.recordLastRunAt).toHaveBeenCalledWith(acceptedAt);
    expect(RunModel.findOneAndUpdate.mock.calls[1][1].$set.startedAt).toEqual(acceptedAt);
  });
});
