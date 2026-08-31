const { EventEmitter } = require('events');
const mongoose = require('mongoose');

const DatabaseAvailabilityIncident = require('../models/database_availability_incident');
const logger = require('../utils/logger');
const {
  PUSHOVER_PRIORITIES,
  cancelPushoverEmergency,
  sendPushoverNotification,
} = require('../utils/pushover');
const {
  DatabaseIncidentStore,
  sanitizeConnectionError,
} = require('./databaseIncidentStore');

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_INITIAL_RETRY_MS = 2_000;
const DEFAULT_MAX_RETRY_MS = 30_000;
const DEFAULT_ALERT_AFTER_MS = 30_000;
const DEFAULT_NOTIFICATION_RETRY_MS = 5 * 60_000;
const DEFAULT_NOTIFICATION_MAX_ATTEMPTS = 3;
const DEFAULT_FLUSH_RETRY_MS = 60_000;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delayWithTimer(delayMs, setTimeoutFn = setTimeout) {
  return new Promise((resolve) => {
    setTimeoutFn(resolve, delayMs);
  });
}

function outageDurationText(durationMs) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs) / 1000));
  if (totalSeconds < 120) return `${totalSeconds} seconds`;
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 120) return `${totalMinutes} minutes`;
  return `${Math.round(totalMinutes / 60)} hours`;
}

class DatabaseLifecycleService extends EventEmitter {
  constructor({
    mongooseLib = mongoose,
    IncidentModel = DatabaseAvailabilityIncident,
    incidentStore = new DatabaseIncidentStore(),
    log = logger,
    notificationSender = sendPushoverNotification,
    notificationCanceller = cancelPushoverEmergency,
    mongoUri = process.env.MONGOOSE_URL,
    connectTimeoutMs = positiveInteger(
      process.env.DATABASE_CONNECT_TIMEOUT_MS,
      DEFAULT_CONNECT_TIMEOUT_MS
    ),
    initialRetryMs = positiveInteger(
      process.env.DATABASE_RETRY_INITIAL_MS,
      DEFAULT_INITIAL_RETRY_MS
    ),
    maxRetryMs = positiveInteger(
      process.env.DATABASE_RETRY_MAX_MS,
      DEFAULT_MAX_RETRY_MS
    ),
    alertAfterMs = positiveInteger(
      process.env.DATABASE_OUTAGE_ALERT_AFTER_MS,
      DEFAULT_ALERT_AFTER_MS
    ),
    notificationRetryMs = positiveInteger(
      process.env.DATABASE_OUTAGE_NOTIFICATION_RETRY_MS,
      DEFAULT_NOTIFICATION_RETRY_MS
    ),
    notificationMaxAttempts = positiveInteger(
      process.env.DATABASE_OUTAGE_NOTIFICATION_MAX_ATTEMPTS,
      DEFAULT_NOTIFICATION_MAX_ATTEMPTS
    ),
    flushRetryMs = positiveInteger(
      process.env.DATABASE_INCIDENT_FLUSH_RETRY_MS,
      DEFAULT_FLUSH_RETRY_MS
    ),
    now = () => new Date(),
    random = Math.random,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    sleep = null,
  } = {}) {
    super();
    this.mongoose = mongooseLib;
    this.IncidentModel = IncidentModel;
    this.incidentStore = incidentStore;
    this.log = log;
    this.notificationSender = notificationSender;
    this.notificationCanceller = notificationCanceller;
    this.mongoUri = mongoUri;
    this.connectTimeoutMs = connectTimeoutMs;
    this.initialRetryMs = initialRetryMs;
    this.maxRetryMs = Math.max(initialRetryMs, maxRetryMs);
    this.alertAfterMs = alertAfterMs;
    this.notificationRetryMs = notificationRetryMs;
    this.notificationMaxAttempts = notificationMaxAttempts;
    this.flushRetryMs = flushRetryMs;
    this.now = now;
    this.random = random;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.sleep = sleep || ((delayMs) => delayWithTimer(delayMs, this.setTimeoutFn));
    this.state = this.mongoose?.connection?.readyState === 1 ? 'ready' : 'idle';
    this.started = false;
    this.stopped = false;
    this.hasConnected = this.state === 'ready';
    this.readyEmitted = false;
    this.connectPromise = null;
    this.alertTimer = null;
    this.alertPromise = null;
    this.flushTimer = null;
    this.finalizationPromise = null;
    this.transitionChain = Promise.resolve();
    this.lastUnavailableAt = null;
    this.attemptCount = 0;

    this.onConnected = () => {
      this.queueTransition(() => this.handleReady()).catch(() => {});
    };
    this.onDisconnected = () => {
      if (!this.hasConnected || this.stopped) return;
      const disconnectError = this.lastError || new Error('MongoDB connection was lost.');
      this.lastError = null;
      this.queueTransition(() => this.handleUnavailable(
        disconnectError,
        { startupFailure: false, recordAttempt: true }
      )).catch(() => {});
    };
    this.onConnectionError = (error) => {
      this.lastError = sanitizeConnectionError(error);
    };
  }

