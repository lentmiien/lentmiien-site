const { Task } = require('../database');

const MS_IN_DAY = 24 * 60 * 60 * 1000;

const PERIODS = [
  { key: 'period28d', label: 'Last 28 days', detailLevel: 'full' },
  { key: 'period90d', label: 'Last 3 months', detailLevel: 'full' },
  { key: 'period1y', label: 'Last year', detailLevel: 'compact' }
];

const DATE_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
});

const SHORT_DATE_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC'
});

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(value) {
  const date = toDateOrNull(value);
  if (!date) return null;
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

function shiftUtcDays(value, days) {
  const date = new Date(value.getTime());
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function shiftUtcMonths(value, months) {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth() + months,
    value.getUTCDate(),
    0, 0, 0, 0
  ));
}

function shiftUtcYears(value, years) {
  return new Date(Date.UTC(
    value.getUTCFullYear() + years,
    value.getUTCMonth(),
    value.getUTCDate(),
    0, 0, 0, 0
  ));
}

function formatDate(value) {
  const date = toDateOrNull(value);
  return date ? DATE_LABEL.format(date) : '—';
}

function formatShortDate(value) {
  const date = toDateOrNull(value);
  return date ? SHORT_DATE_LABEL.format(date) : '—';
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatDays(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1) {
    return `${value.toFixed(1)}d`;
  }
  if (value < 10) {
    return `${value.toFixed(1)}d`;
  }
  return `${Math.round(value)}d`;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function safeRatio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function normalizeTitle(title) {
  if (typeof title !== 'string') return '';
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getCompletionDate(task) {
  if (!task.done) return null;
  return task.updatedAt || null;
}

function isWithinRange(date, start, end) {
  return Boolean(date && date >= start && date <= end);
}

function isOpenAt(task, point) {
  if (!task.createdAt || task.createdAt > point) return false;
  const completedAt = getCompletionDate(task);
  return !completedAt || completedAt > point;
}

function evaluateCompletionWindow(task) {
  const completedAt = getCompletionDate(task);
  if (!completedAt) {
    return {
      completedAt: null,
      withinWindow: false,
      early: false,
      late: false,
      cycleDays: null,
      earlyDays: null,
      lateDays: null,
      slackDays: null
    };
  }

  const cycleDays = Math.max(0, (completedAt - task.createdAt) / MS_IN_DAY);
  const earlyDays = task.start && completedAt < task.start
    ? (task.start - completedAt) / MS_IN_DAY
    : null;
  const lateDays = task.end && completedAt > task.end
    ? (completedAt - task.end) / MS_IN_DAY
    : null;
  const slackDays = task.end && completedAt <= task.end
    ? (task.end - completedAt) / MS_IN_DAY
    : null;
  const withinWindow = (!task.start || completedAt >= task.start) && (!task.end || completedAt <= task.end);

  return {
    completedAt,
    withinWindow,
    early: Boolean(earlyDays && earlyDays > 0),
    late: Boolean(lateDays && lateDays > 0),
    cycleDays,
    earlyDays,
    lateDays,
    slackDays
  };
}

function calculateOverallScore(metrics) {
  const throughputScore = 40 * Math.min(Math.log1p(metrics.completedCount) / Math.log(21), 1);
  const windowScore = 25 * metrics.windowHitRate;
  const closureScore = 20 * Math.min(metrics.closureRate, 1);
  const speedScore = metrics.medianCycleDays === null
    ? 0
    : 15 * (1 / (1 + (metrics.medianCycleDays / 14)));
  const penaltyScore = Math.min(
    25,
    (metrics.overdueOpenCount * 1.5) +
    ((metrics.avgLateDays || 0) * 1.2) +
    (metrics.lateRate * 8)
  );

  const total = Math.max(
    0,
    throughputScore + windowScore + closureScore + speedScore - penaltyScore
  );

  return {
    total: round(total, 1),
    throughputScore: round(throughputScore, 1),
    windowScore: round(windowScore, 1),
    closureScore: round(closureScore, 1),
    speedScore: round(speedScore, 1),
    penaltyScore: round(penaltyScore, 1)
  };
}

function createUserAccumulator(userId) {
  return {
    userId,
    createdCount: 0,
    createdTodoCount: 0,
    createdTobuyCount: 0,
    completedCount: 0,
    completedTodoCount: 0,
    completedTobuyCount: 0,
    carryInOpen: 0,
    openNow: 0,
    overdueOpenCount: 0,
    overdueOpenDaysList: [],
    deadlineCompletedCount: 0,
    onTimeDeadlineCount: 0,
    windowHitCount: 0,
    earlyCount: 0,
    lateCount: 0,
    cycleDaysList: [],
    lateDaysList: [],
    slackDaysList: []
  };
}

function finalizeUserStats(userStats, currentUserId) {
  const availableCount = userStats.carryInOpen + userStats.createdCount;
  const closureRate = safeRatio(userStats.completedCount, availableCount);
  const windowHitRate = safeRatio(userStats.windowHitCount, userStats.completedCount);
  const onTimeDeadlineRate = safeRatio(userStats.onTimeDeadlineCount, userStats.deadlineCompletedCount);
  const lateRate = safeRatio(userStats.lateCount, userStats.completedCount);
  const avgCycleDays = average(userStats.cycleDaysList);
  const medianCycleDays = median(userStats.cycleDaysList);
  const avgLateDays = average(userStats.lateDaysList);
  const avgSlackDays = average(userStats.slackDaysList);
  const avgOverdueOpenDays = average(userStats.overdueOpenDaysList);
  const score = calculateOverallScore({
    completedCount: userStats.completedCount,
    windowHitRate,
    closureRate,
    medianCycleDays,
    overdueOpenCount: userStats.overdueOpenCount,
    avgLateDays,
    lateRate
  });

  return {
    ...userStats,
    availableCount,
    closureRate: round(closureRate, 4),
    windowHitRate: round(windowHitRate, 4),
    onTimeDeadlineRate: round(onTimeDeadlineRate, 4),
    lateRate: round(lateRate, 4),
    avgCycleDays: round(avgCycleDays, 2),
    medianCycleDays: round(medianCycleDays, 2),
    avgLateDays: round(avgLateDays, 2),
    avgSlackDays: round(avgSlackDays, 2),
    avgOverdueOpenDays: round(avgOverdueOpenDays, 2),
    overallScore: score.total,
    scoreBreakdown: score,
    isCurrentUser: userStats.userId === currentUserId,
    display: {
      windowHitRate: formatPercent(windowHitRate),
      onTimeDeadlineRate: userStats.deadlineCompletedCount ? formatPercent(onTimeDeadlineRate) : '—',
      closureRate: availableCount ? formatPercent(closureRate) : '—',
      avgCycleDays: userStats.completedCount ? formatDays(avgCycleDays) : '—',
      medianCycleDays: userStats.completedCount ? formatDays(medianCycleDays) : '—',
      avgLateDays: userStats.lateCount ? formatDays(avgLateDays) : '—',
      avgSlackDays: userStats.deadlineCompletedCount ? formatDays(avgSlackDays) : '—',
      avgOverdueOpenDays: userStats.overdueOpenCount ? formatDays(avgOverdueOpenDays) : '—'
    }
  };
}

function rankUserStats(userStats, currentUserId) {
  const ranked = [...userStats].sort((left, right) => {
    if (right.overallScore !== left.overallScore) return right.overallScore - left.overallScore;
    if (right.completedCount !== left.completedCount) return right.completedCount - left.completedCount;
    if (right.windowHitRate !== left.windowHitRate) return right.windowHitRate - left.windowHitRate;
    return left.userId.localeCompare(right.userId);
  });

  return ranked.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    isCurrentUser: entry.userId === currentUserId
  }));
}

