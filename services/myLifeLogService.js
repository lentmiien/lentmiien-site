const logger = require('../utils/logger');
const { MyLifeLogEntry, HealthEntry } = require('../database');

const MAX_LIST_LIMIT = 500;
const SUGGESTION_LIMIT = 10;

const pad2 = (value) => String(value).padStart(2, '0');
const formatDateLocal = (date) => {
  const safe = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(safe.getTime())) return null;
  return `${safe.getFullYear()}-${pad2(safe.getMonth() + 1)}-${pad2(safe.getDate())}`;
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeLabel = (label) => {
  if (typeof label !== 'string') return '';
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : '';
};

const extractMapEntries = (value) => {
  if (!value) return [];
  if (value instanceof Map) {
    return Array.from(value.entries());
  }
  if (typeof value === 'object') {
    return Object.entries(value);
  }
  return [];
};

class MyLifeLogService {
  constructor({ LifeLogEntry, HealthEntry, logger }) {
    this.LifeLogEntry = LifeLogEntry;
    this.HealthEntry = HealthEntry;
    this.logger = logger;
    this.labelCache = new Set();
    this.labelStats = new Map();
    this.recentLabels = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    await this.refreshCaches();
  }

  async refreshCaches() {
    const nextLabelCache = new Set();
    const nextLabelStats = new Map();
    const nextRecentLabels = [];

    const trackLabel = (label, timestamp) => {
      const normalized = normalizeLabel(label);
      if (!normalized) return;
      nextLabelCache.add(normalized);
      const stats = nextLabelStats.get(normalized) || {
        total: 0,
        byHour: Array(24).fill(0),
      };
      stats.total += 1;
      const hour = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
        ? timestamp.getHours()
        : 12;
      if (Number.isFinite(hour) && stats.byHour[hour] !== undefined) {
        stats.byHour[hour] += 1;
      }
      nextLabelStats.set(normalized, stats);
    };

    try {
      const entries = await this.LifeLogEntry.find(
        { label: { $exists: true, $ne: '' } },
        { label: 1, timestamp: 1 }
      ).lean();
      entries.forEach((entry) => trackLabel(entry.label, entry.timestamp));

      const recent = await this.LifeLogEntry.find(
        { label: { $exists: true, $ne: '' } },
        { label: 1 }
      )
        .sort({ timestamp: -1 })
        .limit(50)
        .lean();
      recent.forEach((entry) => {
        const normalized = normalizeLabel(entry.label);
        if (normalized && !nextRecentLabels.includes(normalized)) {
          nextRecentLabels.push(normalized);
        }
      });

      const legacyEntries = await this.HealthEntry.find(
        {},
        { dateOfEntry: 1, basicData: 1, medicalRecord: 1 }
      ).lean();
      legacyEntries.forEach((entry) => {
        const date = entry?.dateOfEntry ? new Date(`${entry.dateOfEntry}T12:00:00`) : null;
        const timestamp = date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
        extractMapEntries(entry.basicData).forEach(([label]) => trackLabel(label, timestamp));
        extractMapEntries(entry.medicalRecord).forEach(([label]) => trackLabel(label, timestamp));
      });
    } catch (error) {
      this.logger.error('Failed to refresh life log label cache', {
        category: 'life_log',
        metadata: { message: error?.message || error },
      });
    }

    this.labelCache = nextLabelCache;
    this.labelStats = nextLabelStats;
    this.recentLabels = nextRecentLabels;
  }

  getLabels() {
    return Array.from(this.labelCache).sort((a, b) => a.localeCompare(b));
  }

  getLabelSuggestions(referenceDate = new Date()) {
    const sortedByTotal = Array.from(this.labelStats.entries())
      .sort((a, b) => {
        if (b[1].total !== a[1].total) return b[1].total - a[1].total;
        return a[0].localeCompare(b[0]);
      })
      .map(([label]) => label);

    const hour = referenceDate instanceof Date && !Number.isNaN(referenceDate.getTime())
      ? referenceDate.getHours()
      : 12;
    const sortedByHour = Array.from(this.labelStats.entries())
      .filter(([, stats]) => stats.byHour && stats.byHour[hour] > 0)
      .sort((a, b) => {
        if (b[1].byHour[hour] !== a[1].byHour[hour]) {
          return b[1].byHour[hour] - a[1].byHour[hour];
        }
        return a[0].localeCompare(b[0]);
      })
      .map(([label]) => label);

    return {
      top: sortedByTotal.slice(0, SUGGESTION_LIMIT),
      timeOfDay: (sortedByHour.length ? sortedByHour : sortedByTotal).slice(0, SUGGESTION_LIMIT),
      recent: this.recentLabels.slice(0, SUGGESTION_LIMIT),
      all: this.getLabels(),
    };
  }

  updateLabelCache(label, timestamp) {
    const normalized = normalizeLabel(label);
    if (!normalized) return;
    this.labelCache.add(normalized);
    const stats = this.labelStats.get(normalized) || {
      total: 0,
      byHour: Array(24).fill(0),
    };
    stats.total += 1;
    const hour = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
      ? timestamp.getHours()
      : 12;
    if (Number.isFinite(hour) && stats.byHour[hour] !== undefined) {
      stats.byHour[hour] += 1;
    }
    this.labelStats.set(normalized, stats);
    if (!this.recentLabels.includes(normalized)) {
      this.recentLabels.unshift(normalized);
      if (this.recentLabels.length > 50) {
        this.recentLabels.pop();
      }
    }
  }

