const DEFAULT_THRESHOLDS = {
  weight: { min: 45, max: 90 },
  bodyfat: { max: 25 },
  bmi: { max: 27 },
  steps: { min: 7000 },
  sleep: { min: 6.5 },
  temperature: { max: 37.8 },
  glucose: { max: 140 },
  heartRate: { min: 50, max: 100 },
  bloodpressure_systolic: { max: 135 },
  bloodpressure_diastolic: { max: 85 },
};

const TREND_EPSILON = 0.2;

const sanitizeMetricName = (metric = '') => metric.trim();

const mapToPlainObject = (candidate) => {
  if (!candidate) return {};
  if (candidate instanceof Map) {
    return Object.fromEntries(candidate.entries());
  }
  if (typeof candidate.toObject === 'function') {
    return candidate.toObject();
  }
  if (typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate;
  }
  return {};
};

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed.length) return null;

    const ratioMatch = trimmed.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/);
    if (ratioMatch) {
      return ratioMatch.slice(1).map((m) => parseFloat(m));
    }

    const hoursMatch = trimmed.match(/(-?\d+(?:\.\d+)?)\s*h/);
    const minutesMatch = trimmed.match(/(-?\d+)\s*m/);
    if (hoursMatch || minutesMatch) {
      const hours = (hoursMatch ? parseFloat(hoursMatch[1]) : 0) + (minutesMatch ? parseFloat(minutesMatch[1]) / 60 : 0);
      return hours;
    }

    const numericMatch = trimmed.match(/-?\d+(?:\.\d+)?/);
    return numericMatch ? parseFloat(numericMatch[0]) : null;
  }
  return null;
};

const expandValueForMetric = (metric, rawValue) => {
  const name = sanitizeMetricName(metric);
  if (!name) return [];

  const normalized = normalizeNumber(rawValue);
  if (Array.isArray(normalized) && name.toLowerCase().includes('pressure')) {
    const [systolic, diastolic] = normalized;
    return [
      { metric: `${name.toLowerCase()}_systolic`, value: systolic },
      { metric: `${name.toLowerCase()}_diastolic`, value: diastolic },
    ];
  }

  if (normalized === null || Number.isNaN(normalized)) {
    return [];
  }

  return [{ metric: name.toLowerCase(), value: normalized }];
};

const buildSeries = (entries = []) => {
  const series = {};
  entries.forEach((entry) => {
    ['basicData', 'medicalRecord'].forEach((bucket) => {
      const source = mapToPlainObject(entry[bucket]);
      Object.entries(source).forEach(([metric, rawValue]) => {
        expandValueForMetric(metric, rawValue).forEach(({ metric: metricName, value }) => {
          if (!Number.isFinite(value)) return;
          if (!series[metricName]) series[metricName] = [];
          series[metricName].push({
            date: entry.dateOfEntry,
            value,
            context: entry.measurementContext || null,
            tags: entry.tags || [],
          });
        });
      });
    });
  });
  return series;
};

const computeRollingAverage = (points, windowSize) => {
  const queue = [];
  let sum = 0;
  return points.map((point) => {
    queue.push(point.value);
    sum += point.value;
    if (queue.length > windowSize) {
      sum -= queue.shift();
    }
    const avg = sum / queue.length;
    return {
      date: point.date,
      value: Number(avg.toFixed(2)),
    };
  });
};

const determineTrend = (points) => {
  if (!points.length) return 'flat';
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const delta = last - first;
  if (Math.abs(delta) <= TREND_EPSILON) return 'flat';
  return delta > 0 ? 'up' : 'down';
};

const evaluateAlerts = (points, bounds = {}, metric) => {
  if (!points.length || (!Number.isFinite(bounds.min) && !Number.isFinite(bounds.max))) {
    return [];
  }

  return points.reduce((acc, point) => {
    if (Number.isFinite(bounds.max) && point.value > bounds.max) {
      acc.push({
        metric,
        type: 'high',
        threshold: bounds.max,
        value: point.value,
        date: point.date,
      });
    }
    if (Number.isFinite(bounds.min) && point.value < bounds.min) {
      acc.push({
        metric,
        type: 'low',
        threshold: bounds.min,
        value: point.value,
        date: point.date,
      });
    }
    return acc;
  }, []);
};

