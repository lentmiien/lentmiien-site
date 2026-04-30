const mongoose = require('mongoose');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

const logger = require('../utils/logger');
const PerformanceSnapshot = require('../models/performance_snapshot');
const PerformanceRollup = require('../models/performance_rollup');
const PerformanceSlowRequest = require('../models/performance_slow_request');

const DEFAULT_SNAPSHOT_INTERVAL_MS = 60 * 1000;
const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 1500;
const DEFAULT_EVENT_LOOP_RESOLUTION_MS = 20;
const MAX_DURATION_SAMPLES_PER_BUCKET = 5000;
const MAX_ROUTES_PER_SNAPSHOT = 100;
const MAX_TASKS_PER_SNAPSHOT = 60;
const MAX_SLOW_REQUESTS_PER_FLUSH = 250;
const DEFAULT_DASHBOARD_RANGE_HOURS = 6;
const MAX_DASHBOARD_RANGE_HOURS = 168;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function nsToMs(value) {
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    return 0;
  }
  return round(value / 1e6);
}

function statusClassKey(statusCode) {
  const code = Number(statusCode) || 0;
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  if (code >= 200) return '2xx';
  return 'other';
}

function addStatusCount(target, statusCode, amount = 1) {
  const key = statusClassKey(statusCode);
  target[key] = (target[key] || 0) + amount;
}