function selectTopEntries(entries, limit, compareFn, eligibilityFn, valueLabelFn, secondaryLabelFn) {
  return [...entries]
    .filter((entry) => eligibilityFn(entry))
    .sort(compareFn)
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      valueLabel: valueLabelFn(entry),
      secondaryLabel: secondaryLabelFn ? secondaryLabelFn(entry) : null,
      isCurrentUser: entry.isCurrentUser
    }));
}

function buildMetricLeaders(rankedStats) {
  const boards = [
    {
      title: 'Overall score',
      subtitle: 'Weighted blend of throughput, timing, closure, and penalty.',
      entries: selectTopEntries(
        rankedStats,
        3,
        (left, right) => {
          if (right.overallScore !== left.overallScore) return right.overallScore - left.overallScore;
          return right.completedCount - left.completedCount;
        },
        (entry) => entry.availableCount > 0,
        (entry) => `${entry.overallScore} pts`,
        (entry) => `${entry.completedCount} completed`
      )
    },
    {
      title: 'Most completed',
      subtitle: 'Pure finished volume in the period.',
      entries: selectTopEntries(
        rankedStats,
        3,
        (left, right) => {
          if (right.completedCount !== left.completedCount) return right.completedCount - left.completedCount;
          return right.windowHitRate - left.windowHitRate;
        },
        (entry) => entry.completedCount > 0,
        (entry) => `${entry.completedCount} done`,
        (entry) => `${entry.display.windowHitRate} within window`
      )
    },
    {
      title: 'Best window accuracy',
      subtitle: 'Share of completions that landed within start/end bounds.',
      entries: selectTopEntries(
        rankedStats,
        3,
        (left, right) => {
          if (right.windowHitRate !== left.windowHitRate) return right.windowHitRate - left.windowHitRate;
          return right.completedCount - left.completedCount;
        },
        (entry) => entry.completedCount >= 2,
        (entry) => entry.display.windowHitRate,
        (entry) => `${entry.completedCount} completed`
      )
    },
    {
      title: 'Best closure rate',
      subtitle: 'How much of the available work got cleared.',
      entries: selectTopEntries(
        rankedStats,
        3,
        (left, right) => {
          if (right.closureRate !== left.closureRate) return right.closureRate - left.closureRate;
          return right.completedCount - left.completedCount;
        },
        (entry) => entry.availableCount >= 3,
        (entry) => entry.display.closureRate,
        (entry) => `${entry.completedCount}/${entry.availableCount} cleared`
      )
    },
    {
      title: 'Fastest cycle',
      subtitle: 'Lowest median time from create to done.',
      entries: selectTopEntries(
        rankedStats,
        3,
        (left, right) => {
          if (left.medianCycleDays !== right.medianCycleDays) return left.medianCycleDays - right.medianCycleDays;
          return right.completedCount - left.completedCount;
        },
        (entry) => entry.completedCount >= 2 && entry.medianCycleDays !== null,
        (entry) => entry.display.medianCycleDays,
        (entry) => `${entry.completedCount} completed`
      )
    }
  ];

  return boards.filter((board) => board.entries.length > 0);
}

