const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_PENDING_PATH = path.resolve(
  __dirname,
  '..',
  'logs',
  'database-availability-pending.json'
);
const DEFAULT_RETENTION_DAYS = 90;
const MAX_EVENTS = 50;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clip(value, maximum) {
  const text = String(value || '');
  return text.length <= maximum ? text : `${text.slice(0, maximum - 3)}...`;
}

function sanitizeConnectionError(error) {
  const rawMessage = String(error?.message || error || 'MongoDB connection failed');
  const message = rawMessage
    .replace(/mongodb(?:\+srv)?:\/\/[^\s'"<>]+/gi, '[redacted MongoDB URI]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
  return {
    name: clip(error?.name || 'Error', 120),
    code: clip(error?.code || error?.cause?.code || '', 120),
    message: clip(message, 500),
  };
}

function normalizeDate(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizePendingIncident(value) {
  if (!value || typeof value !== 'object' || typeof value.incidentId !== 'string') {
    return null;
  }
  const startedAt = normalizeDate(value.startedAt);
  if (!startedAt) return null;
  return {
    version: 1,
    incidentId: clip(value.incidentId, 120),
    startedAt,
    recoveredAt: normalizeDate(value.recoveredAt),
    startupFailure: value.startupFailure === true,
    connectionAttempts: Math.max(0, Number.parseInt(value.connectionAttempts, 10) || 0),
    processStarts: Math.max(1, Number.parseInt(value.processStarts, 10) || 1),
    lastFailure: value.lastFailure && typeof value.lastFailure === 'object'
      ? {
        occurredAt: normalizeDate(value.lastFailure.occurredAt),
        ...sanitizeConnectionError(value.lastFailure),
      }
      : null,
    notification: {
      attemptedAt: normalizeDate(value.notification?.attemptedAt),
      attemptCount: Math.max(
        0,
        Number.parseInt(value.notification?.attemptCount, 10)
          || (value.notification?.attemptedAt ? 1 : 0),
      ),
      sentAt: normalizeDate(value.notification?.sentAt),
      receipt: clip(value.notification?.receipt, 120),
      cancellationAttemptCount: Math.max(
        0,
        Number.parseInt(value.notification?.cancellationAttemptCount, 10) || 0,
      ),
      cancelledAt: normalizeDate(value.notification?.cancelledAt),
      recoveryAttemptCount: Math.max(
        0,
        Number.parseInt(value.notification?.recoveryAttemptCount, 10) || 0,
      ),
      recoverySentAt: normalizeDate(value.notification?.recoverySentAt),
      error: clip(value.notification?.error, 500),
      cancellationError: clip(value.notification?.cancellationError, 500),
      recoveryError: clip(value.notification?.recoveryError, 500),
    },
    events: Array.isArray(value.events)
      ? value.events.slice(-MAX_EVENTS).map((event) => ({
        occurredAt: normalizeDate(event?.occurredAt, new Date().toISOString()),
        type: clip(event?.type, 80),
        message: clip(event?.message, 500),
        metadata: event?.metadata && typeof event.metadata === 'object'
          ? event.metadata
          : null,
      }))
      : [],
  };
}

function normalizeStoreState(value) {
  if (value?.version === 2 && Object.prototype.hasOwnProperty.call(value, 'active')) {
    const active = value.active === null ? null : normalizePendingIncident(value.active);
    if (!Array.isArray(value.recovered)) return null;
    const recoveredInput = value.recovered;
    const recovered = recoveredInput.map(normalizePendingIncident);
    if ((value.active !== null && !active)
      || recovered.some((incident) => !incident?.recoveredAt)) {
      return null;
    }
    return { active, recovered };
  }

  const legacyIncident = normalizePendingIncident(value);
  if (!legacyIncident) return null;
  return { active: legacyIncident, recovered: [] };
}

class DatabaseIncidentStore {
  constructor({
    pendingPath = DEFAULT_PENDING_PATH,
    fsPromises = fs.promises,
    now = () => new Date(),
    createId = randomUUID,
    retentionDays = positiveInteger(
      process.env.DATABASE_INCIDENT_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS
    ),
  } = {}) {
    this.pendingPath = pendingPath;
    this.fs = fsPromises;
    this.now = now;
    this.createId = createId;
    this.retentionDays = retentionDays;
    this.pending = undefined;
    this.recoveredIncidents = [];
    this.writeChain = Promise.resolve();
    this.mutationChain = Promise.resolve();
  }

  runMutation(operation) {
    const result = this.mutationChain
      .catch(() => {})
      .then(operation);
    this.mutationChain = result.catch(() => {});
    return result;
  }

  async load() {
    return this.runMutation(() => this.loadUnlocked());
  }

  async loadUnlocked() {
    if (this.pending !== undefined) return this.pending;
    try {
      const raw = await this.fs.readFile(this.pendingPath, 'utf8');
      const state = normalizeStoreState(JSON.parse(raw));
      if (!state) {
        const invalidError = new SyntaxError('Database incident spool has an invalid shape.');
        invalidError.code = 'DATABASE_INCIDENT_SPOOL_INVALID';
        throw invalidError;
      }
      this.pending = state.active;
      this.recoveredIncidents = state.recovered;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        this.pending = null;
      } else if (error instanceof SyntaxError) {
        const timestamp = this.now().getTime();
        const quarantinePath = `${this.pendingPath}.corrupt-${timestamp}-${process.pid}`;
        try {
          await this.fs.rename(this.pendingPath, quarantinePath);
          this.pending = null;
          this.recoveredIncidents = [];
        } catch (quarantineError) {
          const spoolError = new Error('The invalid database incident spool could not be quarantined.');
          spoolError.name = 'DatabaseIncidentSpoolError';
          spoolError.code = 'DATABASE_INCIDENT_SPOOL_QUARANTINE_FAILED';
          spoolError.cause = quarantineError;
          throw spoolError;
        }
        const spoolError = new Error('An invalid database incident spool was quarantined.');
        spoolError.name = 'DatabaseIncidentSpoolError';
        spoolError.code = 'DATABASE_INCIDENT_SPOOL_CORRUPT';
        throw spoolError;
      } else {
        throw error;
      }
    }
    return this.pending;
  }

  async write() {
    const hasState = Boolean(this.pending) || this.recoveredIncidents.length > 0;
    const snapshot = hasState
      ? JSON.stringify({
        version: 2,
        active: this.pending,
        recovered: this.recoveredIncidents,
      }, null, 2)
      : null;
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      if (!snapshot) return;
      await this.fs.mkdir(path.dirname(this.pendingPath), { recursive: true });
      const temporaryPath = `${this.pendingPath}.${process.pid}.tmp`;
      try {
        await this.fs.writeFile(temporaryPath, `${snapshot}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        });
        if (typeof this.fs.chmod === 'function') {
          await this.fs.chmod(temporaryPath, 0o600);
        }
        await this.fs.rename(temporaryPath, this.pendingPath);
        if (typeof this.fs.chmod === 'function') {
          await this.fs.chmod(this.pendingPath, 0o600);
        }
      } catch (error) {
        if (typeof this.fs.unlink === 'function') {
          await this.fs.unlink(temporaryPath).catch(() => {});
        }
        throw error;
      }
    });
    return this.writeChain;
  }

  appendEvent(type, message, metadata = null, occurredAt = this.now()) {
    this.appendIncidentEvent(this.pending, type, message, metadata, occurredAt);
  }

  async beginOrResume(options = {}) {
    return this.runMutation(() => this.beginOrResumeUnlocked(options));
  }

  async beginOrResumeUnlocked({ startupFailure = false, error = null, at = this.now() } = {}) {
    await this.loadUnlocked();
    if (this.pending?.recoveredAt) {
      if (!this.recoveredIncidents.some(
        (incident) => incident.incidentId === this.pending.incidentId,
      )) {
        this.recoveredIncidents.push(this.pending);
      }
      this.pending = null;
    }
    if (!this.pending) {
      const startedAt = normalizeDate(at, this.now().toISOString());
      this.pending = normalizePendingIncident({
        incidentId: this.createId(),
        startedAt,
        startupFailure,
        connectionAttempts: 0,
        processStarts: 1,
        notification: {},
        events: [],
      });
      this.appendEvent(
        startupFailure ? 'startup_unavailable' : 'connection_lost',
        startupFailure
          ? 'Application entered startup maintenance mode while MongoDB was unavailable.'
          : 'Application entered maintenance mode after losing MongoDB.',
        null,
        at
      );
    } else {
      this.pending.processStarts += 1;
      this.pending.startupFailure = this.pending.startupFailure || startupFailure;
    }
    if (error) await this.recordConnectionAttemptUnlocked(error, at, { write: false });
    await this.write();
    return this.pending;
  }

  async recordConnectionAttempt(error, at = this.now(), { write = true } = {}) {
    return this.runMutation(() => this.recordConnectionAttemptUnlocked(error, at, { write }));
  }

  async recordConnectionAttemptUnlocked(error, at = this.now(), { write = true } = {}) {
    if (!this.pending) {
      await this.beginOrResumeUnlocked({ startupFailure: true, at });
    }
    this.pending.connectionAttempts += 1;
    this.pending.lastFailure = {
      occurredAt: normalizeDate(at, this.now().toISOString()),
      ...sanitizeConnectionError(error),
    };
    if (write) await this.write();
    return this.pending;
  }

  async markNotificationAttempt(at = this.now()) {
    return this.runMutation(async () => {
      if (!this.pending) return null;
      this.pending.notification.attemptedAt = normalizeDate(at, this.now().toISOString());
      this.pending.notification.attemptCount += 1;
      await this.write();
      return this.pending;
    });
  }

  async markNotificationSent(receipt, at = this.now()) {
    return this.runMutation(async () => {
      if (!this.pending) return null;
      this.pending.notification.sentAt = normalizeDate(at, this.now().toISOString());
      this.pending.notification.receipt = clip(receipt, 120);
      this.pending.notification.error = '';
      this.appendEvent('emergency_notification_sent', 'Emergency database outage notification sent.', null, at);
      await this.write();
      return this.pending;
    });
  }

  async markNotificationFailed(error, at = this.now()) {
    return this.runMutation(async () => {
      if (!this.pending) return null;
      this.pending.notification.error = sanitizeConnectionError(error).message;
      this.appendEvent(
        'emergency_notification_failed',
        'Emergency database outage notification could not be sent.',
        null,
        at
      );
      await this.write();
      return this.pending;
    });
  }

  async markNotificationCancelled(at = this.now(), incidentId = null) {
    return this.runMutation(async () => {
      const incident = this.findIncident(incidentId);
      if (!incident) return null;
      incident.notification.cancelledAt = normalizeDate(at, this.now().toISOString());
      incident.notification.cancellationError = '';
      this.appendIncidentEvent(
        incident,
        'emergency_notification_cancelled',
        'Emergency notification retries cancelled.',
        null,
        at,
      );
      await this.write();
      return incident;
    });
  }

  async markCancellationAttempt(incidentId = null) {
    return this.runMutation(async () => {
      const incident = this.findIncident(incidentId);
      if (!incident) return null;
      incident.notification.cancellationAttemptCount += 1;
      await this.write();
      return incident;
    });
  }

  async markCancellationFailed(error, at = this.now(), incidentId = null) {
    return this.runMutation(async () => {
      const incident = this.findIncident(incidentId);
      if (!incident) return null;
      incident.notification.cancellationError = sanitizeConnectionError(error).message;
      this.appendIncidentEvent(
        incident,
        'emergency_notification_cancellation_failed',
        'Emergency notification retries could not be cancelled.',
        null,
        at,
      );
      await this.write();
      return incident;
    });
  }

  async markRecoveryNotificationSent(at = this.now(), incidentId = null) {
    return this.runMutation(async () => {
      const incident = this.findIncident(incidentId);
      if (!incident) return null;
      incident.notification.recoverySentAt = normalizeDate(at, this.now().toISOString());
      incident.notification.recoveryError = '';
      this.appendIncidentEvent(
        incident,
        'recovery_notification_sent',
        'Database recovery notification sent.',
        null,
        at,
      );
      await this.write();
      return incident;
    });
  }

  async markRecoveryNotificationAttempt(incidentId = null) {
    return this.runMutation(async () => {
      const incident = this.findIncident(incidentId);
      if (!incident) return null;
      incident.notification.recoveryAttemptCount += 1;
      await this.write();
      return incident;
    });
  }

  async markRecoveryNotificationFailed(error, at = this.now(), incidentId = null) {
    return this.runMutation(async () => {
      const incident = this.findIncident(incidentId);
      if (!incident) return null;
      incident.notification.recoveryError = sanitizeConnectionError(error).message;
      this.appendIncidentEvent(
        incident,
        'recovery_notification_failed',
        'Database recovery notification could not be sent.',
        null,
        at,
      );
      await this.write();
      return incident;
    });
  }

  async markRecovered(at = this.now()) {
    return this.runMutation(async () => {
      if (!this.pending) return null;
      this.pending.recoveredAt = normalizeDate(at, this.now().toISOString());
      const durationMs = Math.max(
        0,
        new Date(this.pending.recoveredAt).getTime() - new Date(this.pending.startedAt).getTime()
      );
      this.appendEvent('connection_restored', 'MongoDB connection restored.', { durationMs }, at);
      await this.write();
      return this.pending;
    });
  }

  findIncident(incidentId = null) {
    if (!incidentId || this.pending?.incidentId === incidentId) return this.pending || null;
    return this.recoveredIncidents.find((incident) => incident.incidentId === incidentId) || null;
  }

  appendIncidentEvent(incident, type, message, metadata = null, occurredAt = this.now()) {
    if (!incident) return;
    incident.events.push({
      occurredAt: normalizeDate(occurredAt, this.now().toISOString()),
      type: clip(type, 80),
      message: clip(message, 500),
      metadata: metadata && typeof metadata === 'object' ? metadata : null,
    });
    incident.events = incident.events.slice(-MAX_EVENTS);
  }

  async listRecoveredIncidents() {
    return this.runMutation(() => this.listRecoveredIncidentsUnlocked());
  }

  async listRecoveredIncidentsUnlocked() {
    await this.loadUnlocked();
    const incidents = [...this.recoveredIncidents];
    if (this.pending?.recoveredAt) incidents.push(this.pending);
    return incidents;
  }

  buildPersistenceUpdate(pending) {
    const recoveredAt = new Date(pending.recoveredAt);
    const expiresAt = new Date(
      recoveredAt.getTime() + this.retentionDays * 24 * 60 * 60 * 1000
    );
    return {
      startedAt: new Date(pending.startedAt),
      recoveredAt,
      startupFailure: pending.startupFailure,
      connectionAttempts: pending.connectionAttempts,
      processStarts: pending.processStarts,
      lastFailure: pending.lastFailure
        ? {
          ...pending.lastFailure,
          occurredAt: pending.lastFailure.occurredAt
            ? new Date(pending.lastFailure.occurredAt)
            : null,
        }
        : null,
      notification: {
        ...pending.notification,
        attemptedAt: pending.notification.attemptedAt
          ? new Date(pending.notification.attemptedAt)
          : null,
        sentAt: pending.notification.sentAt ? new Date(pending.notification.sentAt) : null,
        cancelledAt: pending.notification.cancelledAt
          ? new Date(pending.notification.cancelledAt)
          : null,
        recoverySentAt: pending.notification.recoverySentAt
          ? new Date(pending.notification.recoverySentAt)
          : null,
      },
      events: pending.events.map((event) => ({
        ...event,
        occurredAt: new Date(event.occurredAt),
      })),
      expiresAt,
    };
  }

  async persistAndClear(IncidentModel, incidentIds = null) {
    return this.runMutation(() => this.persistAndClearUnlocked(IncidentModel, incidentIds));
  }

  async persistAndClearUnlocked(IncidentModel, incidentIds = null) {
    const requestedIds = Array.isArray(incidentIds)
      ? new Set(incidentIds.map(String))
      : null;
    const recovered = (await this.listRecoveredIncidentsUnlocked()).filter(
      (incident) => !requestedIds || requestedIds.has(String(incident.incidentId)),
    );
    if (recovered.length === 0) return false;

    for (const incident of recovered) {
      const query = IncidentModel.findOneAndUpdate(
        { _id: incident.incidentId },
        { $set: this.buildPersistenceUpdate(incident) },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
      if (typeof query?.exec === 'function') await query.exec();
      else await query;
    }

    const recoveredIds = new Set(recovered.map((incident) => incident.incidentId));
    const previousPending = this.pending;
    const previousRecovered = this.recoveredIncidents;
    if (this.pending?.recoveredAt && recoveredIds.has(this.pending.incidentId)) {
      this.pending = null;
    }
    this.recoveredIncidents = this.recoveredIncidents.filter(
      (incident) => !recoveredIds.has(incident.incidentId),
    );
    try {
      if (this.pending || this.recoveredIncidents.length > 0) {
        await this.write();
      } else {
        await this.fs.unlink(this.pendingPath).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
      }
    } catch (error) {
      this.pending = previousPending;
      this.recoveredIncidents = previousRecovered;
      throw error;
    }
    return true;
  }
}

module.exports = {
  DatabaseIncidentStore,
  DEFAULT_PENDING_PATH,
  DEFAULT_RETENTION_DAYS,
  normalizePendingIncident,
  normalizeStoreState,
  sanitizeConnectionError,
};
