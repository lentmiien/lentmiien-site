const { EventEmitter } = require('events');

const {
  DatabaseLifecycleService,
} = require('../../services/databaseLifecycleService');

function createMongoose(connectImplementations = [], initialReadyState = 0) {
  const connection = new EventEmitter();
  connection.readyState = initialReadyState;
  const connect = jest.fn();
  connectImplementations.forEach((implementation) => {
    connect.mockImplementationOnce(implementation.bind(null, connection));
  });
  return { connection, connect };
}

function createIncidentStore(initialIncident = null) {
  let pending = initialIncident;
  const store = {
    load: jest.fn(async () => pending),
    listRecoveredIncidents: jest.fn(async () => (
      pending?.recoveredAt ? [pending] : []
    )),
    beginOrResume: jest.fn(async ({ startupFailure, error, at }) => {
      if (!pending || pending.recoveredAt) {
        pending = {
          incidentId: 'incident-1',
          startedAt: at.toISOString(),
          recoveredAt: null,
          startupFailure,
          connectionAttempts: 0,
          notification: {
            attemptedAt: null,
            attemptCount: 0,
            sentAt: null,
            receipt: '',
            cancelledAt: null,
            recoveryAttemptCount: 0,
            recoverySentAt: null,
          },
          events: [],
        };
      }
      if (error) pending.connectionAttempts += 1;
      return pending;
    }),
    recordConnectionAttempt: jest.fn(async () => {
      pending.connectionAttempts += 1;
      return pending;
    }),
    markNotificationAttempt: jest.fn(async (at) => {
      pending.notification.attemptedAt = at.toISOString();
      pending.notification.attemptCount = (pending.notification.attemptCount || 0) + 1;
      return pending;
    }),
    markNotificationSent: jest.fn(async (receipt, at) => {
      pending.notification.sentAt = at.toISOString();
      pending.notification.receipt = receipt;
      return pending;
    }),
    markNotificationFailed: jest.fn(async (error) => {
      pending.notification.error = error.message;
      return pending;
    }),
    markRecovered: jest.fn(async (at) => {
      pending.recoveredAt = at.toISOString();
      return pending;
    }),
    markNotificationCancelled: jest.fn(async (at) => {
      pending.notification.cancelledAt = at.toISOString();
      return pending;
    }),
    markCancellationAttempt: jest.fn(async () => {
      pending.notification.cancellationAttemptCount = (
        pending.notification.cancellationAttemptCount || 0
      ) + 1;
      return pending;
    }),
    markCancellationFailed: jest.fn(async (error) => {
      pending.notification.cancellationError = error.message;
      return pending;
    }),
    markRecoveryNotificationSent: jest.fn(async (at) => {
      pending.notification.recoverySentAt = at.toISOString();
      return pending;
    }),
    markRecoveryNotificationAttempt: jest.fn(async () => {
      pending.notification.recoveryAttemptCount = (
        pending.notification.recoveryAttemptCount || 0
      ) + 1;
      return pending;
    }),
    markRecoveryNotificationFailed: jest.fn(async (error) => {
      pending.notification.recoveryError = error.message;
      return pending;
    }),
    persistAndClear: jest.fn(async () => {
      if (!pending?.recoveredAt) return false;
      pending = null;
      return true;
    }),
    getPending: () => pending,
  };
  return store;
}

function createLogger() {
  return {
    notice: jest.fn().mockResolvedValue(),
    warning: jest.fn().mockResolvedValue(),
    error: jest.fn().mockResolvedValue(),
  };
}

function immediateTimer(callback) {
  Promise.resolve().then(callback);
  return { unref: jest.fn() };
}