function buildPeriodSummary(tasks, period, currentUserId) {
  const users = new Map();
  const totals = {
    createdCount: 0,
    completedCount: 0,
    carryInOpen: 0,
    openNow: 0,
    overdueOpenCount: 0,
    windowHitCount: 0,
    deadlineCompletedCount: 0,
    onTimeDeadlineCount: 0,
    lateCount: 0,
    cycleDaysList: [],
    lateDaysList: []
  };

  for (const task of tasks) {
    const userId = task.userId || 'unknown';
    if (!users.has(userId)) users.set(userId, createUserAccumulator(userId));
    const userStats = users.get(userId);
    const completion = evaluateCompletionWindow(task);
    const createdInRange = isWithinRange(task.createdAt, period.start, period.end);
    const completedInRange = isWithinRange(completion.completedAt, period.start, period.end);
    const wasCarryInOpen = Boolean(task.createdAt && task.createdAt < period.start && isOpenAt(task, period.start));
    const openAtEnd = isOpenAt(task, period.end);

    if (wasCarryInOpen) {
      userStats.carryInOpen += 1;
      totals.carryInOpen += 1;
    }

    if (createdInRange) {
      userStats.createdCount += 1;
      totals.createdCount += 1;
      if (task.type === 'todo') userStats.createdTodoCount += 1;
      if (task.type === 'tobuy') userStats.createdTobuyCount += 1;
    }

    if (openAtEnd) {
      userStats.openNow += 1;
      totals.openNow += 1;
      if (task.end && task.end < period.end) {
        userStats.overdueOpenCount += 1;
        totals.overdueOpenCount += 1;
        userStats.overdueOpenDaysList.push((period.end - task.end) / MS_IN_DAY);
      }
    }

    if (!completedInRange) continue;

    userStats.completedCount += 1;
    totals.completedCount += 1;
    if (task.type === 'todo') userStats.completedTodoCount += 1;
    if (task.type === 'tobuy') userStats.completedTobuyCount += 1;

    if (completion.cycleDays !== null) {
      userStats.cycleDaysList.push(completion.cycleDays);
      totals.cycleDaysList.push(completion.cycleDays);
    }

    if (completion.withinWindow) {
      userStats.windowHitCount += 1;
      totals.windowHitCount += 1;
    }

    if (completion.early) {
      userStats.earlyCount += 1;
    }

    if (task.end) {
      userStats.deadlineCompletedCount += 1;
      totals.deadlineCompletedCount += 1;
      if (!completion.late) {
        userStats.onTimeDeadlineCount += 1;
        totals.onTimeDeadlineCount += 1;
      }
      if (completion.slackDays !== null) {
        userStats.slackDaysList.push(completion.slackDays);
      }
    }

    if (completion.late) {
      userStats.lateCount += 1;
      totals.lateCount += 1;
      if (completion.lateDays !== null) {
        userStats.lateDaysList.push(completion.lateDays);
        totals.lateDaysList.push(completion.lateDays);
      }
    }
  }

  const rankedStats = rankUserStats(
    [...users.values()].map((entry) => finalizeUserStats(entry, currentUserId)),
    currentUserId
  );

  const currentUser = rankedStats.find((entry) => entry.userId === currentUserId) || null;
  const leader = rankedStats[0] || null;
  const summary = {
    createdCount: totals.createdCount,
    completedCount: totals.completedCount,
    carryInOpen: totals.carryInOpen,
    openNow: totals.openNow,
    overdueOpenCount: totals.overdueOpenCount,
    windowHitRate: totals.completedCount ? formatPercent(totals.windowHitCount / totals.completedCount) : '—',
    onTimeDeadlineRate: totals.deadlineCompletedCount
      ? formatPercent(totals.onTimeDeadlineCount / totals.deadlineCompletedCount)
      : '—',
    lateCount: totals.lateCount,
    medianCycleDays: totals.cycleDaysList.length ? formatDays(median(totals.cycleDaysList)) : '—',
    avgLateDays: totals.lateDaysList.length ? formatDays(average(totals.lateDaysList)) : '—',
    leader,
    userCount: rankedStats.length,
    currentUserRank: currentUser ? currentUser.rank : null,
    currentUser
  };

  return {
    key: period.key,
    label: period.label,
    detailLevel: period.detailLevel,
    start: period.start,
    end: period.end,
    rangeLabel: `${formatDate(period.start)} – ${formatDate(period.end)}`,
    summary,
    leaderboard: rankedStats,
    metricLeaders: buildMetricLeaders(rankedStats)
  };
}