  queueTransition(operation) {
    this.transitionChain = this.transitionChain
      .catch(() => {})
      .then(operation);
    return this.transitionChain;
  }

  getStatus() {
    const ready = this.mongoose?.connection?.readyState === 1 && this.state === 'ready';
    return {
      status: ready ? 'ready' : this.state,
      ready,
      connectionState: this.mongoose?.connection?.readyState ?? 0,
      unavailableSince: this.lastUnavailableAt,
      connectionAttempts: this.attemptCount,
    };
  }

  attachConnectionListeners() {
    const connection = this.mongoose?.connection;
    connection?.on?.('connected', this.onConnected);
    connection?.on?.('reconnected', this.onConnected);
    connection?.on?.('disconnected', this.onDisconnected);
    connection?.on?.('error', this.onConnectionError);
  }

  detachConnectionListeners() {
    const connection = this.mongoose?.connection;
    connection?.removeListener?.('connected', this.onConnected);
    connection?.removeListener?.('reconnected', this.onConnected);
    connection?.removeListener?.('disconnected', this.onDisconnected);
    connection?.removeListener?.('error', this.onConnectionError);
  }

  start() {
    if (this.connectPromise) return this.connectPromise;
    this.started = true;
    this.stopped = false;
    this.attachConnectionListeners();
    this.connectPromise = this.connectUntilReady();
    return this.connectPromise;
  }

  async connectUntilReady() {
    const existingIncident = await this.incidentStore.load().catch((error) => {
      this.log.error('Unable to load the pending database incident spool', {
        category: 'database_availability',
        metadata: { error: sanitizeConnectionError(error) },
      });
      return null;
    });
    if (existingIncident && !existingIncident.recoveredAt) {
      this.lastUnavailableAt = new Date(existingIncident.startedAt);
      this.scheduleEmergencyAlert(existingIncident);
    }

    if (this.mongoose?.connection?.readyState === 1) {
      await this.queueTransition(() => this.handleReady());
      return this.mongoose.connection;
    }

    let retryMs = this.initialRetryMs;
    while (!this.stopped && this.mongoose?.connection?.readyState !== 1) {
      this.attemptCount += 1;
      try {
        if (typeof this.mongoUri !== 'string' || !this.mongoUri.trim()) {
          const configError = new Error('MONGOOSE_URL is not configured.');
          configError.code = 'MISSING_MONGOOSE_URL';
          throw configError;
        }
        await this.mongoose.connect(this.mongoUri, {
          serverSelectionTimeoutMS: this.connectTimeoutMs,
          connectTimeoutMS: this.connectTimeoutMs,
          bufferCommands: false,
        });
        await this.queueTransition(() => this.handleReady());
        break;
      } catch (error) {
        await this.queueTransition(() => this.handleUnavailable(error, {
          startupFailure: !this.hasConnected,
          recordAttempt: true,
        }));
        if (error?.code === 'MISSING_MONGOOSE_URL') break;
        if (this.stopped) break;
        const jitter = 0.8 + (this.random() * 0.4);
        await this.sleep(Math.min(this.maxRetryMs, Math.round(retryMs * jitter)));
        retryMs = Math.min(this.maxRetryMs, retryMs * 2);
      }
    }
    return this.mongoose?.connection;
  }