describe('DatabaseLifecycleService', () => {
  test('retries with bounded backoff, sends one emergency, and resumes once', async () => {
    const mongooseLib = createMongoose([
      async () => { throw Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }); },
      async (connection) => {
        connection.readyState = 1;
        return connection;
      },
    ]);
    const store = createIncidentStore();
    const log = createLogger();
    const notificationSender = jest.fn()
      .mockResolvedValueOnce({ status: 1, receipt: 'A'.repeat(30) })
      .mockResolvedValueOnce({ status: 1 });
    const notificationCanceller = jest.fn().mockResolvedValue({ status: 1 });
    const sleep = jest.fn().mockResolvedValue();
    const ready = jest.fn();
    const unavailable = jest.fn();
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log,
      notificationSender,
      notificationCanceller,
      mongoUri: 'mongodb://localhost/test',
      initialRetryMs: 100,
      maxRetryMs: 200,
      alertAfterMs: 1,
      random: () => 0.5,
      sleep,
      setTimeoutFn: immediateTimer,
      clearTimeoutFn: jest.fn(),
      now: () => new Date('2026-08-29T00:30:00.000Z'),
    });
    lifecycle.on('ready', ready);
    lifecycle.on('unavailable', unavailable);

    await lifecycle.start();
    await lifecycle.transitionChain;

    expect(mongooseLib.connect).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(notificationSender).toHaveBeenCalledTimes(2);
    expect(notificationSender.mock.calls[0][0]).toMatchObject({
      priority: 2,
      retry: 120,
      expire: 10_800,
    });
    expect(notificationCanceller).toHaveBeenCalledWith('A'.repeat(30));
    expect(store.persistAndClear).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(lifecycle.getStatus()).toMatchObject({ ready: true, status: 'ready' });
    await lifecycle.stop();
  });

  test('does not submit a second emergency for a persisted outage after restart', async () => {
    const pendingIncident = {
      incidentId: 'existing-incident',
      startedAt: '2026-08-29T00:00:00.000Z',
      recoveredAt: null,
      startupFailure: true,
      connectionAttempts: 3,
      notification: {
        attemptedAt: '2026-08-29T00:01:00.000Z',
        sentAt: '2026-08-29T00:01:01.000Z',
        receipt: 'B'.repeat(30),
        cancelledAt: null,
        recoverySentAt: null,
      },
      events: [],
    };
    const mongooseLib = createMongoose([
      async (connection) => {
        connection.readyState = 1;
        return connection;
      },
    ]);
    const store = createIncidentStore(pendingIncident);
    const notificationSender = jest.fn().mockResolvedValue({ status: 1 });
    const notificationCanceller = jest.fn().mockResolvedValue({ status: 1 });
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log: createLogger(),
      notificationSender,
      notificationCanceller,
      mongoUri: 'mongodb://localhost/test',
      now: () => new Date('2026-08-29T01:00:00.000Z'),
    });

    await lifecycle.start();

    expect(notificationSender).toHaveBeenCalledTimes(1);
    expect(notificationSender).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Database connection restored',
      priority: 0,
    }));
    expect(notificationCanceller).toHaveBeenCalledWith('B'.repeat(30));
    expect(store.markNotificationAttempt).not.toHaveBeenCalled();
    await lifecycle.stop();
  });

  test('does not submit an emergency when the database recovers while alert state is loading', async () => {
    const incident = {
      incidentId: 'recovering-incident',
      startedAt: '2026-08-29T00:00:00.000Z',
      recoveredAt: null,
      notification: {
        attemptedAt: null,
        attemptCount: 0,
        sentAt: null,
      },
    };
    let releaseLoad;
    const loadBlocked = new Promise((resolve) => {
      releaseLoad = resolve;
    });
    const store = createIncidentStore(incident);
    store.load.mockImplementationOnce(async () => {
      await loadBlocked;
      return incident;
    });
    const mongooseLib = createMongoose([], 0);
    const notificationSender = jest.fn();
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log: createLogger(),
      notificationSender,
      notificationCanceller: jest.fn(),
    });
    lifecycle.state = 'unavailable';

    const alertPromise = lifecycle.sendEmergencyAlert();
    mongooseLib.connection.readyState = 1;
    lifecycle.state = 'ready';
    releaseLoad();
    await alertPromise;

    expect(store.markNotificationAttempt).not.toHaveBeenCalled();
    expect(notificationSender).not.toHaveBeenCalled();
  });

  test('retains the incident and retries emergency cancellation before importing it', async () => {
    const pendingIncident = {
      incidentId: 'cancel-retry-incident',
      startedAt: '2026-08-29T00:00:00.000Z',
      recoveredAt: null,
      startupFailure: true,
      connectionAttempts: 2,
      notification: {
        attemptedAt: '2026-08-29T00:01:00.000Z',
        sentAt: '2026-08-29T00:01:01.000Z',
        receipt: 'C'.repeat(30),
        cancelledAt: null,
        recoverySentAt: null,
      },
      events: [],
    };
    const mongooseLib = createMongoose([], 1);
    const store = createIncidentStore(pendingIncident);
    const notificationSender = jest.fn().mockResolvedValue({ status: 1 });
    const notificationCanceller = jest.fn()
      .mockRejectedValueOnce(new Error('temporary cancellation failure'))
      .mockResolvedValueOnce({ status: 1 });
    const scheduled = [];
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log: createLogger(),
      notificationSender,
      notificationCanceller,
      flushRetryMs: 100,
      setTimeoutFn: (callback) => {
        scheduled.push(callback);
        return { unref: jest.fn() };
      },
      clearTimeoutFn: jest.fn(),
      now: () => new Date('2026-08-29T01:00:00.000Z'),
    });

    await lifecycle.start();

    expect(store.persistAndClear).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    expect(notificationSender).toHaveBeenCalledTimes(1);

    await scheduled.shift()();

    expect(notificationCanceller).toHaveBeenCalledTimes(2);
    expect(notificationSender).toHaveBeenCalledTimes(1);
    expect(store.persistAndClear).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
  });

  test('imports the incident after bounded cancellation failures', async () => {
    const pendingIncident = {
      incidentId: 'cancel-exhausted-incident',
      startedAt: '2026-08-29T00:00:00.000Z',
      recoveredAt: null,
      startupFailure: true,
      connectionAttempts: 2,
      notification: {
        attemptedAt: '2026-08-29T00:01:00.000Z',
        attemptCount: 1,
        sentAt: '2026-08-29T00:01:01.000Z',
        receipt: 'E'.repeat(30),
        cancellationAttemptCount: 0,
        cancelledAt: null,
        recoveryAttemptCount: 0,
        recoverySentAt: null,
      },
      events: [],
    };
    const mongooseLib = createMongoose([], 1);
    const store = createIncidentStore(pendingIncident);
    const scheduled = [];
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log: createLogger(),
      notificationSender: jest.fn().mockResolvedValue({ status: 1 }),
      notificationCanceller: jest.fn().mockRejectedValue(new Error('receipt expired')),
      notificationMaxAttempts: 2,
      setTimeoutFn: (callback) => {
        scheduled.push(callback);
        return { unref: jest.fn() };
      },
      clearTimeoutFn: jest.fn(),
      now: () => new Date('2026-08-29T01:00:00.000Z'),
    });

    await lifecycle.start();
    expect(store.persistAndClear).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);

    await scheduled.shift()();

    expect(store.getPending()).toBeNull();
    expect(store.persistAndClear).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
  });

  test('retries a failed emergency submission with a bounded persisted attempt count', async () => {
    const mongooseLib = createMongoose();
    const store = createIncidentStore();
    const notificationSender = jest.fn()
      .mockRejectedValueOnce(new Error('temporary notification outage'))
      .mockResolvedValueOnce({ status: 1, receipt: 'D'.repeat(30) });
    const scheduled = [];
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log: createLogger(),
      notificationSender,
      notificationCanceller: jest.fn(),
      mongoUri: '',
      alertAfterMs: 10,
      notificationRetryMs: 100,
      notificationMaxAttempts: 3,
      setTimeoutFn: (callback) => {
        scheduled.push(callback);
        return { unref: jest.fn() };
      },
      clearTimeoutFn: jest.fn(),
      now: () => new Date('2026-08-29T00:30:00.000Z'),
    });

    await lifecycle.start();
    expect(scheduled).toHaveLength(1);

    await scheduled.shift()();
    expect(notificationSender).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);

    await scheduled.shift()();
    expect(notificationSender).toHaveBeenCalledTimes(2);
    expect(store.getPending().notification).toMatchObject({
      attemptCount: 2,
      sentAt: '2026-08-29T00:30:00.000Z',
      receipt: 'D'.repeat(30),
    });
    expect(scheduled).toHaveLength(0);
    await lifecycle.stop();
  });

  test('single-flights finalization and leaves newly recovered incidents for the next pass', async () => {
    const mongooseLib = createMongoose([], 1);
    const firstIncident = {
      incidentId: 'finalize-first',
      startedAt: '2026-08-29T00:00:00.000Z',
      recoveredAt: '2026-08-29T00:01:00.000Z',
      notification: {},
    };
    const secondIncident = {
      incidentId: 'finalize-second',
      startedAt: '2026-08-29T00:02:00.000Z',
      recoveredAt: '2026-08-29T00:03:00.000Z',
      notification: {},
    };
    let recovered = [firstIncident];
    const store = {
      listRecoveredIncidents: jest.fn(async () => [...recovered]),
      persistAndClear: jest.fn(async (_model, incidentIds) => {
        const ids = new Set(incidentIds);
        recovered = recovered.filter((incident) => !ids.has(incident.incidentId));
        return true;
      }),
    };
    let releaseFirst;
    const firstNotification = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log: createLogger(),
      notificationSender: jest.fn(),
      notificationCanceller: jest.fn(),
    });
    lifecycle.finishNotifications = jest.fn()
      .mockImplementationOnce(() => firstNotification)
      .mockResolvedValue(true);

    const firstFinalization = lifecycle.finalizeRecoveredIncidents();
    await Promise.resolve();
    recovered.push(secondIncident);
    const secondFinalization = lifecycle.finalizeRecoveredIncidents();
    releaseFirst(true);
    await Promise.all([firstFinalization, secondFinalization]);

    expect(store.persistAndClear).toHaveBeenNthCalledWith(1, {}, ['finalize-first']);
    expect(store.persistAndClear).toHaveBeenNthCalledWith(2, {}, ['finalize-second']);
    expect(recovered).toEqual([]);
    await lifecycle.stop();
  });

  test('marks runtime disconnect/reconnect transitions without duplicating startup', async () => {
    const mongooseLib = createMongoose([], 1);
    const store = createIncidentStore();
    const ready = jest.fn();
    const unavailable = jest.fn();
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log: createLogger(),
      notificationSender: jest.fn(),
      notificationCanceller: jest.fn(),
      alertAfterMs: 60_000,
      now: () => new Date('2026-08-29T01:00:00.000Z'),
    });
    lifecycle.on('ready', ready);
    lifecycle.on('unavailable', unavailable);
    await lifecycle.start();

    const driverError = Object.assign(new Error('driver connection reset'), {
      name: 'MongoNetworkError',
      code: 'ECONNRESET',
    });
    mongooseLib.connection.emit('error', driverError);
    mongooseLib.connection.readyState = 0;
    mongooseLib.connection.emit('disconnected');
    await lifecycle.transitionChain;
    mongooseLib.connection.readyState = 1;
    mongooseLib.connection.emit('reconnected');
    await lifecycle.transitionChain;

    expect(ready).toHaveBeenCalledTimes(2);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(store.beginOrResume).toHaveBeenCalledTimes(1);
    expect(store.beginOrResume).toHaveBeenCalledWith(expect.objectContaining({
      startupFailure: false,
      error: {
        name: 'MongoNetworkError',
        code: 'ECONNRESET',
        message: 'driver connection reset',
      },
    }));
    expect(store.markRecovered).toHaveBeenCalledTimes(1);
    await lifecycle.stop();
  });

  test('emits runtime recovery even when the local incident spool cannot be finalized', async () => {
    const mongooseLib = createMongoose([], 1);
    const store = createIncidentStore();
    store.load
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('spool read failed'));
    const log = createLogger();
    const ready = jest.fn();
    const unavailable = jest.fn();
    const recovered = jest.fn();
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: store,
      log,
      notificationSender: jest.fn(),
      notificationCanceller: jest.fn(),
      alertAfterMs: 60_000,
      now: () => new Date('2026-08-29T01:00:00.000Z'),
    });
    lifecycle.on('ready', ready);
    lifecycle.on('unavailable', unavailable);
    lifecycle.on('recovered', recovered);
    await lifecycle.start();

    mongooseLib.connection.readyState = 0;
    mongooseLib.connection.emit('disconnected');
    await lifecycle.transitionChain;
    mongooseLib.connection.readyState = 1;
    mongooseLib.connection.emit('reconnected');
    await lifecycle.transitionChain;

    expect(ready).toHaveBeenCalledTimes(2);
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(recovered).toHaveBeenCalledWith(expect.objectContaining({
      ready: true,
      status: 'ready',
    }));
    expect(log.error).toHaveBeenCalledWith(
      'Unable to finalize the local database incident spool',
      expect.objectContaining({ category: 'database_availability' }),
    );
    expect(log.notice).toHaveBeenLastCalledWith(
      'MongoDB connection restored; application resumed',
      expect.objectContaining({ category: 'database_availability' }),
    );
    await lifecycle.stop();
  });

  test('fails closed without retrying when MONGOOSE_URL is missing', async () => {
    const mongooseLib = createMongoose();
    const lifecycle = new DatabaseLifecycleService({
      mongooseLib,
      IncidentModel: {},
      incidentStore: createIncidentStore(),
      log: createLogger(),
      notificationSender: jest.fn(),
      notificationCanceller: jest.fn(),
      mongoUri: '',
      alertAfterMs: 60_000,
    });

    await lifecycle.start();

    expect(mongooseLib.connect).not.toHaveBeenCalled();
    expect(lifecycle.getStatus()).toMatchObject({ ready: false, status: 'unavailable' });
    await lifecycle.stop();
  });
});