function buildDailyActivityChart(tasks, start, end) {
  const buckets = [];
  const bucketMap = new Map();
  let cursor = startOfUtcDay(start);
  const lastBucket = startOfUtcDay(end);

  while (cursor <= lastBucket) {
    const key = cursor.toISOString().slice(0, 10);
    const bucket = {
      dateKey: key,
      label: formatShortDate(cursor),
      created: 0,
      completed: 0,
      onWindow: 0,
      late: 0
    };
    buckets.push(bucket);
    bucketMap.set(key, bucket);
    cursor = shiftUtcDays(cursor, 1);
  }

  for (const task of tasks) {
    const completion = evaluateCompletionWindow(task);
    const createdDay = task.createdAt ? startOfUtcDay(task.createdAt) : null;
    const completedDay = completion.completedAt ? startOfUtcDay(completion.completedAt) : null;

    if (createdDay && createdDay >= start && createdDay <= lastBucket) {
      const bucket = bucketMap.get(createdDay.toISOString().slice(0, 10));
      if (bucket) bucket.created += 1;
    }

    if (completedDay && completedDay >= start && completedDay <= lastBucket) {
      const bucket = bucketMap.get(completedDay.toISOString().slice(0, 10));
      if (bucket) {
        bucket.completed += 1;
        if (completion.withinWindow) bucket.onWindow += 1;
        if (completion.late) bucket.late += 1;
      }
    }
  }

  return buckets;
}