  async handleUnavailable(error, { startupFailure, recordAttempt } = {}) {
    if (this.stopped) return;
    const wasUnavailable = this.state === 'unavailable';
    this.state = 'unavailable';
    if (this.flushTimer) {
      this.clearTimeoutFn(this.flushTimer);
      this.flushTimer = null;
    }
    this.lastUnavailableAt ||= this.now();
    let incident;
    try {
      if (!wasUnavailable) {
        incident = await this.incidentStore.beginOrResume({
          startupFailure,
          error: recordAttempt ? error : null,
          at: this.lastUnavailableAt,
        });
      } else if (recordAttempt) {
        incident = await this.incidentStore.recordConnectionAttempt(error, this.now());
      } else {
        incident = await this.incidentStore.load();
      }
    } catch (spoolError) {
      await this.log.error('Unable to update the local database incident spool', {
        category: 'database_availability',
        metadata: { error: sanitizeConnectionError(spoolError) },
      });
    }
    if (!wasUnavailable) {
      await this.log.error(
        startupFailure
          ? 'Application paused while waiting for MongoDB'
          : 'Application paused after losing MongoDB',
        {
          category: 'database_availability',
          metadata: {
            incidentId: incident?.incidentId || null,
            error: sanitizeConnectionError(error),
          },
        }
      );
      this.emit('unavailable', this.getStatus());
    }
    this.scheduleEmergencyAlert(incident);
  }

  scheduleEmergencyAlert(incident) {
    const notification = incident?.notification || {};
    const attemptCount = Number(notification.attemptCount)
      || (notification.attemptedAt ? 1 : 0);
    if (!incident || incident.recoveredAt || notification.sentAt
      || attemptCount >= this.notificationMaxAttempts || this.alertTimer) {
      return;
    }
    const firstDueAt = new Date(incident.startedAt).getTime() + this.alertAfterMs;
    const retryDueAt = notification.attemptedAt
      ? new Date(notification.attemptedAt).getTime() + this.notificationRetryMs
      : firstDueAt;
    const delayMs = Math.max(0, retryDueAt - this.now().getTime());
    this.alertTimer = this.setTimeoutFn(() => {
      this.alertTimer = null;
      this.alertPromise = this.sendEmergencyAlert().finally(() => {
        this.alertPromise = null;
      });
      this.alertPromise.catch(() => {});
      return this.alertPromise;
    }, delayMs);
    this.alertTimer?.unref?.();
  }

  async sendEmergencyAlert() {
    if (this.state === 'ready' || this.mongoose?.connection?.readyState === 1) return;
    let incident;
    try {
      incident = await this.incidentStore.load();
      const attemptCount = Number(incident?.notification?.attemptCount)
        || (incident?.notification?.attemptedAt ? 1 : 0);
      if (!incident || incident.recoveredAt || incident.notification?.sentAt
        || attemptCount >= this.notificationMaxAttempts) return;
      if (this.state === 'ready' || this.mongoose?.connection?.readyState === 1) return;
      incident = await this.incidentStore.markNotificationAttempt(this.now());
      if (this.state === 'ready' || this.mongoose?.connection?.readyState === 1) return;
    } catch (error) {
      await this.log.error('Unable to persist emergency database notification state', {
        category: 'database_availability',
        metadata: { error: sanitizeConnectionError(error) },
      });
      return;
    }
    try {
      const response = await this.notificationSender({
        title: 'Database unavailable - application paused',
        message: 'The web application cannot reach MongoDB and is in maintenance mode. The Windows host may require a login before Docker starts. Please check the host and database.',
        priority: PUSHOVER_PRIORITIES.EMERGENCY,
        retry: 120,
        expire: 10_800,
      });
      await this.incidentStore.markNotificationSent(response?.receipt || '', this.now());
      await this.log.notice('Emergency database outage notification sent', {
        category: 'database_availability',
        metadata: { incidentId: incident.incidentId },
      });
    } catch (error) {
      try {
        incident = await this.incidentStore.markNotificationFailed(error, this.now());
      } catch (spoolError) {
        await this.log.error('Unable to persist database notification failure state', {
          category: 'database_availability',
          metadata: { error: sanitizeConnectionError(spoolError) },
        });
      }
      await this.log.warning('Unable to send emergency database outage notification', {
        category: 'database_availability',
        metadata: {
          incidentId: incident.incidentId,
          error: sanitizeConnectionError(error),
        },
      });
      this.scheduleEmergencyAlert(incident);
    }
  }