const aggregateAlertsByDate = (alerts) => {
  return alerts.reduce((acc, alert) => {
    if (!acc[alert.date]) acc[alert.date] = [];
    acc[alert.date].push(alert);
    return acc;
  }, {});
};

const computeStreak = (dates) => {
  if (!dates.length) return 0;
  let streak = 1;
  for (let i = dates.length - 1; i > 0; i -= 1) {
    const current = new Date(dates[i]);
    const previous = new Date(dates[i - 1]);
    const diffInDays = Math.round((current - previous) / (24 * 60 * 60 * 1000));
    if (diffInDays === 1) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
};

const buildAlertBanners = (alerts) => {
  const grouped = alerts.reduce((acc, alert) => {
    const key = `${alert.metric}:${alert.type}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(alert);
    return acc;
  }, {});

  return Object.values(grouped).map((group) => {
    const sorted = group.sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const uniqueDates = [...new Set(sorted.map((alert) => alert.date))];
    const streak = computeStreak(uniqueDates);
    return {
      metric: latest.metric,
      type: latest.type,
      latestValue: latest.value,
      threshold: latest.threshold,
      lastTriggeredAt: latest.date,
      streak,
      message: `${latest.metric} ${latest.type === 'high' ? 'above' : 'below'} ${latest.threshold} for ${streak} day${streak !== 1 ? 's' : ''}`,
    };
  }).sort((a, b) => b.streak - a.streak);
};

const mergeThresholds = (...maps) => {
  return maps.reduce((acc, map) => {
    const plain = mapToPlainObject(map);
    Object.entries(plain).forEach(([metric, bounds]) => {
      if (!acc[metric]) acc[metric] = {};
      if (bounds && typeof bounds === 'object') {
        if (bounds.min !== undefined) acc[metric].min = bounds.min;
        if (bounds.max !== undefined) acc[metric].max = bounds.max;
      }
    });
    return acc;
  }, {});
};

const deriveAnalytics = (entries = [], options = {}) => {
  const windowSizeInput = Number.parseInt(options.windowSize, 10);
  const windowSize = Number.isFinite(windowSizeInput) ? Math.min(Math.max(windowSizeInput, 2), 30) : 7;
  const metricFilter = Array.isArray(options.metricFilter) && options.metricFilter.length
    ? new Set(options.metricFilter.map((m) => m.toLowerCase()))
    : null;
  const thresholds = mergeThresholds(DEFAULT_THRESHOLDS, options.thresholds);

  const series = buildSeries(entries);
  const metricSummaries = {};
  const alerts = [];
  const filteredSeries = {};

  Object.entries(series).forEach(([metric, points]) => {
    if (!points.length) return;
    if (metricFilter && !metricFilter.has(metric.toLowerCase())) return;

    const sortedPoints = points.sort((a, b) => a.date.localeCompare(b.date));
    const rollingAverage = computeRollingAverage(sortedPoints, windowSize);
    const minPoint = sortedPoints.reduce((min, point) => (point.value < min.value ? point : min), sortedPoints[0]);
    const maxPoint = sortedPoints.reduce((max, point) => (point.value > max.value ? point : max), sortedPoints[0]);
    const trend = determineTrend(sortedPoints);
    const metricAlerts = evaluateAlerts(sortedPoints, thresholds[metric], metric);

    alerts.push(...metricAlerts);
    filteredSeries[metric] = sortedPoints;
    metricSummaries[metric] = {
      metric,
      latest: sortedPoints[sortedPoints.length - 1].value,
      min: { date: minPoint.date, value: minPoint.value },
      max: { date: maxPoint.date, value: maxPoint.value },
      trend,
      rollingAverage,
    };
  });

  const alertBanners = buildAlertBanners(alerts);
  const perEntryAlerts = aggregateAlertsByDate(alerts);

  return {
    windowSize,
    metricSummaries,
    seriesByMetric: filteredSeries,
    alerts,
    alertBanners,
    perEntryAlerts,
  };
};

module.exports = {
  DEFAULT_THRESHOLDS,
  deriveAnalytics,
  mapToPlainObject,
  mergeThresholds,
};