function buildScoreChart(rankedStats, limit = 8) {
  return rankedStats.slice(0, limit).map((entry) => ({
    userId: entry.userId,
    score: entry.overallScore,
    completedCount: entry.completedCount,
    windowHitRate: entry.windowHitRate || 0,
    overdueOpenCount: entry.overdueOpenCount,
    isCurrentUser: entry.isCurrentUser
  }));
}

function buildRecurringTitles(tasks, start, limit = 5) {
  const titles = new Map();

  for (const task of tasks) {
    const completion = evaluateCompletionWindow(task);
    const activeInRange = task.createdAt >= start || (completion.completedAt && completion.completedAt >= start);
    if (!activeInRange) continue;

    const normalizedTitle = normalizeTitle(task.title);
    if (!normalizedTitle) continue;

    if (!titles.has(normalizedTitle)) {
      titles.set(normalizedTitle, {
        title: task.title ? task.title.trim() : normalizedTitle,
        totalCount: 0,
        completedCount: 0,
        todoCount: 0,
        tobuyCount: 0,
        userIds: new Set(),
        cycleDaysList: [],
        lateDaysList: [],
        lastSeenAt: task.createdAt
      });
    }

    const entry = titles.get(normalizedTitle);
    entry.totalCount += 1;
    entry.userIds.add(task.userId || 'unknown');
    if (task.type === 'todo') entry.todoCount += 1;
    if (task.type === 'tobuy') entry.tobuyCount += 1;
    if (completion.completedAt) {
      entry.completedCount += 1;
      if (completion.cycleDays !== null) entry.cycleDaysList.push(completion.cycleDays);
      if (completion.lateDays !== null) entry.lateDaysList.push(completion.lateDays);
      if (completion.completedAt > entry.lastSeenAt) {
        entry.lastSeenAt = completion.completedAt;
        entry.title = task.title ? task.title.trim() : entry.title;
      }
    } else if (task.createdAt > entry.lastSeenAt) {
      entry.lastSeenAt = task.createdAt;
      entry.title = task.title ? task.title.trim() : entry.title;
    }
  }

  return [...titles.values()]
    .map((entry) => ({
      title: entry.title,
      totalCount: entry.totalCount,
      completedCount: entry.completedCount,
      completionRate: formatPercent(entry.completedCount / entry.totalCount),
      userCount: entry.userIds.size,
      avgCycleDays: entry.cycleDaysList.length ? formatDays(average(entry.cycleDaysList)) : '—',
      avgLateDays: entry.lateDaysList.length ? formatDays(average(entry.lateDaysList)) : '—',
      todoCount: entry.todoCount,
      tobuyCount: entry.tobuyCount,
      lastSeenAt: formatDate(entry.lastSeenAt)
    }))
    .sort((left, right) => {
      if (right.totalCount !== left.totalCount) return right.totalCount - left.totalCount;
      if (right.completedCount !== left.completedCount) return right.completedCount - left.completedCount;
      return left.title.localeCompare(right.title);
    })
    .slice(0, limit);
}