  async handleReady() {
    if (this.stopped || this.mongoose?.connection?.readyState !== 1) return;
    const recoveredTransition = this.state === 'unavailable';
    const shouldEmitReady = !this.readyEmitted || this.state !== 'ready';
    this.state = 'ready';
    this.hasConnected = true;
    this.lastError = null;
    if (this.alertTimer) {
      this.clearTimeoutFn(this.alertTimer);
      this.alertTimer = null;
    }
    if (this.alertPromise) await this.alertPromise.catch(() => {});

    let incident = null;
    try {
      incident = await this.incidentStore.load();
      if (incident && !incident.recoveredAt) {
        incident = await this.incidentStore.markRecovered(this.now());
      }
    } catch (error) {
      await this.log.error('Unable to finalize the local database incident spool', {
        category: 'database_availability',
        metadata: { error: sanitizeConnectionError(error) },
      });
    }

    if (shouldEmitReady) {
      const resumedAfterOutage = recoveredTransition || Boolean(incident);
      const durationMs = incident
        ? Math.max(
          0,
          new Date(incident.recoveredAt || this.now()).getTime()
            - new Date(incident.startedAt).getTime(),
        )
        : 0;
      await this.log.notice(
        resumedAfterOutage
          ? 'MongoDB connection restored; application resumed'
          : 'MongoDB connected; application ready',
        {
          category: 'database_availability',
          metadata: {
            incidentId: incident?.incidentId || null,
            durationMs,
            connectionAttempts: incident?.connectionAttempts || this.attemptCount,
          },
        }
      );
      this.readyEmitted = true;
      this.emit('ready', this.getStatus());
    }
    if (recoveredTransition) this.emit('recovered', this.getStatus());

    await this.finalizeRecoveredIncidents(incident);
    this.lastUnavailableAt = null;
  }

  async finishNotifications(incident) {
    if (!this.getStatus().ready) return false;
    let cancellationComplete = true;
    const receipt = incident?.notification?.receipt;
    const cancellationAttempts = Number(
      incident?.notification?.cancellationAttemptCount,
    ) || 0;
    if (receipt && !incident.notification.cancelledAt
      && cancellationAttempts < this.notificationMaxAttempts) {
      try {
        await this.incidentStore.markCancellationAttempt(incident.incidentId);
        await this.notificationCanceller(receipt);
        await this.incidentStore.markNotificationCancelled(this.now(), incident.incidentId);
      } catch (error) {
        try {
          await this.incidentStore.markCancellationFailed(
            error,
            this.now(),
            incident.incidentId,
          );
        } catch (spoolError) {
          await this.log.error('Unable to persist database notification cancellation failure', {
            category: 'database_availability',
            metadata: { error: sanitizeConnectionError(spoolError) },
          });
        }
        await this.log.warning('Unable to cancel emergency database notification retries', {
          category: 'database_availability',
          metadata: {
            incidentId: incident.incidentId,
            error: sanitizeConnectionError(error),
          },
        });
        const attemptsAfterFailure = Number(
          incident.notification.cancellationAttemptCount,
        ) || 0;
        cancellationComplete = attemptsAfterFailure >= this.notificationMaxAttempts;
      }
    }

    if (!this.getStatus().ready) return false;
    if (incident?.notification?.sentAt && !incident.notification.recoverySentAt) {
      const recoveryAttempts = Number(incident.notification.recoveryAttemptCount) || 0;
      if (recoveryAttempts < this.notificationMaxAttempts) {
        const durationMs = Math.max(
          0,
          new Date(incident.recoveredAt).getTime() - new Date(incident.startedAt).getTime()
        );
        try {
          await this.incidentStore.markRecoveryNotificationAttempt(incident.incidentId);
          await this.notificationSender({
            title: 'Database connection restored',
            message: `MongoDB is available again and the web application resumed after ${outageDurationText(durationMs)}.`,
            priority: PUSHOVER_PRIORITIES.MEDIUM,
          });
          await this.incidentStore.markRecoveryNotificationSent(
            this.now(),
            incident.incidentId,
          );
        } catch (error) {
          try {
            await this.incidentStore.markRecoveryNotificationFailed(
              error,
              this.now(),
              incident.incidentId,
            );
          } catch (spoolError) {
            await this.log.error('Unable to persist database recovery notification failure', {
              category: 'database_availability',
              metadata: { error: sanitizeConnectionError(spoolError) },
            });
          }
          await this.log.warning('Unable to send database recovery notification', {
            category: 'database_availability',
            metadata: {
              incidentId: incident.incidentId,
              error: sanitizeConnectionError(error),
            },
          });
          const attemptsAfterFailure = Number(incident.notification.recoveryAttemptCount) || 0;
          if (attemptsAfterFailure < this.notificationMaxAttempts) {
            cancellationComplete = false;
          }
        }
      }
    }
    return cancellationComplete;
  }

