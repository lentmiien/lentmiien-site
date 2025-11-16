const path = require('path');
const fs = require('fs/promises');

const { HealthEntry } = require('../database');
const logger = require('../utils/logger');
const {
  deriveAnalytics,
  mapToPlainObject,
  mergeThresholds,
  DEFAULT_THRESHOLDS,
} = require('../utils/healthAnalytics');

const INSIGHTS_CACHE_PATH = path.join(__dirname, '..', 'cache', 'health_insights.json');

// Front-end
exports.top = (req, res) => {
  res.render('health_top');
};

// GET /edit/:date: Fetches one entry from database and show edit page
exports.edit = async (req, res) => {
  let { date } = req.params;

  if (!isValidDate(date)) {
    date = new Date().toISOString().split('T')[0];
  }

  try {
    let entry = await HealthEntry.findOne({ dateOfEntry: date });

    if (!entry) {
      entry = new HealthEntry({
        dateOfEntry: date,
        basicData: {},
        medicalRecord: {},
        diary: [],
        tags: [],
        personalizedThresholds: {},
      });
    }

    const basicData = mapToPlainObject(entry.basicData);
    const medicalRecord = mapToPlainObject(entry.medicalRecord);
    const thresholds = thresholdsForView(entry.personalizedThresholds);

    const renderedEntry = {
      dateOfEntry: entry.dateOfEntry,
      basicData,
      medicalRecord,
      diary: entry.diary || [],
      measurementType: entry.measurementType || '',
      measurementContext: entry.measurementContext || '',
      tagsString: (entry.tags || []).join(', '),
      notes: entry.notes || '',
      thresholds,
      analyticsSummary: entry.analyticsSummary || null,
      isNewEntry: !Object.keys(basicData).length && !Object.keys(medicalRecord).length && !(entry.diary || []).length,
    };

    res.render('health_edit', { entry: renderedEntry });
  } catch (error) {
    logger.error(`Error fetching entry for editing: ${error.message}`);
    res.status(500).render('error', { error: 'Could not fetch entry for editing' });
  }
};

// Utility function to check if the date string matches the format YYYY-MM-DD
const isValidDate = (dateStr) => {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
};

