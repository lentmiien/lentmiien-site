jest.mock('../../database', () => ({
  Task: { find: jest.fn() }
}));

const {
  buildDashboardPayload,
  evaluateCompletionWindow
} = require('../../services/scheduleTaskStatsService');

function task(overrides) {
  return {
    userId: 'user',
    title: 'Task',
    type: 'todo',
    done: false,
    start: null,
    end: null,
    createdAt: new Date('2026-04-01T09:00:00Z'),
    updatedAt: new Date('2026-04-01T09:00:00Z'),
    ...overrides
  };
}

describe('scheduleTaskStatsService', () => {
  test('buildDashboardPayload computes period stats, ranking, and recurring titles', () => {
    const now = new Date('2026-04-24T12:00:00Z');
    const tasks = [
      task({
        userId: 'alice',
        title: 'Laundry',
        type: 'todo',
        done: true,
        createdAt: new Date('2026-04-20T08:00:00Z'),
        updatedAt: new Date('2026-04-21T10:00:00Z'),
        start: new Date('2026-04-20T00:00:00Z'),
        end: new Date('2026-04-22T00:00:00Z')
      }),
      task({
        userId: 'alice',
        title: 'Groceries',
        type: 'tobuy',
        done: true,
        createdAt: new Date('2026-04-18T09:00:00Z'),
        updatedAt: new Date('2026-04-23T09:00:00Z'),
        end: new Date('2026-04-22T09:00:00Z')
      }),
      task({
        userId: 'alice',
        title: 'Pay bills',
        type: 'todo',
        done: false,
        createdAt: new Date('2026-04-10T09:00:00Z'),
        updatedAt: new Date('2026-04-10T09:00:00Z'),
        end: new Date('2026-04-15T09:00:00Z')
      }),
      task({
        userId: 'bob',
        title: 'Groceries',
        type: 'tobuy',
        done: true,
        createdAt: new Date('2026-03-15T10:00:00Z'),
        updatedAt: new Date('2026-04-01T10:00:00Z'),
        end: new Date('2026-04-05T10:00:00Z')
      }),
      task({
        userId: 'bob',
        title: 'Groceries',
        type: 'tobuy',
        done: true,
        createdAt: new Date('2026-04-05T10:00:00Z'),
        updatedAt: new Date('2026-04-06T10:00:00Z')
      }),
      task({
        userId: 'bob',
        title: 'Laundry',
        type: 'todo',
        done: true,
        createdAt: new Date('2026-04-12T08:00:00Z'),
        updatedAt: new Date('2026-04-14T12:00:00Z'),
        start: new Date('2026-04-13T00:00:00Z'),
        end: new Date('2026-04-16T00:00:00Z')
      }),
      task({
        userId: 'bob',
        title: 'Stationery',
        type: 'tobuy',
        done: false,
        createdAt: new Date('2026-04-23T10:00:00Z'),
        updatedAt: new Date('2026-04-23T10:00:00Z')
      }),
      task({
        userId: 'carol',
        title: 'Groceries',
        type: 'tobuy',
        done: true,
        createdAt: new Date('2026-04-19T09:00:00Z'),
        updatedAt: new Date('2026-04-20T09:00:00Z'),
        start: new Date('2026-04-22T00:00:00Z'),
        end: new Date('2026-04-25T00:00:00Z')
      }),
      task({
        userId: 'carol',
        title: 'Laundry',
        type: 'todo',
        done: false,
        createdAt: new Date('2025-08-01T09:00:00Z'),
        updatedAt: new Date('2025-08-01T09:00:00Z'),
        end: new Date('2026-04-20T09:00:00Z')
      })
    ];

    const payload = buildDashboardPayload(tasks, { now, currentUserId: 'alice' });
    const recentUsers = payload.period28d.leaderboard;
    const alice = recentUsers.find((entry) => entry.userId === 'alice');
    const bob = recentUsers.find((entry) => entry.userId === 'bob');
    const carol = recentUsers.find((entry) => entry.userId === 'carol');

    expect(payload.hasData).toBe(true);
    expect(payload.trackedUsers).toBe(3);
    expect(payload.period28d.summary.completedCount).toBe(6);
    expect(payload.period28d.leaderboard[0].userId).toBe('bob');

    expect(alice.completedCount).toBe(2);
    expect(alice.lateCount).toBe(1);
    expect(alice.overdueOpenCount).toBe(1);
    expect(alice.display.windowHitRate).toBe('50%');

    expect(bob.carryInOpen).toBe(1);
    expect(bob.completedCount).toBe(3);
    expect(bob.closureRate).toBeCloseTo(0.75, 4);
    expect(bob.overallScore).toBeGreaterThan(alice.overallScore);

    expect(carol.earlyCount).toBe(1);
    expect(carol.display.windowHitRate).toBe('0%');

    expect(payload.recurringTitles[0]).toMatchObject({
      title: 'Groceries',
      totalCount: 4,
      userCount: 3,
      completionRate: '100%'
    });

    expect(payload.charts.activity28d).toHaveLength(28);
    expect(payload.charts.score90d[0].userId).toBe('bob');
  });

  test('evaluateCompletionWindow detects early and late completions', () => {
    const earlyTask = task({
      done: true,
      createdAt: new Date('2026-04-01T09:00:00Z'),
      updatedAt: new Date('2026-04-03T09:00:00Z'),
      start: new Date('2026-04-04T09:00:00Z'),
      end: new Date('2026-04-05T09:00:00Z')
    });

    const lateTask = task({
      done: true,
      createdAt: new Date('2026-04-01T09:00:00Z'),
      updatedAt: new Date('2026-04-07T09:00:00Z'),
      start: new Date('2026-04-02T09:00:00Z'),
      end: new Date('2026-04-05T09:00:00Z')
    });

    const earlyResult = evaluateCompletionWindow(earlyTask);
    const lateResult = evaluateCompletionWindow(lateTask);

    expect(earlyResult.early).toBe(true);
    expect(earlyResult.late).toBe(false);
    expect(earlyResult.withinWindow).toBe(false);

    expect(lateResult.early).toBe(false);
    expect(lateResult.late).toBe(true);
    expect(lateResult.withinWindow).toBe(false);
    expect(lateResult.lateDays).toBeCloseTo(2, 4);
  });
});