function percentile(sortedValues, percentileValue) {
  if (!sortedValues.length) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function formatPeriodKey(date, periodType) {
  const iso = date.toISOString();
  if (periodType === 'monthly') {
    return iso.slice(0, 7);
  }
  return iso.slice(0, 10);
}

function safePathname(originalUrl) {
  try {
    return new URL(originalUrl || '/', 'http://local').pathname || '/';
  } catch (_) {
    return '/';
  }
}

function normalizePathSegment(segment) {
  if (!segment) return segment;
  if (/^\d{4}-\d{2}-\d{2}$/.test(segment)) return ':date';
  if (/^[a-f0-9]{24}$/i.test(segment)) return ':id';
  if (/^\d+$/.test(segment)) return ':num';
  if (/^[a-z0-9_-]{16,}$/i.test(segment) && /\d/.test(segment)) return ':token';
  return segment;
}

function staticRouteLabel(pathname) {
  const staticPrefixes = [
    '/css/',
    '/js/',
    '/img/',
    '/mp3/',
    '/video/',
    '/temp/',
    '/html/',
  ];
  const match = staticPrefixes.find((prefix) => pathname.startsWith(prefix));
  if (match) {
    return `/static${match.slice(0, -1)}`;
  }
  if (/\.(css|js|map|png|jpe?g|gif|webp|svg|ico|mp3|wav|ogg|wasm|data|br|gz)$/i.test(pathname)) {
    return '/static/assets';
  }
  return null;
}

function normalizeRoute(method, originalUrl) {
  const pathname = safePathname(originalUrl);
  if (pathname === '/apphealth') {
    return { skip: true, route: pathname, label: `${method} ${pathname}` };
  }

  const staticLabel = staticRouteLabel(pathname);
  const route = staticLabel || pathname
    .split('/')
    .map(normalizePathSegment)
    .join('/') || '/';

  return {
    skip: false,
    route,
    label: `${method} ${route}`,
    path: pathname,
  };
}

class TimingBucket {
  constructor() {
    this.count = 0;
    this.errorCount = 0;
    this.slowCount = 0;
    this.totalMs = 0;
    this.maxMs = 0;
    this.statusCounts = {};
    this.samples = [];
  }

  record(durationMs, options = {}) {
    const normalizedDuration = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    this.count += 1;
    this.totalMs += normalizedDuration;
    this.maxMs = Math.max(this.maxMs, normalizedDuration);

    if (options.error) {
      this.errorCount += 1;
    }
    if (options.slow) {
      this.slowCount += 1;
    }
    if (options.statusCode) {
      addStatusCount(this.statusCounts, options.statusCode);
    }

    if (this.samples.length < MAX_DURATION_SAMPLES_PER_BUCKET) {
      this.samples.push(normalizedDuration);
      return;
    }

    const replacementIndex = Math.floor(Math.random() * this.count);
    if (replacementIndex < MAX_DURATION_SAMPLES_PER_BUCKET) {
      this.samples[replacementIndex] = normalizedDuration;
    }
  }

  toStats() {
    const sortedSamples = [...this.samples].sort((a, b) => a - b);
    return {
      count: this.count,
      errorCount: this.errorCount,
      slowCount: this.slowCount,
      totalDurationMs: round(this.totalMs),
      avgMs: this.count ? round(this.totalMs / this.count) : 0,
      p50Ms: round(percentile(sortedSamples, 50)),
      p95Ms: round(percentile(sortedSamples, 95)),
      p99Ms: round(percentile(sortedSamples, 99)),
      maxMs: round(this.maxMs),
      statusCounts: { ...this.statusCounts },
    };
  }
}

class PerformanceMetricsService {
  constructor() {
    this.enabled = process.env.PERFORMANCE_METRICS_ENABLED !== 'false';
    this.snapshotIntervalMs = parsePositiveInteger(
      process.env.PERFORMANCE_METRICS_INTERVAL_MS,
      DEFAULT_SNAPSHOT_INTERVAL_MS,
    );
    this.slowRequestThresholdMs = parsePositiveInteger(
      process.env.PERFORMANCE_SLOW_REQUEST_THRESHOLD_MS,
      DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
    );
    this.eventLoopResolutionMs = parsePositiveInteger(
      process.env.PERFORMANCE_EVENT_LOOP_RESOLUTION_MS,
      DEFAULT_EVENT_LOOP_RESOLUTION_MS,
    );
    this.timer = null;
    this.flushing = false;
    this.activeRequests = 0;
    this.eventLoopDelay = null;
    this.eventLoopUtilization = typeof performance.eventLoopUtilization === 'function'
      ? performance.eventLoopUtilization.bind(performance)
      : null;
    this.lastEventLoopUtilization = this.eventLoopUtilization ? this.eventLoopUtilization() : null;
    this.lastCpuUsage = process.cpuUsage();
    this.resetInterval(new Date());
  }

  start() {
    if (!this.enabled || this.timer) {
      return;
    }

    this.eventLoopDelay = monitorEventLoopDelay({ resolution: this.eventLoopResolutionMs });
    this.eventLoopDelay.enable();
    this.timer = setInterval(() => {
      this.flush().catch((error) => {
        logger.warning('Performance metrics flush failed', {
          category: 'performance',
          metadata: { error: error.message },
        });
      });
    }, this.snapshotIntervalMs);
    this.timer.unref?.();

    logger.notice('Performance metrics collector started', {
      category: 'performance',
      metadata: {
        intervalMs: this.snapshotIntervalMs,
        slowRequestThresholdMs: this.slowRequestThresholdMs,
      },
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.eventLoopDelay) {
      this.eventLoopDelay.disable();
    }
  }

  resetInterval(startedAt) {
    this.intervalStartedAt = startedAt;
    this.requests = {
      totalCount: 0,
      errorCount: 0,
      slowCount: 0,
      statusCounts: {},
      peakActiveCount: this.activeRequests,
    };
    this.routes = new Map();
    this.tasks = new Map();
    this.pendingSlowRequests = [];
  }

  beginRequest() {
    if (!this.enabled) {
      return null;
    }
    this.activeRequests += 1;
    this.requests.peakActiveCount = Math.max(this.requests.peakActiveCount, this.activeRequests);
    return performance.now();
  }

  endRequest(startTime, req, res) {
    if (!this.enabled) {
      return;
    }

    this.activeRequests = Math.max(0, this.activeRequests - 1);
    if (!Number.isFinite(startTime)) {
      return;
    }

    const durationMs = performance.now() - startTime;
    const method = String(req.method || 'GET').toUpperCase();
    const routeInfo = normalizeRoute(method, req.originalUrl || req.url || '/');
    if (routeInfo.skip) {
      return;
    }

    const statusCode = Number(res.statusCode) || 0;
    const isError = statusCode >= 500;
    const isSlow = durationMs >= this.slowRequestThresholdMs;
    const bucket = this.getRouteBucket(method, routeInfo.route, routeInfo.label);

    bucket.stats.record(durationMs, {
      statusCode,
      error: isError,
      slow: isSlow,
    });

    this.requests.totalCount += 1;
    if (isError) this.requests.errorCount += 1;
    if (isSlow) this.requests.slowCount += 1;
    addStatusCount(this.requests.statusCounts, statusCode);

    if (isSlow && this.pendingSlowRequests.length < MAX_SLOW_REQUESTS_PER_FLUSH) {
      this.pendingSlowRequests.push({
        timestamp: new Date(),
        method,
        route: routeInfo.route,
        path: routeInfo.path,
        statusCode,
        durationMs: round(durationMs),
        contentLength: parseContentLength(res.getHeader('content-length')),
        userName: req.user?.name || null,
        userType: req.user?.type_user || null,
        authType: req.authType || null,
      });
    }
  }

  getRouteBucket(method, route, label) {
    const key = `${method} ${route}`;
    if (!this.routes.has(key)) {
      this.routes.set(key, {
        method,
        route,
        label,
        stats: new TimingBucket(),
      });
    }
    return this.routes.get(key);
  }

  recordTask(name, durationMs, error = false) {
    if (!this.enabled) {
      return;
    }
    const key = String(name || 'unnamed-task');
    if (!this.tasks.has(key)) {
      this.tasks.set(key, new TimingBucket());
    }
    this.tasks.get(key).record(durationMs, { error });
  }

  async trackTask(name, operation) {
    if (typeof operation !== 'function') {
      throw new Error('Performance task operation must be a function.');
    }
    if (!this.enabled) {
      return operation();
    }
    const start = performance.now();
    let failed = false;
    try {
      return await operation();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      this.recordTask(name, performance.now() - start, failed);
    }
  }

  collectRuntime(capturedAt) {
    const memory = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const cpuDelta = {
      userMicros: cpuUsage.user - this.lastCpuUsage.user,
      systemMicros: cpuUsage.system - this.lastCpuUsage.system,
    };
    this.lastCpuUsage = cpuUsage;

    const elapsedMicros = Math.max(1, (capturedAt.getTime() - this.intervalStartedAt.getTime()) * 1000);
    const userPercent = (cpuDelta.userMicros / elapsedMicros) * 100;
    const systemPercent = (cpuDelta.systemMicros / elapsedMicros) * 100;

    let eventLoop = {
      utilization: 0,
      activeMs: 0,
      idleMs: 0,
      delayMinMs: 0,
      delayMeanMs: 0,
      delayP50Ms: 0,
      delayP95Ms: 0,
      delayP99Ms: 0,
      delayMaxMs: 0,
    };

    if (this.eventLoopUtilization && this.lastEventLoopUtilization) {
      const delta = this.eventLoopUtilization(this.lastEventLoopUtilization);
      this.lastEventLoopUtilization = this.eventLoopUtilization();
      eventLoop = {
        ...eventLoop,
        utilization: round(delta.utilization || 0, 4),
        activeMs: round(delta.active || 0),
        idleMs: round(delta.idle || 0),
      };
    }

    if (this.eventLoopDelay) {
      eventLoop = {
        ...eventLoop,
        delayMinMs: nsToMs(this.eventLoopDelay.min),
        delayMeanMs: nsToMs(this.eventLoopDelay.mean),
        delayP50Ms: nsToMs(this.eventLoopDelay.percentile(50)),
        delayP95Ms: nsToMs(this.eventLoopDelay.percentile(95)),
        delayP99Ms: nsToMs(this.eventLoopDelay.percentile(99)),
        delayMaxMs: nsToMs(this.eventLoopDelay.max),
      };
      this.eventLoopDelay.reset();
    }

    return {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSec: round(process.uptime()),
      memory: {
        rssBytes: memory.rss,
        heapTotalBytes: memory.heapTotal,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers,
      },
      cpu: {
        userMicros: cpuDelta.userMicros,
        systemMicros: cpuDelta.systemMicros,
        userPercent: round(userPercent),
        systemPercent: round(systemPercent),
        totalPercent: round(userPercent + systemPercent),
      },
      eventLoop,
    };
  }

  buildSnapshot(capturedAt) {
    const intervalStartedAt = this.intervalStartedAt;
    const intervalMs = capturedAt.getTime() - intervalStartedAt.getTime();
    const runtime = this.collectRuntime(capturedAt);
    const routes = Array.from(this.routes.values())
      .map((bucket) => ({
        method: bucket.method,
        route: bucket.route,
        label: bucket.label,
        ...bucket.stats.toStats(),
      }))
      .sort((a, b) => b.count - a.count || b.p95Ms - a.p95Ms)
      .slice(0, MAX_ROUTES_PER_SNAPSHOT);
    const tasks = Array.from(this.tasks.entries())
      .map(([name, bucket]) => ({
        name,
        ...bucket.toStats(),
      }))
      .sort((a, b) => b.count - a.count || b.p95Ms - a.p95Ms)
      .slice(0, MAX_TASKS_PER_SNAPSHOT);

    return {
      capturedAt,
      intervalStartedAt,
      intervalMs,
      runtime,
      requests: {
        totalCount: this.requests.totalCount,
        errorCount: this.requests.errorCount,
        slowCount: this.requests.slowCount,
        activeCount: this.activeRequests,
        peakActiveCount: this.requests.peakActiveCount,
        statusCounts: { ...this.requests.statusCounts },
      },
      routes,
      tasks,
      slowRequests: [...this.pendingSlowRequests],
    };
  }

  async flush() {
    if (!this.enabled || this.flushing) {
      return null;
    }
    if (mongoose.connection.readyState !== 1) {
      return null;
    }

    this.flushing = true;
    const capturedAt = new Date();
    const snapshot = this.buildSnapshot(capturedAt);
    this.resetInterval(capturedAt);

    try {
      await PerformanceSnapshot.create({
        capturedAt: snapshot.capturedAt,
        intervalStartedAt: snapshot.intervalStartedAt,
        intervalMs: snapshot.intervalMs,
        runtime: snapshot.runtime,
        requests: snapshot.requests,
        routes: snapshot.routes,
        tasks: snapshot.tasks,
      });

      await Promise.all([
        this.persistSlowRequests(snapshot.slowRequests),
        this.persistRollups(snapshot),
      ]);

      return snapshot;
    } finally {
      this.flushing = false;
    }
  }

  async persistSlowRequests(slowRequests) {
    if (!Array.isArray(slowRequests) || slowRequests.length === 0) {
      return;
    }
    await PerformanceSlowRequest.insertMany(slowRequests, { ordered: false });
  }

  async persistRollups(snapshot) {
    const operations = [];
    const periodTypes = ['daily', 'monthly'];
    const routeDurationTotal = snapshot.routes.reduce(
      (sum, route) => sum + ((route.avgMs || 0) * (route.count || 0)),
      0,
    );
    const maxRouteDuration = snapshot.routes.reduce((max, route) => Math.max(max, route.maxMs || 0), 0);

    periodTypes.forEach((periodType) => {
      const periodKey = formatPeriodKey(snapshot.capturedAt, periodType);
      if (snapshot.requests.totalCount > 0) {
        operations.push(this.buildRollupOperation({
          periodType,
          periodKey,
          metricType: 'overall',
          key: 'requests',
          count: snapshot.requests.totalCount,
          errorCount: snapshot.requests.errorCount,
          slowCount: snapshot.requests.slowCount,
          totalDurationMs: routeDurationTotal,
          maxDurationMs: maxRouteDuration,
          statusCounts: snapshot.requests.statusCounts,
          seenAt: snapshot.capturedAt,
        }));
      }

      snapshot.routes.forEach((route) => {
        operations.push(this.buildRollupOperation({
          periodType,
          periodKey,
          metricType: 'route',
          key: route.label,
          method: route.method,
          route: route.route,
          count: route.count,
          errorCount: route.errorCount,
          slowCount: route.slowCount,
          totalDurationMs: (route.avgMs || 0) * (route.count || 0),
          maxDurationMs: route.maxMs || 0,
          statusCounts: route.statusCounts,
          seenAt: snapshot.capturedAt,
        }));
      });

      snapshot.tasks.forEach((task) => {
        operations.push(this.buildRollupOperation({
          periodType,
          periodKey,
          metricType: 'task',
          key: task.name,
          taskName: task.name,
          count: task.count,
          errorCount: task.errorCount,
          totalDurationMs: (task.avgMs || 0) * (task.count || 0),
          maxDurationMs: task.maxMs || 0,
          seenAt: snapshot.capturedAt,
        }));
      });
    });

    if (!operations.length) {
      return;
    }
    await PerformanceRollup.bulkWrite(operations, { ordered: false });
  }

  buildRollupOperation(input) {
    const statusCounts = input.statusCounts || {};
    return {
      updateOne: {
        filter: {
          periodType: input.periodType,
          periodKey: input.periodKey,
          metricType: input.metricType,
          key: input.key,
        },
        update: {
          $setOnInsert: {
            periodType: input.periodType,
            periodKey: input.periodKey,
            metricType: input.metricType,
            key: input.key,
            method: input.method || null,
            route: input.route || null,
            taskName: input.taskName || null,
            firstSeenAt: input.seenAt,
          },
          $set: {
            lastSeenAt: input.seenAt,
          },
          $inc: {
            count: input.count || 0,
            errorCount: input.errorCount || 0,
            slowCount: input.slowCount || 0,
            totalDurationMs: round(input.totalDurationMs || 0),
            status2xx: statusCounts['2xx'] || 0,
            status3xx: statusCounts['3xx'] || 0,
            status4xx: statusCounts['4xx'] || 0,
            status5xx: statusCounts['5xx'] || 0,
          },
          $max: {
            maxDurationMs: round(input.maxDurationMs || 0),
          },
        },
        upsert: true,
      },
    };
  }

  getCurrentStatus() {
    return {
      enabled: this.enabled,
      snapshotIntervalMs: this.snapshotIntervalMs,
      slowRequestThresholdMs: this.slowRequestThresholdMs,
      activeRequests: this.activeRequests,
      intervalStartedAt: this.intervalStartedAt,
      inMemoryRequestCount: this.requests.totalCount,
      inMemoryRouteCount: this.routes.size,
      inMemoryTaskCount: this.tasks.size,
    };
  }

  async getDashboardData(options = {}) {
    const rangeHours = Math.min(
      MAX_DASHBOARD_RANGE_HOURS,
      parsePositiveInteger(options.rangeHours, DEFAULT_DASHBOARD_RANGE_HOURS),
    );
    const since = new Date(Date.now() - rangeHours * 60 * 60 * 1000);
    const [
      snapshots,
      slowRequests,
      dailyOverall,
      monthlyOverall,
    ] = await Promise.all([
      PerformanceSnapshot.find({ capturedAt: { $gte: since } })
        .sort({ capturedAt: -1 })
        .limit(240)
        .lean()
        .exec(),
      PerformanceSlowRequest.find({ timestamp: { $gte: since } })
        .sort({ durationMs: -1, timestamp: -1 })
        .limit(50)
        .lean()
        .exec(),
      PerformanceRollup.find({ periodType: 'daily', metricType: 'overall', key: 'requests' })
        .sort({ periodKey: -1 })
        .limit(14)
        .lean()
        .exec(),
      PerformanceRollup.find({ periodType: 'monthly', metricType: 'overall', key: 'requests' })
        .sort({ periodKey: -1 })
        .limit(12)
        .lean()
        .exec(),
    ]);

    return {
      generatedAt: new Date(),
      rangeHours,
      since,
      collector: this.getCurrentStatus(),
      latestSnapshot: snapshots[0] || null,
      snapshots,
      runtimeSeries: buildRuntimeSeries(snapshots),
      routeRows: summarizeRoutes(snapshots),
      taskRows: summarizeTasks(snapshots),
      slowRequests,
      dailyOverall: [...dailyOverall].reverse(),
      monthlyOverall: [...monthlyOverall].reverse(),
    };
  }
}

function parseContentLength(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildRuntimeSeries(snapshots) {
  return [...snapshots]
    .reverse()
    .map((snapshot) => ({
      capturedAt: snapshot.capturedAt,
      requestCount: snapshot.requests?.totalCount || 0,
      errorCount: snapshot.requests?.errorCount || 0,
      activeCount: snapshot.requests?.activeCount || 0,
      heapUsedBytes: snapshot.runtime?.memory?.heapUsedBytes || 0,
      rssBytes: snapshot.runtime?.memory?.rssBytes || 0,
      cpuTotalPercent: snapshot.runtime?.cpu?.totalPercent || 0,
      eventLoopUtilization: snapshot.runtime?.eventLoop?.utilization || 0,
      eventLoopDelayP95Ms: snapshot.runtime?.eventLoop?.delayP95Ms || 0,
      eventLoopDelayMaxMs: snapshot.runtime?.eventLoop?.delayMaxMs || 0,
    }));
}

function summarizeRoutes(snapshots) {
  const rows = new Map();
  snapshots.forEach((snapshot) => {
    (snapshot.routes || []).forEach((route) => {
      const key = route.label || `${route.method} ${route.route}`;
      if (!rows.has(key)) {
        rows.set(key, {
          method: route.method,
          route: route.route,
          label: key,
          count: 0,
          errorCount: 0,
          slowCount: 0,
          totalDurationMs: 0,
          maxMs: 0,
          worstP95Ms: 0,
          statusCounts: {},
        });
      }
      const row = rows.get(key);
      row.count += route.count || 0;
      row.errorCount += route.errorCount || 0;
      row.slowCount += route.slowCount || 0;
      row.totalDurationMs += (route.avgMs || 0) * (route.count || 0);
      row.maxMs = Math.max(row.maxMs, route.maxMs || 0);
      row.worstP95Ms = Math.max(row.worstP95Ms, route.p95Ms || 0);
      Object.entries(route.statusCounts || {}).forEach(([statusClass, count]) => {
        row.statusCounts[statusClass] = (row.statusCounts[statusClass] || 0) + count;
      });
    });
  });

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      avgMs: row.count ? round(row.totalDurationMs / row.count) : 0,
      maxMs: round(row.maxMs),
      worstP95Ms: round(row.worstP95Ms),
      errorRate: row.count ? round((row.errorCount / row.count) * 100, 1) : 0,
      slowRate: row.count ? round((row.slowCount / row.count) * 100, 1) : 0,
    }))
    .sort((a, b) => b.worstP95Ms - a.worstP95Ms || b.count - a.count)
    .slice(0, 40);
}

function summarizeTasks(snapshots) {
  const rows = new Map();
  snapshots.forEach((snapshot) => {
    (snapshot.tasks || []).forEach((task) => {
      if (!rows.has(task.name)) {
        rows.set(task.name, {
          name: task.name,
          count: 0,
          errorCount: 0,
          totalDurationMs: 0,
          maxMs: 0,
          worstP95Ms: 0,
        });
      }
      const row = rows.get(task.name);
      row.count += task.count || 0;
      row.errorCount += task.errorCount || 0;
      row.totalDurationMs += (task.avgMs || 0) * (task.count || 0);
      row.maxMs = Math.max(row.maxMs, task.maxMs || 0);
      row.worstP95Ms = Math.max(row.worstP95Ms, task.p95Ms || 0);
    });
  });

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      avgMs: row.count ? round(row.totalDurationMs / row.count) : 0,
      maxMs: round(row.maxMs),
      worstP95Ms: round(row.worstP95Ms),
      errorRate: row.count ? round((row.errorCount / row.count) * 100, 1) : 0,
    }))
    .sort((a, b) => b.worstP95Ms - a.worstP95Ms || b.count - a.count)
    .slice(0, 30);
}

module.exports = new PerformanceMetricsService();