// POST /health-entries: Create a new health entry.
exports.addHealthEntry = async (req, res) => {
  const { dateOfEntry } = req.body;

  if (!dateOfEntry || !isValidDate(dateOfEntry)) {
    return res.status(400).json({ message: 'Invalid or missing dateOfEntry.' });
  }

  try {
    const existingEntry = await HealthEntry.findOne({ dateOfEntry });
    if (existingEntry) {
      return res.status(409).json({ message: 'An entry with this date already exists.' });
    }

    const payload = buildEntryPayload(req.body, { includeDefaults: true });
    const newEntry = new HealthEntry(payload);
    await newEntry.save();

    return res.status(201).json({
      message: 'Entry added successfully.',
      data: formatEntryForResponse(newEntry),
    });
  } catch (error) {
    logger.error(`Error adding health entry: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /health-entries/:date: Get an entry by date.
exports.getHealthEntry = async (req, res) => {
  const { date } = req.params;

  if (!isValidDate(date)) {
    return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
  }

  try {
    const entry = await HealthEntry.findOne({ dateOfEntry: date });

    if (!entry) {
      return res.status(404).json({ message: 'No entry found for the given date.', data: null });
    }

    res.status(200).json({
      message: 'Entry found.',
      data: formatEntryForResponse(entry),
    });
  } catch (error) {
    logger.error(`Error fetching health entry: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// PUT /health-entries/:date: Update an entry by date.
exports.updateHealthEntry = async (req, res) => {
  const { date } = req.params;

  if (!isValidDate(date)) {
    return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
  }

  try {
    const entry = await HealthEntry.findOne({ dateOfEntry: date });

    if (!entry) {
      return res.status(404).json({ message: 'Entry not found.' });
    }

    const payload = buildEntryPayload({ ...req.body, dateOfEntry: date });
    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined) return;
      entry[key] = value;
    });

    const updatedEntry = await entry.save();

    res.status(200).json({
      message: 'Entry updated successfully.',
      data: formatEntryForResponse(updatedEntry),
    });
  } catch (error) {
    logger.error(`Error updating health entry: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /health-entries: Get entries within a certain date range.
exports.getHealthEntries = async (req, res) => {
  const { start, end } = req.query;

  if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ message: 'Invalid or missing start/end date format. Please use YYYY-MM-DD.' });
  }

  if (new Date(start) > new Date(end)) {
    return res.status(400).json({ message: 'Start date cannot be after the end date.' });
  }

  try {
    const entries = await HealthEntry.find({
      dateOfEntry: { $gte: start, $lte: end },
    }).sort({ dateOfEntry: 1 });

    if (!entries.length) {
      return res.status(404).json({ message: 'No entries found for the given date range.', data: [] });
    }

    res.status(200).json({
      message: 'Entries retrieved successfully.',
      data: entries.map(formatEntryForResponse),
    });
  } catch (error) {
    logger.error(`Error fetching health entries: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// DELETE /health-entries/:date: Delete an entry by date
exports.deleteHealthEntry = async (req, res) => {
  const { date } = req.params;

  if (!isValidDate(date)) {
    return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
  }

  try {
    const deletedEntry = await HealthEntry.findOneAndDelete({ dateOfEntry: date });

    if (!deletedEntry) {
      return res.status(404).json({ message: 'No entry found for the given date.' });
    }

    res.status(200).json({
      message: 'Entry deleted successfully.',
      deletedData: formatEntryForResponse(deletedEntry),
    });
  } catch (error) {
    logger.error(`Error deleting health entry: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// POST /health-entries/diary: Append id to diary of health entry, or create new if not existing
exports.append_diary = async (req, res) => {
  const { date, id } = req.body;

  if (!date || !isValidDate(date)) {
    return res.status(400).json({ status: 'ERROR', message: 'Invalid or missing date.' });
  }

  if (!id) {
    return res.status(400).json({ status: 'ERROR', message: 'Missing id.' });
  }

  try {
    let entry = await HealthEntry.findOne({ dateOfEntry: date });

    if (entry) {
      if (!entry.diary.includes(id)) {
        entry.diary.push(id);
        await entry.save();
        return res.status(200).json({ status: 'OK', message: 'Id added to existing diary entry.' });
      }

      return res.status(200).json({ status: 'OK', message: 'Id already present in the diary for this date.' });
    }

    const newEntry = new HealthEntry({
      dateOfEntry: date,
      diary: [id],
      basicData: {},
      medicalRecord: {},
      tags: [],
      personalizedThresholds: {},
    });
    await newEntry.save();
    return res.status(201).json({ status: 'OK', message: 'New diary entry created with id.' });
  } catch (error) {
    logger.error(`Error appending diary ID: ${error.message}`);
    return res.status(500).json({ status: 'ERROR', message: 'Server error while processing request.' });
  }
};

// GET /health/analytics: Returns aggregated analytics + alerting metadata
exports.getHealthAnalytics = async (req, res) => {
  const { start, end, window = '7', metrics } = req.query;

  if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ message: 'Invalid or missing start/end date format. Please use YYYY-MM-DD.' });
  }

  if (new Date(start) > new Date(end)) {
    return res.status(400).json({ message: 'Start date cannot be after the end date.' });
  }

  try {
    const entries = await HealthEntry.find({
      dateOfEntry: { $gte: start, $lte: end },
    }).sort({ dateOfEntry: 1 });

    if (!entries.length) {
      return res.status(404).json({ message: 'No entries found for the given date range.', data: null });
    }

    const plainEntries = entries.map((entry) => ({
      dateOfEntry: entry.dateOfEntry,
      basicData: mapToPlainObject(entry.basicData),
      medicalRecord: mapToPlainObject(entry.medicalRecord),
      measurementContext: entry.measurementContext,
      tags: entry.tags || [],
    }));

    const personalizedThresholds = mergeThresholds(
      ...entries.map((entry) => mapToPlainObject(entry.personalizedThresholds))
    );

    const metricFilter = typeof metrics === 'string'
      ? metrics.split(',').map((m) => m.trim()).filter(Boolean)
      : null;

    const analytics = deriveAnalytics(plainEntries, {
      windowSize: window,
      thresholds: personalizedThresholds,
      metricFilter,
    });
    analytics.thresholds = mergeThresholds(DEFAULT_THRESHOLDS, personalizedThresholds);

    await persistAnalyticsSnapshot(analytics, { start, end });
    await updateEntryAnalyticsSummary(entries, analytics);

    return res.status(200).json({
      message: 'Analytics generated successfully.',
      data: analytics,
    });
  } catch (error) {
    logger.error(`Error generating health analytics: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

const buildEntryPayload = (body = {}, options = {}) => {
  const includeDefaults = Boolean(options.includeDefaults);
  const payload = { dateOfEntry: body.dateOfEntry };

  if (includeDefaults || body.basicData !== undefined) {
    payload.basicData = sanitizeKeyValueObject(body.basicData || {});
  }

  if (includeDefaults || body.medicalRecord !== undefined) {
    payload.medicalRecord = sanitizeKeyValueObject(body.medicalRecord || {});
  }

  if (includeDefaults || body.diary !== undefined) {
    payload.diary = normalizeDiaryInput(body.diary ?? []);
  }

  if (includeDefaults || body.measurementType !== undefined) {
    payload.measurementType = body.measurementType && body.measurementType.trim().length
      ? body.measurementType.trim()
      : undefined;
  }

  if (includeDefaults || body.measurementContext !== undefined) {
    payload.measurementContext = body.measurementContext && body.measurementContext.trim().length
      ? body.measurementContext.trim()
      : undefined;
  }

  if (includeDefaults || body.tags !== undefined) {
    payload.tags = normalizeTags(body.tags);
  }

  if (includeDefaults || body.notes !== undefined) {
    payload.notes = body.notes && body.notes.trim().length ? body.notes.trim() : undefined;
  }

  if (includeDefaults || body.personalizedThresholds !== undefined) {
    payload.personalizedThresholds = normalizeThresholdInput(body.personalizedThresholds || {});
  }

  return payload;
};

const formatEntryForResponse = (entry) => {
  if (!entry) return null;
  const plain = entry.toObject ? entry.toObject() : entry;

  return {
    id: plain._id ? plain._id.toString() : undefined,
    dateOfEntry: plain.dateOfEntry,
    basicData: mapToPlainObject(plain.basicData),
    medicalRecord: mapToPlainObject(plain.medicalRecord),
    diary: Array.isArray(plain.diary) ? plain.diary : [],
    measurementType: plain.measurementType || '',
    measurementContext: plain.measurementContext || '',
    tags: Array.isArray(plain.tags) ? plain.tags : [],
    notes: plain.notes || '',
    personalizedThresholds: mapToPlainObject(plain.personalizedThresholds),
    analyticsSummary: plain.analyticsSummary || null,
  };
};

const sanitizeKeyValueObject = (input = {}) => {
  const plain = mapToPlainObject(input);
  return Object.entries(plain).reduce((acc, [key, value]) => {
    if (!key || !key.trim().length) return acc;
    acc[key.trim()] = value;
    return acc;
  }, {});
};

const normalizeTags = (input) => {
  if (Array.isArray(input)) {
    return input.map((tag) => tag.trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeDiaryInput = (input) => {
  if (Array.isArray(input)) {
    return input.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const coerceNumber = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const normalizeThresholdInput = (input = {}) => {
  const normalized = {};
  const candidates = Array.isArray(input)
    ? input
    : Object.entries(mapToPlainObject(input)).map(([metric, bounds]) => ({
        metric,
        min: bounds?.min,
        max: bounds?.max,
      }));

  candidates.forEach((row) => {
    if (!row || !row.metric || !row.metric.trim()) return;
    const metric = row.metric.trim().toLowerCase();
    const min = coerceNumber(row.min);
    const max = coerceNumber(row.max);
    if (min === undefined && max === undefined) return;
    normalized[metric] = {};
    if (min !== undefined) normalized[metric].min = min;
    if (max !== undefined) normalized[metric].max = max;
  });

  return normalized;
};

const thresholdsForView = (thresholds) => {
  const plain = mapToPlainObject(thresholds);
  return Object.entries(plain).map(([metric, bounds]) => ({
    metric,
    min: bounds?.min ?? '',
    max: bounds?.max ?? '',
  }));
};

const persistAnalyticsSnapshot = async (analytics, meta) => {
  try {
    await fs.mkdir(path.dirname(INSIGHTS_CACHE_PATH), { recursive: true });
    const payload = {
      generatedAt: new Date().toISOString(),
      ...meta,
      analytics,
    };
    await fs.writeFile(INSIGHTS_CACHE_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    logger.warn('Failed to persist health analytics snapshot', {
      category: 'health-analytics',
      metadata: { error: error.message },
    });
  }
};

const collectEntryInsights = (entry, metricSummaries, windowSize) => {
  const seen = new Set();
  const sources = [entry.basicData, entry.medicalRecord];
  const insights = [];

  sources.forEach((source) => {
    const plain = mapToPlainObject(source);
    Object.keys(plain).forEach((metric) => {
      const normalizedMetric = metric.trim().toLowerCase();
      if (seen.has(normalizedMetric)) return;
      const summary = metricSummaries[normalizedMetric];
      if (!summary) return;
      const latestRolling = summary.rollingAverage.at
        ? summary.rollingAverage.at(-1)
        : summary.rollingAverage[summary.rollingAverage.length - 1];
      insights.push({
        metric: normalizedMetric,
        windowSize,
        movingAverage: latestRolling ? latestRolling.value : null,
        min: summary.min.value,
        max: summary.max.value,
        latest: summary.latest,
        trend: summary.trend,
      });
      seen.add(normalizedMetric);
    });
  });

  return insights;
};

const updateEntryAnalyticsSummary = async (entries, analytics) => {
  if (!entries.length) return;

  const timestamp = new Date();
  const operations = entries.map((entry) => {
    const alerts = analytics.perEntryAlerts[entry.dateOfEntry] || [];
    const insights = collectEntryInsights(entry, analytics.metricSummaries, analytics.windowSize);

    return {
      updateOne: {
        filter: { _id: entry._id },
        update: {
          $set: {
            analyticsSummary: {
              computedAt: timestamp,
              windowSize: analytics.windowSize,
              alerts,
              insights,
            },
          },
        },
      },
    };
  });

  try {
    await HealthEntry.bulkWrite(operations);
  } catch (error) {
    logger.warn('Failed to update entry analytics summaries', {
      category: 'health-analytics',
      metadata: { error: error.message },
    });
  }
};
