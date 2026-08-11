const path = require('path');
const pug = require('pug');

const commonLocals = {
  pageTitle: 'Production Log Review',
  loggedIn: true,
  permissions: [],
  htmlPaths: [],
  bookmarks: [],
  admin: true,
};

const config = {
  intervalDays: 10,
  logWindowDays: 7,
  initialLastRunAt: '2026-08-11T03:00:00.000Z',
  userNotesMaxLength: 5000,
  analysisWorkspaceId: 'analysis-workspace',
  fixWorkspaceId: 'fix-workspace',
  fixProfileId: 'max',
  commitProfileId: 'fastest',
};

function render(view, workflowState) {
  return pug.renderFile(path.join(process.cwd(), 'views', 'codex_log_review', `${view}.pug`), {
    ...commonLocals,
    workflowState,
    notice: '',
    errorMessage: '',
  });
}

describe('Production log review pages', () => {
  test('shows the next scheduled run when no action is pending', () => {
    const html = render('index', {
      currentRun: null,
      previousRuns: [],
      nextScheduledAt: '2026-08-21T03:00:00.000Z',
      config,
    });

    expect(html).toContain('Nothing needs your attention');
    expect(html).toContain('Next analysis:');
    expect(html).toContain('12:00 JST');
    expect(html).toContain('codex_log_review.last_run_at');
  });

  test('puts the report and guidance form directly on the landing page', () => {
    const run = {
      id: 'run-awaiting-fix',
      status: 'awaiting_fix',
      statusLabel: 'Your review is needed',
      actionRequired: true,
      processing: false,
      scheduledFor: '2026-08-21T03:00:00.000Z',
      analysis: {
        sessionId: 'analysis-session',
        turnId: 'analysis-turn',
        response: 'A stored production report.',
      },
    };
    const html = render('index', {
      currentRun: run,
      previousRuns: [],
      nextScheduledAt: '2026-08-31T03:00:00.000Z',
      config,
    });

    expect(html).toContain('Review the report and start fixes');
    expect(html).toContain('A stored production report.');
    expect(html).toContain('name="notes"');
    expect(html).toContain('maxlength="5000"');
    expect(html).toContain('/codex-log-review/runs/run-awaiting-fix/fix');
    expect(html).toContain('/codex/sessions/analysis-session');
  });

  test('shows stored prompts, responses, and Codex links on run details', () => {
    const run = {
      id: 'run-complete',
      status: 'completed',
      statusLabel: 'Completed',
      actionRequired: false,
      processing: false,
      scheduledFor: '2026-08-21T03:00:00.000Z',
      logWindowStart: '2026-08-14T03:00:00.000Z',
      logWindowEnd: '2026-08-21T03:00:00.000Z',
      startedAt: '2026-08-21T03:00:05.000Z',
      completedAt: '2026-08-22T03:00:00.000Z',
      userNotes: 'Keep compatibility.',
      analysis: {
        workspaceId: 'analysis-workspace',
        mode: 'question',
        permissionMode: 'yolo',
        requestProfileId: 'max',
        status: 'succeeded',
        sessionId: 'analysis-session',
        turnId: 'analysis-turn',
        prompt: 'Analysis prompt copy',
        response: 'Analysis response copy',
      },
      fix: {
        workspaceId: 'fix-workspace',
        mode: 'action',
        permissionMode: 'yolo',
        requestProfileId: 'max',
        status: 'succeeded',
        sessionId: 'fix-session',
        turnId: 'fix-turn',
        prompt: 'Fix prompt copy',
        response: 'Fix response copy',
      },
      commit: {
        workspaceId: 'fix-workspace',
        mode: 'action',
        permissionMode: 'yolo',
        requestProfileId: 'fastest',
        status: 'succeeded',
        sessionId: 'fix-session',
        turnId: 'commit-turn',
        prompt: 'Please commit the pending changes and push to the online repository.',
        response: 'Pushed successfully.',
      },
    };
    const html = render('detail', {
      run,
      nextScheduledAt: '2026-08-31T03:00:00.000Z',
      config,
    });

    expect(html).toContain('Analysis prompt copy');
    expect(html).toContain('Analysis response copy');
    expect(html).toContain('Fix response copy');
    expect(html).toContain('Pushed successfully.');
    expect(html).toContain('/codex/sessions/fix-session');
    expect(html).toContain('/codex/turns/commit-turn');
    expect(html).toContain('profile fastest');
  });
});
