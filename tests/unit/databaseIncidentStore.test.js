const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DatabaseIncidentStore,
  sanitizeConnectionError,
} = require('../../services/databaseIncidentStore');

describe('DatabaseIncidentStore', () => {
  let tempDirectory;
  let pendingPath;

  beforeEach(async () => {
    tempDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'database-incident-'));
    pendingPath = path.join(tempDirectory, 'pending.json');
  });

  afterEach(async () => {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true });
  });

  test('redacts MongoDB URIs and embedded URL credentials from error summaries', () => {
    const error = Object.assign(new Error(
      'connect failed mongodb://user:password@localhost:27017/private and https://alice:secret@example.test/path'
    ), { code: 'ECONNREFUSED' });

    const summary = sanitizeConnectionError(error);

    expect(summary).toMatchObject({ name: 'Error', code: 'ECONNREFUSED' });
    expect(summary.message).not.toContain('password');
    expect(summary.message).not.toContain('secret');
    expect(summary.message).not.toContain('/private');
    expect(summary.message).toContain('[redacted MongoDB URI]');
    expect(summary.message).toContain('https://[redacted]@example.test/path');
  });

  test('persists one resumable outage record with private file permissions', async () => {
    const startedAt = new Date('2026-08-29T00:00:00.000Z');
    const first = new DatabaseIncidentStore({
      pendingPath,
      now: () => startedAt,
      createId: () => 'incident-1',
    });

    const incident = await first.beginOrResume({
      startupFailure: true,
      error: Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }),
      at: startedAt,
    });
    const second = new DatabaseIncidentStore({
      pendingPath,
      now: () => new Date('2026-08-29T00:01:00.000Z'),
    });
    const resumed = await second.beginOrResume({ startupFailure: true });

    expect(incident).toMatchObject({
      incidentId: 'incident-1',
      startupFailure: true,
      connectionAttempts: 1,
      processStarts: 1,
    });
    expect(resumed).toMatchObject({ incidentId: 'incident-1', processStarts: 2 });
    const stats = await fs.promises.stat(pendingPath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  test('quarantines a truncated spool without discarding it silently', async () => {
    await fs.promises.writeFile(pendingPath, '{"incidentId":', { mode: 0o600 });
    const store = new DatabaseIncidentStore({
      pendingPath,
      now: () => new Date('2026-08-29T00:05:00.000Z'),
      createId: () => 'replacement-incident',
    });

    await expect(store.load()).rejects.toMatchObject({
      name: 'DatabaseIncidentSpoolError',
      code: 'DATABASE_INCIDENT_SPOOL_CORRUPT',
    });
    const filesAfterQuarantine = await fs.promises.readdir(tempDirectory);
    expect(filesAfterQuarantine).toEqual([
      expect.stringMatching(/^pending\.json\.corrupt-\d+-\d+$/),
    ]);

    await expect(store.beginOrResume({ startupFailure: true })).resolves.toMatchObject({
      incidentId: 'replacement-incident',
    });
    const filesAfterReplacement = await fs.promises.readdir(tempDirectory);
    expect(filesAfterReplacement).toHaveLength(2);
    await expect(fs.promises.access(pendingPath)).resolves.toBeUndefined();
  });

  test('imports a recovered incident idempotently and clears only its pending spool', async () => {
    const times = [
      new Date('2026-08-29T00:00:00.000Z'),
      new Date('2026-08-29T00:01:00.000Z'),
    ];
    let index = 0;
    const store = new DatabaseIncidentStore({
      pendingPath,
      now: () => times[Math.min(index++, times.length - 1)],
      createId: () => 'incident-2',
      retentionDays: 10,
    });
    await store.beginOrResume({ startupFailure: true, at: times[0] });
    await store.markNotificationAttempt(times[0]);
    await store.markNotificationSent('A'.repeat(30), times[0]);
    await store.markRecovered(times[1]);

    const exec = jest.fn().mockResolvedValue({ _id: 'incident-2' });
    const IncidentModel = {
      findOneAndUpdate: jest.fn(() => ({ exec })),
    };

    await expect(store.persistAndClear(IncidentModel)).resolves.toBe(true);

    expect(IncidentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'incident-2' },
      expect.objectContaining({
        $set: expect.objectContaining({
          recoveredAt: times[1],
          expiresAt: new Date('2026-09-08T00:01:00.000Z'),
        }),
      }),
      expect.objectContaining({ upsert: true })
    );
    await expect(fs.promises.access(pendingPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(store.persistAndClear(IncidentModel)).resolves.toBe(false);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('preserves a recovered incident when a second outage begins before import', async () => {
    const ids = ['incident-first', 'incident-second'];
    const store = new DatabaseIncidentStore({
      pendingPath,
      createId: () => ids.shift(),
      now: () => new Date('2026-08-29T00:00:00.000Z'),
    });
    await store.beginOrResume({
      startupFailure: true,
      at: new Date('2026-08-29T00:00:00.000Z'),
    });
    await store.markNotificationAttempt(new Date('2026-08-29T00:00:30.000Z'));
    await store.markNotificationSent(
      'F'.repeat(30),
      new Date('2026-08-29T00:00:31.000Z'),
    );
    await store.markRecovered(new Date('2026-08-29T00:01:00.000Z'));

    const active = await store.beginOrResume({
      startupFailure: false,
      at: new Date('2026-08-29T00:02:00.000Z'),
    });

    expect(active).toMatchObject({ incidentId: 'incident-second', recoveredAt: null });
    await expect(store.listRecoveredIncidents()).resolves.toEqual([
      expect.objectContaining({ incidentId: 'incident-first' }),
    ]);
    await store.markRecovered(new Date('2026-08-29T00:03:00.000Z'));
    await expect(store.listRecoveredIncidents()).resolves.toEqual([
      expect.objectContaining({ incidentId: 'incident-first' }),
      expect.objectContaining({ incidentId: 'incident-second' }),
    ]);

    const exec = jest.fn().mockResolvedValue({ _id: 'incident-first' });
    const IncidentModel = {
      findOneAndUpdate: jest.fn(() => ({ exec })),
    };
    await expect(store.persistAndClear(IncidentModel, ['incident-first'])).resolves.toBe(true);
    expect(IncidentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'incident-first' },
      expect.any(Object),
      expect.objectContaining({ upsert: true }),
    );

    const reloaded = new DatabaseIncidentStore({ pendingPath });
    await expect(reloaded.load()).resolves.toMatchObject({
      incidentId: 'incident-second',
      recoveredAt: '2026-08-29T00:03:00.000Z',
    });
    await expect(reloaded.listRecoveredIncidents()).resolves.toEqual([
      expect.objectContaining({ incidentId: 'incident-second' }),
    ]);
  });

  test('serializes a new outage behind recovered-incident import and file cleanup', async () => {
    let releaseUnlink;
    let reportUnlinkStarted;
    const unlinkStarted = new Promise((resolve) => {
      reportUnlinkStarted = resolve;
    });
    const unlinkReleased = new Promise((resolve) => {
      releaseUnlink = resolve;
    });
    const controlledFs = {
      readFile: fs.promises.readFile.bind(fs.promises),
      mkdir: fs.promises.mkdir.bind(fs.promises),
      writeFile: fs.promises.writeFile.bind(fs.promises),
      chmod: fs.promises.chmod.bind(fs.promises),
      rename: fs.promises.rename.bind(fs.promises),
      unlink: jest.fn(async (target) => {
        if (target === pendingPath) {
          reportUnlinkStarted();
          await unlinkReleased;
        }
        return fs.promises.unlink(target);
      }),
    };
    const createId = jest.fn()
      .mockReturnValueOnce('incident-first')
      .mockReturnValueOnce('incident-second');
    const store = new DatabaseIncidentStore({ pendingPath, fsPromises: controlledFs, createId });
    await store.beginOrResume({
      startupFailure: true,
      at: new Date('2026-08-29T00:00:00.000Z'),
    });
    await store.markRecovered(new Date('2026-08-29T00:01:00.000Z'));
    const IncidentModel = {
      findOneAndUpdate: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({ _id: 'incident-first' }),
      })),
    };

    const importPromise = store.persistAndClear(IncidentModel);
    await unlinkStarted;
    const nextOutagePromise = store.beginOrResume({
      startupFailure: false,
      at: new Date('2026-08-29T00:02:00.000Z'),
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(createId).toHaveBeenCalledTimes(1);
    releaseUnlink();
    await expect(importPromise).resolves.toBe(true);
    await expect(nextOutagePromise).resolves.toMatchObject({
      incidentId: 'incident-second',
      recoveredAt: null,
    });

    const reloaded = new DatabaseIncidentStore({ pendingPath });
    await expect(reloaded.load()).resolves.toMatchObject({
      incidentId: 'incident-second',
      recoveredAt: null,
    });
    await expect(reloaded.listRecoveredIncidents()).resolves.toEqual([]);
    expect(IncidentModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'incident-first' },
      expect.any(Object),
      expect.objectContaining({ upsert: true }),
    );
  });

  test('does not restore stale in-memory state over an outage queued during failed cleanup', async () => {
    let releaseUnlink;
    let reportUnlinkStarted;
    const unlinkStarted = new Promise((resolve) => {
      reportUnlinkStarted = resolve;
    });
    const unlinkReleased = new Promise((resolve) => {
      releaseUnlink = resolve;
    });
    const controlledFs = {
      readFile: fs.promises.readFile.bind(fs.promises),
      mkdir: fs.promises.mkdir.bind(fs.promises),
      writeFile: fs.promises.writeFile.bind(fs.promises),
      chmod: fs.promises.chmod.bind(fs.promises),
      rename: fs.promises.rename.bind(fs.promises),
      unlink: jest.fn(async (target) => {
        if (target === pendingPath) {
          reportUnlinkStarted();
          await unlinkReleased;
          const error = new Error('cleanup denied');
          error.code = 'EACCES';
          throw error;
        }
        return fs.promises.unlink(target);
      }),
    };
    const createId = jest.fn()
      .mockReturnValueOnce('incident-first')
      .mockReturnValueOnce('incident-second');
    const store = new DatabaseIncidentStore({ pendingPath, fsPromises: controlledFs, createId });
    await store.beginOrResume({
      startupFailure: true,
      at: new Date('2026-08-29T00:00:00.000Z'),
    });
    await store.markRecovered(new Date('2026-08-29T00:01:00.000Z'));
    const IncidentModel = {
      findOneAndUpdate: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({ _id: 'incident-first' }),
      })),
    };

    const importPromise = store.persistAndClear(IncidentModel);
    await unlinkStarted;
    const nextOutagePromise = store.beginOrResume({
      startupFailure: false,
      at: new Date('2026-08-29T00:02:00.000Z'),
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(createId).toHaveBeenCalledTimes(1);
    releaseUnlink();
    await expect(importPromise).rejects.toMatchObject({ code: 'EACCES' });
    await expect(nextOutagePromise).resolves.toMatchObject({
      incidentId: 'incident-second',
      recoveredAt: null,
    });
    await expect(store.listRecoveredIncidents()).resolves.toEqual([
      expect.objectContaining({ incidentId: 'incident-first' }),
    ]);
    await expect(store.load()).resolves.toMatchObject({ incidentId: 'incident-second' });

    const reloaded = new DatabaseIncidentStore({ pendingPath });
    await expect(reloaded.load()).resolves.toMatchObject({ incidentId: 'incident-second' });
    await expect(reloaded.listRecoveredIncidents()).resolves.toEqual([
      expect.objectContaining({ incidentId: 'incident-first' }),
    ]);
  });

  test('retains the local incident when the MongoDB import fails', async () => {
    const store = new DatabaseIncidentStore({
      pendingPath,
      createId: () => 'incident-3',
    });
    await store.beginOrResume({ startupFailure: false });
    await store.markRecovered();
    const IncidentModel = {
      findOneAndUpdate: jest.fn(() => ({
        exec: jest.fn().mockRejectedValue(new Error('write unavailable')),
      })),
    };

    await expect(store.persistAndClear(IncidentModel)).rejects.toThrow('write unavailable');
    await expect(fs.promises.access(pendingPath)).resolves.toBeUndefined();
  });
});