  scheduleFinalizationRetry() {
    if (this.flushTimer || this.stopped || !this.getStatus().ready) return;
    this.flushTimer = this.setTimeoutFn(async () => {
      this.flushTimer = null;
      await this.finalizeRecoveredIncidents().catch(() => {});
    }, this.flushRetryMs);
    this.flushTimer?.unref?.();
  }

  async finalizeRecoveredIncidents(seedIncident = null) {
    if (!this.getStatus().ready) return;
    if (this.finalizationPromise) {
      await this.finalizationPromise.catch(() => {});
      if (!this.getStatus().ready) return;
    }

    const operation = this.performRecoveredIncidentFinalization(seedIncident);
    const trackedOperation = operation.finally(() => {
      if (this.finalizationPromise === trackedOperation) this.finalizationPromise = null;
    });
    this.finalizationPromise = trackedOperation;
    return trackedOperation;
  }

  async performRecoveredIncidentFinalization(seedIncident = null) {
    let recovered;
    try {
      recovered = typeof this.incidentStore.listRecoveredIncidents === 'function'
        ? await this.incidentStore.listRecoveredIncidents()
        : (seedIncident?.recoveredAt ? [seedIncident] : []);
    } catch (error) {
      await this.log.error('Unable to load recovered database incidents for finalization', {
        category: 'database_availability',
        metadata: { error: sanitizeConnectionError(error) },
      });
      this.scheduleFinalizationRetry();
      return;
    }
    if (recovered.length === 0) return;
    const finishedIncidentIds = [];
    for (const incident of recovered) {
      if (await this.finishNotifications(incident)) {
        finishedIncidentIds.push(incident.incidentId);
      }
    }
    if (finishedIncidentIds.length > 0) {
      await this.flushIncident(finishedIncidentIds);
    }
    if (finishedIncidentIds.length < recovered.length) {
      this.scheduleFinalizationRetry();
    }
  }

  async flushIncident(incidentIds = null) {
    if (!this.getStatus().ready) return;
    try {
      const persisted = await this.incidentStore.persistAndClear(
        this.IncidentModel,
        incidentIds,
      );
      if (persisted) {
        await this.log.notice('Persisted recovered database incident from local spool', {
          category: 'database_availability',
        });
      }
      if (this.flushTimer) {
        this.clearTimeoutFn(this.flushTimer);
        this.flushTimer = null;
      }
    } catch (error) {
      await this.log.warning('Unable to persist recovered database incident; local spool retained', {
        category: 'database_availability',
        metadata: { error: sanitizeConnectionError(error) },
      });
      this.scheduleFinalizationRetry();
    }
  }

  async stop() {
    this.stopped = true;
    this.detachConnectionListeners();
    if (this.alertTimer) this.clearTimeoutFn(this.alertTimer);
    if (this.flushTimer) this.clearTimeoutFn(this.flushTimer);
    this.alertTimer = null;
    this.flushTimer = null;
    await this.transitionChain.catch(() => {});
    await this.finalizationPromise?.catch(() => {});
  }
}

module.exports = {
  DatabaseLifecycleService,
  DEFAULT_ALERT_AFTER_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_INITIAL_RETRY_MS,
  DEFAULT_MAX_RETRY_MS,
  DEFAULT_NOTIFICATION_MAX_ATTEMPTS,
  DEFAULT_NOTIFICATION_RETRY_MS,
  outageDurationText,
};