function buildDashboardPayload(tasks, options = {}) {
  const now = toDateOrNull(options.now) || new Date();
  const currentUserId = options.currentUserId || null;
  const today = startOfUtcDay(now);

  const period28d = buildPeriodSummary(tasks, {
    key: 'period28d',
    label: 'Last 28 days',
    detailLevel: 'full',
    start: shiftUtcDays(today, -27),
    end: now
  }, currentUserId);

  const period90d = buildPeriodSummary(tasks, {
    key: 'period90d',
    label: 'Last 3 months',
    detailLevel: 'full',
    start: shiftUtcMonths(today, -3),
    end: now
  }, currentUserId);

  const period1y = buildPeriodSummary(tasks, {
    key: 'period1y',
    label: 'Last year',
    detailLevel: 'compact',
    start: shiftUtcYears(today, -1),
    end: now
  }, currentUserId);

  const trackedUsers = new Set(tasks.map((task) => task.userId || 'unknown')).size;

  return {
    currentUserId,
    generatedAt: now,
    generatedAtLabel: formatDate(now),
    hasData: tasks.length > 0,
    trackedUsers,
    scoreFormula: {
      summary: 'Overall score rewards throughput, window accuracy, closure rate, and cycle speed, then subtracts a lateness penalty.',
      details: [
        'Throughput: up to 40 points from completed volume using logarithmic scaling.',
        'Window accuracy: up to 25 points from completions that landed inside start/end.',
        'Closure rate: up to 20 points from completed work divided by carry-in plus newly created work.',
        'Speed: up to 15 points from lower median create-to-done time.',
        'Penalty: up to 25 points subtracted for overdue backlog, average delay, and late-completion share.'
      ]
    },
    charts: {
      activity28d: buildDailyActivityChart(tasks, shiftUtcDays(today, -27), now),
      score90d: buildScoreChart(period90d.leaderboard)
    },
    period28d,
    period90d,
    period1y,
    recurringTitles: buildRecurringTitles(tasks, period1y.start),
    periods: PERIODS
  };
}

function normalizeTask(task) {
  return {
    userId: task.userId || 'unknown',
    title: typeof task.title === 'string' ? task.title : '',
    type: task.type,
    done: Boolean(task.done),
    start: toDateOrNull(task.start),
    end: toDateOrNull(task.end),
    createdAt: toDateOrNull(task.createdAt),
    updatedAt: toDateOrNull(task.updatedAt)
  };
}

async function getDashboardData(options = {}) {
  const now = toDateOrNull(options.now) || new Date();
  const yearStart = shiftUtcYears(startOfUtcDay(now), -1);
  const rawTasks = await Task.find({
    type: { $in: ['todo', 'tobuy'] },
    $or: [
      { createdAt: { $gte: yearStart } },
      { updatedAt: { $gte: yearStart } },
      { done: false }
    ]
  })
    .select('userId title type done start end createdAt updatedAt')
    .lean();

  const tasks = rawTasks
    .map(normalizeTask)
    .filter((task) => task.createdAt);

  return buildDashboardPayload(tasks, {
    now,
    currentUserId: options.currentUserId || null
  });
}

module.exports = {
  PERIODS,
  buildDashboardPayload,
  buildPeriodSummary,
  buildRecurringTitles,
  calculateOverallScore,
  evaluateCompletionWindow,
  getDashboardData,
  normalizeTask
};