  async addEntry(payload) {
    const entry = new this.LifeLogEntry(payload);
    const saved = await entry.save();
    if (saved.label) {
      this.updateLabelCache(saved.label, saved.timestamp);
    }
    return saved;
  }

  async deleteEntry(id) {
    const deleted = await this.LifeLogEntry.findByIdAndDelete(id);
    if (deleted) {
      await this.refreshCaches();
    }
    return deleted;
  }

  async listEntries({ start, end, labels = [], types = [], includeLegacy = true, limit = null } = {}) {
    const startDate = toDate(start);
    const endDate = toDate(end);
    const normalizedLabels = Array.isArray(labels)
      ? labels.map(normalizeLabel).filter(Boolean)
      : [];
    const normalizedTypes = Array.isArray(types)
      ? types.map((type) => (typeof type === 'string' ? type.trim() : '')).filter(Boolean)
      : [];
    const cappedLimit = Number.isFinite(limit)
      ? Math.min(Math.max(limit, 1), MAX_LIST_LIMIT)
      : null;

    const query = {};
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }
    if (normalizedLabels.length) {
      query.label = { $in: normalizedLabels };
    }
    if (normalizedTypes.length) {
      query.type = { $in: normalizedTypes };
    }

    const entries = await this.LifeLogEntry.find(query)
      .sort({ timestamp: -1 })
      .limit(cappedLimit || 0)
      .lean();

    const formatted = entries.map((entry) => ({
      id: entry._id?.toString() || '',
      type: entry.type,
      label: entry.label || '',
      value: entry.value || '',
      text: entry.text || '',
      v_log_data: entry.v_log_data || '',
      timestamp: entry.timestamp instanceof Date ? entry.timestamp : new Date(entry.timestamp),
      isLegacy: false,
    }));

    let legacy = [];
    if (includeLegacy) {
      legacy = await this.listLegacyEntries({
        start: startDate,
        end: endDate,
        labels: normalizedLabels,
        types: normalizedTypes,
      });
    }

    const combined = formatted.concat(legacy);
    combined.sort((a, b) => b.timestamp - a.timestamp);
    if (cappedLimit) {
      return combined.slice(0, cappedLimit);
    }
    return combined;
  }

  async listLegacyEntries({ start, end, labels = [], types = [] } = {}) {
    const startStr = start ? formatDateLocal(start) : null;
    const endStr = end ? formatDateLocal(end) : null;
    const query = {};
    if (startStr && endStr) {
      query.dateOfEntry = { $gte: startStr, $lte: endStr };
    } else if (startStr) {
      query.dateOfEntry = { $gte: startStr };
    } else if (endStr) {
      query.dateOfEntry = { $lte: endStr };
    }

    const typeFilter = Array.isArray(types) && types.length ? new Set(types) : null;
    const labelFilter = Array.isArray(labels) && labels.length ? new Set(labels) : null;

    const entries = await this.HealthEntry.find(query).lean();
    const legacyEntries = [];

    entries.forEach((entry) => {
      const timestamp = entry?.dateOfEntry
        ? new Date(`${entry.dateOfEntry}T12:00:00`)
        : new Date();
      const entryId = entry?._id?.toString() || 'legacy';

      extractMapEntries(entry.basicData).forEach(([label, value], index) => {
        const labelStr = String(label || '').trim();
        if (typeFilter && !typeFilter.has('basic')) return;
        if (labelFilter && !labelFilter.has(labelStr)) return;
        legacyEntries.push({
          id: `legacy-${entryId}-basic-${index}`,
          type: 'basic',
          label: labelStr,
          value: value === undefined ? '' : String(value),
          text: '',
          v_log_data: '',
          timestamp,
          isLegacy: true,
        });
      });

      extractMapEntries(entry.medicalRecord).forEach(([label, value], index) => {
        const labelStr = String(label || '').trim();
        if (typeFilter && !typeFilter.has('medical')) return;
        if (labelFilter && !labelFilter.has(labelStr)) return;
        legacyEntries.push({
          id: `legacy-${entryId}-medical-${index}`,
          type: 'medical',
          label: labelStr,
          value: value === undefined ? '' : String(value),
          text: '',
          v_log_data: '',
          timestamp,
          isLegacy: true,
        });
      });

      if (Array.isArray(entry.diary)) {
        entry.diary.forEach((id, index) => {
          if (typeFilter && !typeFilter.has('diary')) return;
          legacyEntries.push({
            id: `legacy-${entryId}-diary-${index}`,
            type: 'diary',
            label: '',
            value: '',
            text: `Legacy diary reference: ${id}`,
            v_log_data: '',
            timestamp,
            isLegacy: true,
          });
        });
      }
    });

    return legacyEntries;
  }
}

const myLifeLogService = new MyLifeLogService({
  LifeLogEntry: MyLifeLogEntry,
  HealthEntry,
  logger,
});

myLifeLogService.init().catch((error) => {
  logger.error('Failed to initialize MyLifeLogService', {
    category: 'life_log',
    metadata: { message: error?.message || error },
  });
});

module.exports = myLifeLogService;
module.exports.MyLifeLogService = MyLifeLogService;
