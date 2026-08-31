const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');
const { HTML_RATING_CATEGORIES, computeAverageRating } = require('../utils/htmlRatings');

const DEFAULT_HTML_SAMPLES_CACHE_TTL_MS = 5 * 60 * 1000;

class HtmlSamplesCacheService {
  constructor({
    model,
    htmlDirectory,
    fileSystem = fs,
    serviceLogger = logger,
    clock = Date.now,
    ttlMs = DEFAULT_HTML_SAMPLES_CACHE_TTL_MS,
  } = {}) {
    if (!model || typeof model.find !== 'function') {
      throw new TypeError('HtmlSamplesCacheService requires a rating model');
    }
    if (typeof htmlDirectory !== 'string' || !htmlDirectory) {
      throw new TypeError('HtmlSamplesCacheService requires an HTML directory');
    }
    if (!fileSystem || typeof fileSystem.existsSync !== 'function') {
      throw new TypeError('HtmlSamplesCacheService requires a filesystem implementation');
    }
    if (typeof clock !== 'function') {
      throw new TypeError('HtmlSamplesCacheService requires a clock function');
    }
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError('HtmlSamplesCacheService ttlMs must be a non-negative number');
    }

    this.model = model;
    this.htmlDirectory = htmlDirectory;
    this.fileSystem = fileSystem;
    this.logger = serviceLogger;
    this.clock = clock;
    this.ttlMs = ttlMs;

    this.samples = null;
    this.refreshAfter = 0;
    this.inFlightRefresh = null;
    this.generation = 0;
    this.refreshFailureActive = false;
  }

  async getSamples({ forceRefresh = false } = {}) {
    if (!forceRefresh && this._now() < this.refreshAfter) {
      return this.samples || [];
    }

    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    const refreshGeneration = this.generation;
    let trackedRefresh;
    trackedRefresh = this._refresh(refreshGeneration).finally(() => {
      if (this.inFlightRefresh === trackedRefresh) {
        this.inFlightRefresh = null;
      }
    });
    this.inFlightRefresh = trackedRefresh;
    return trackedRefresh;
  }

  invalidate() {
    this.generation += 1;
    this.refreshAfter = 0;
  }

  _now() {
    const value = this.clock();
    const timestamp = value instanceof Date ? value.getTime() : Number(value);
    if (!Number.isFinite(timestamp)) {
      throw new TypeError('HtmlSamplesCacheService clock must return a valid timestamp');
    }
    return timestamp;
  }

  async _refresh(refreshGeneration) {
    try {
      const entries = await this.model.find({ isPublic: true }).lean().exec();
      const samples = this._buildSamples(entries);
      this.samples = samples;
      this.refreshAfter = refreshGeneration === this.generation
        ? this._now() + this.ttlMs
        : 0;

      if (this.refreshFailureActive) {
        this._log('notice', 'HTML samples cache refresh recovered', {
          category: 'layout',
        });
      }
      this.refreshFailureActive = false;
      return samples;
    } catch (error) {
      const servingStale = this.samples !== null;
      if (!this.refreshFailureActive) {
        this._log('warning', 'Unable to refresh HTML samples cache', {
          category: 'layout',
          metadata: {
            error: error && error.message ? error.message : String(error),
            servingStale,
          },
        });
      }
      this.refreshFailureActive = true;
      this.refreshAfter = refreshGeneration === this.generation
        ? this._now() + this.ttlMs
        : 0;
      return this.samples || [];
    }
  }

  _buildSamples(entries) {
    const samples = [];
    entries.forEach((entry) => {
      const fileName = entry.filename;
      if (!fileName) {
        return;
      }

      const filePath = path.join(this.htmlDirectory, fileName);
      if (!this.fileSystem.existsSync(filePath)) {
        return;
      }

      const ratings = HTML_RATING_CATEGORIES.map((category) => {
        const score = entry.ratings && Number.isFinite(entry.ratings[category.key])
          ? entry.ratings[category.key]
          : null;
        return {
          key: category.key,
          label: category.label,
          score,
        };
      });

      samples.push({
        path: `/html/${fileName}`,
        name: fileName.replace(/\.html$/i, ''),
        ratings,
        averageRating: computeAverageRating(entry.ratings),
        version: entry.version || 1,
      });
    });

    samples.sort((a, b) => {
      const aAverage = Number.isFinite(a.averageRating) ? a.averageRating : 0;
      const bAverage = Number.isFinite(b.averageRating) ? b.averageRating : 0;
      if (bAverage !== aAverage) {
        return bAverage - aAverage;
      }
      return a.name.localeCompare(b.name);
    });

    return samples;
  }

  _log(level, message, options) {
    try {
      const result = this.logger && typeof this.logger[level] === 'function'
        ? this.logger[level](message, options)
        : null;
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (_error) {
      // A logging transport failure must not make layout hydration fail.
    }
  }
}

module.exports = HtmlSamplesCacheService;
module.exports.HtmlSamplesCacheService = HtmlSamplesCacheService;
module.exports.DEFAULT_HTML_SAMPLES_CACHE_TTL_MS = DEFAULT_HTML_SAMPLES_CACHE_TTL_MS;
