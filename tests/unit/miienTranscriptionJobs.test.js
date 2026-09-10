const MiienAsrSlot = require('../../models/miien_asr_slot');
const { MiienTranscriptionJobs, transcriptionLimits, UPLOAD_MS, MAX_JOBS } = require('../../utils/miienTranscriptionJobs');
const { MiienError } = require('../../services/miienChatService');
const principal = { _id: 'b'.repeat(24), name: 'owner' };
const conversation = 'a'.repeat(24);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function wav() {
  const b = Buffer.alloc(364); b.write('RIFF'); b.writeUInt32LE(356, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(320, 40); return b;
}
function slotStore() {
  const rows = new Map();
  return { rows, db: { readyState: 1, db: {} }, collection: { listIndexes: jest.fn(() => ({ toArray: async () => [
    { name: '_id_', key: { _id: 1 } }, { name: 'principalId_1', key: { principalId: 1 }, unique: true },
  ] })) }, create: jest.fn(async row => {
    if (rows.has(row._id) || [...rows.values()].some(r => r.principalId === row.principalId)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    rows.set(row._id, row);
  }), deleteOne: jest.fn(async query => { if (rows.get(query._id)?.jobId === query.jobId) rows.delete(query._id); }) };
}
let jobs, gateway, asr, slots, chat, logger, authorize;
beforeEach(() => {
  jest.useFakeTimers(); gateway = deferred();
  asr = { transcribeBuffer: jest.fn().mockReturnValue(gateway.promise) };
  slots = slotStore(); chat = { owned: jest.fn().mockResolvedValue({}) };
  authorize = jest.fn().mockResolvedValue(principal); logger = { warning: jest.fn(), error: jest.fn() };
  jobs = new MiienTranscriptionJobs({ chat, asr, slots, authorize, logger });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
async function start(user = principal, room = conversation) {
  const reserved = await jobs.reserve(user, room, {});
  const { job } = await jobs.beginUpload(user, room, reserved.id);
  await jobs.upload(job, wav()); await flush(); return job;
}
test('87.177 second Gateway queue/processing survives prior cutoffs; polling never dispatches; acknowledgment clears text', async () => {
  const job = await start();
  await jest.advanceTimersByTimeAsync(87177);
  expect((await jobs.get(principal, conversation, job.id)).status).toBe('transcribing');
  for (let i = 0; i < 20; i++) await jobs.get(principal, conversation, job.id);
  expect(asr.transcribeBuffer).toHaveBeenCalledTimes(1);
  expect(asr.transcribeBuffer.mock.calls[0][0].signal.aborted).toBe(false);
  gateway.resolve({ data: { text: '  Synthetic draft  ' } }); await job.task;
  expect(await jobs.get(principal, conversation, job.id)).toMatchObject({ status: 'ready', text: 'Synthetic draft', elapsedMs: 87177 });
  expect(slots.rows.size).toBe(0);
  await jobs.discard(principal, conversation, job.id, { action: 'acknowledge' });
  expect(await jobs.get(principal, conversation, job.id)).toMatchObject({ status: 'consumed' });
  expect(job.text).toBeNull();
  await jobs.discard(principal, conversation, job.id, { action: 'acknowledge' });
  expect((await jobs.beginUpload(principal, conversation, job.id)).accepted).toBe(false);
  expect(asr.transcribeBuffer).toHaveBeenCalledTimes(1);
});
test('duplicate concurrent uploads and status retries cannot submit twice', async () => {
  const r = await jobs.reserve(principal, conversation, {});
  const attempts = await Promise.all([jobs.beginUpload(principal, conversation, r.id), jobs.beginUpload(principal, conversation, r.id)]);
  expect(attempts.map(a => a.accepted)).toEqual([true, false]);
  const job = attempts[0].job;
  await Promise.all([jobs.upload(job, wav()), jobs.upload(job, wav())]); await flush();
  expect(asr.transcribeBuffer).toHaveBeenCalledTimes(1);
  gateway.resolve({ data: { text: 'Draft' } }); await job.task;
  await jobs.upload(job, wav()); expect(asr.transcribeBuffer).toHaveBeenCalledTimes(1);
});
test.each(['success', 'uncertain'])('local cancel discards payload but holds actual upstream capacity through %s settlement', async outcome => {
  const job = await start();
  await jobs.discard(principal, conversation, job.id, { action: 'cancel' });
  expect(asr.transcribeBuffer.mock.calls[0][0].signal.aborted).toBe(false);
  await expect(jobs.reserve(principal, conversation, {})).rejects.toMatchObject({ status: 429 });
  expect(slots.rows.size).toBe(1); expect(job.text).toBeNull();
  if (outcome === 'success') gateway.resolve({ data: { text: 'Must not retain' } });
  else gateway.reject(Object.assign(new Error('private speech'), { code: 'ECONNRESET' }));
  await job.task;
  expect(job.status).toBe('cancelled'); expect(job.text).toBeNull();
  expect(slots.rows.size).toBe(outcome === 'success' ? 0 : 1);
});
test.each([400, 404, 422, 502, null])('provider failure %s is safe; only definite rejection releases durable admission', async status => {
  const job = await start();
  gateway.reject(Object.assign(new Error('speech/token/filename'), { code: 'ECONNRESET', response: status ? { status, data: 'private transcript' } : undefined }));
  await job.task;
  expect(job.status).toBe('failed'); expect(job.text).toBeNull();
  expect(slots.rows.size).toBe([400, 404, 422].includes(status) ? 0 : 1);
  expect(logger.warning).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ category: 'chat5_miien_asr', metadata: expect.objectContaining({ jobId: job.id, httpStatus: status, errorCode: 'ECONNRESET', elapsedMs: 0 }) }));
  expect(JSON.stringify(logger.warning.mock.calls)).not.toMatch(/speech\/token|private transcript|filename/);
});
test('total deadline expires and aborts finite work, retains durable lock and drops late text and metadata', async () => {
  const job = await start();
  await jest.advanceTimersByTimeAsync(jobs.limits.deadlineMs);
  expect(job.status).toBe('expired'); expect(asr.transcribeBuffer.mock.calls[0][0].signal.aborted).toBe(true);
  gateway.reject(Object.assign(new Error('aborted'), { code: 'ERR_CANCELED' })); await job.task;
  expect(slots.rows.size).toBe(1);
  await jest.advanceTimersByTimeAsync(jobs.limits.retentionMs);
  expect(jobs.jobs.size).toBe(0);
  await expect(jobs.beginUpload(principal, conversation, job.id)).rejects.toMatchObject({ status: 404 });
  await expect(jobs.reserve(principal, conversation, {})).rejects.toMatchObject({ status: 429 });
});
test('lost acknowledgments and abandoned reservations expire without further reads', async () => {
  const job = await start(); gateway.resolve({ data: { text: 'Private result' } }); await job.task;
  await jest.advanceTimersByTimeAsync(jobs.limits.retentionMs);
  expect(job.text).toBeNull(); expect(jobs.jobs.size).toBe(0);
  const reserved = await jobs.reserve(principal, conversation, {});
  await jest.advanceTimersByTimeAsync(UPLOAD_MS);
  expect((await jobs.get(principal, conversation, reserved.id)).status).toBe('expired');
  expect(slots.rows.size).toBe(0);
});
test.each(['malformed', 'duration', 'stereo', 'wrong rate'])('%s audio releases reservation without dispatch', async kind => {
  const reserved = await jobs.reserve(principal, conversation, {}); const { job } = await jobs.beginUpload(principal, conversation, reserved.id);
  const b = kind === 'duration' ? Buffer.alloc(44 + 16000 * 2 * 61) : wav();
  if (kind === 'malformed') b.write('BAD!'); if (kind === 'stereo') b.writeUInt16LE(2, 22); if (kind === 'wrong rate') b.writeUInt32LE(44100, 24);
  await expect(jobs.upload(job, b)).rejects.toMatchObject({ status: 400 });
  expect(asr.transcribeBuffer).not.toHaveBeenCalled(); expect(slots.rows.size).toBe(0);
});
test('slow or cancelled uploads are closed and buffers never reach Gateway', async () => {
  const reserved = await jobs.reserve(principal, conversation, {}); const { job } = await jobs.beginUpload(principal, conversation, reserved.id);
  job.abortUpload = jest.fn(); await jest.advanceTimersByTimeAsync(UPLOAD_MS);
  expect(job.abortUpload).toHaveBeenCalledTimes(1); expect(slots.rows.size).toBe(0);
  await jobs.upload(job, wav()); expect(asr.transcribeBuffer).not.toHaveBeenCalled();
});
test('one per user and two global durable slots also bound separate workers and restart residue', async () => {
  await start();
  const other = new MiienTranscriptionJobs({ chat, asr, slots, authorize, logger });
  await expect(other.reserve(principal, conversation, {})).rejects.toMatchObject({ status: 429 });
  await other.reserve({ _id: 'c'.repeat(24) }, conversation, {});
  await expect(jobs.reserve({ _id: 'd'.repeat(24) }, conversation, {})).rejects.toMatchObject({ status: 429 });
  expect(slots.rows.size).toBe(2); expect(asr.transcribeBuffer).toHaveBeenCalledTimes(1);
  const [job] = jobs.jobs.values();
  await expect(other.get(principal, conversation, job.id)).rejects.toMatchObject({ status: 404 });
});
test('retained job limit is finite, even after upstream slots release', async () => {
  asr.transcribeBuffer.mockResolvedValue({ data: { text: 'Draft' } });
  for (let i = 0; i < MAX_JOBS; i++) { const job = await start(); await job.task; }
  await expect(jobs.reserve(principal, conversation, {})).rejects.toMatchObject({ status: 429 });
  await jest.advanceTimersByTimeAsync(jobs.limits.retentionMs);
  expect(jobs.jobs.size).toBe(0);
  await expect(jobs.reserve(principal, conversation, {})).resolves.toMatchObject({ status: 'awaiting_upload' });
});
test('foreign user, wrong conversation, missing/malformed handle deny reads, uploads and mutation equally', async () => {
  const job = await start();
  for (const [user, room, id] of [[{ _id: 'foreign' }, conversation, job.id], [principal, 'c'.repeat(24), job.id], [principal, conversation, 'x'.repeat(36)]]) {
    for (const operation of ['get', 'beginUpload']) await expect(jobs[operation](user, room, id)).rejects.toMatchObject({ status: 404 });
    await expect(jobs.discard(user, room, id, { action: 'cancel' })).rejects.toMatchObject({ status: 404 });
  }
  expect(job.status).toBe('transcribing');
});
test.each(['before', 'after'])('revocation %s dispatch prevents private result retention', async stage => {
  if (stage === 'before') authorize.mockResolvedValue(null);
  const job = await start();
  if (stage === 'after') { authorize.mockResolvedValue(null); gateway.resolve({ data: { text: 'Secret' } }); }
  await job.task;
  expect(job.status).toBe('failed'); expect(job.text).toBeNull(); expect(slots.rows.size).toBe(0);
  expect(asr.transcribeBuffer).toHaveBeenCalledTimes(stage === 'before' ? 0 : 1);
});
test('membership removal before result retention and on reads is enforced', async () => {
  const job = await start(); chat.owned.mockRejectedValue(new MiienError(404, 'Conversation not found.'));
  gateway.resolve({ data: { text: 'Secret' } }); await job.task;
  expect(job.text).toBeNull(); await expect(jobs.get(principal, conversation, job.id)).rejects.toMatchObject({ status: 404 });
});
test.each(['', 'x'.repeat(4001), null])('invalid transcript is not retained', async text => {
  const job = await start(); gateway.resolve({ data: { text } }); await job.task;
  expect(job.status).toBe('failed'); expect(job.text).toBeNull(); expect(slots.rows.size).toBe(0);
});
test('admission initialization/cleanup fails closed and logs actionable failure', async () => {
  slots.collection.listIndexes.mockImplementationOnce(() => { throw new Error('db unavailable'); });
  await expect(jobs.reserve(principal, conversation, {})).rejects.toMatchObject({ code: 'asr_index_check_failed' });
  expect(jobs.jobs.size).toBe(0); expect(asr.transcribeBuffer).not.toHaveBeenCalled();
  const job = await start(); slots.deleteOne.mockRejectedValue(new Error('private db'));
  gateway.resolve({ data: { text: 'Draft' } }); await job.task;
  expect(slots.rows.size).toBe(1); expect(logger.error).toHaveBeenCalled();
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private db');
});
test('unknown reservation/cancel fields and premature acknowledgment are rejected', async () => {
  await expect(jobs.reserve(principal, conversation, { owner: 'other' })).rejects.toMatchObject({ status: 400 });
  const job = await start();
  await expect(jobs.discard(principal, conversation, job.id, { action: 'delete' })).rejects.toMatchObject({ status: 400 });
  await expect(jobs.discard(principal, conversation, job.id, { action: 'acknowledge' })).rejects.toMatchObject({ status: 409 });
});
test('configuration stays finite and covers advertised 900s queue plus 1800s upstream budget', () => {
  expect(transcriptionLimits({})).toEqual({ deadlineMs: 2800000, retentionMs: 300000 });
  for (const raw of ['Infinity', '-1', '0', '60000', '9999999999']) expect(transcriptionLimits({ MIIEN_ASR_DEADLINE_MS: raw }).deadlineMs).toBe(2800000);
  expect(transcriptionLimits({ MIIEN_ASR_DEADLINE_MS: '3000000', MIIEN_ASR_RETENTION_MS: '60000' })).toEqual({ deadlineMs: 3000000, retentionMs: 60000 });
});

test('disconnected and locally cancelled uploads release unused admission with safe diagnostics', async () => {
  const reserved = await jobs.reserve(principal, conversation, {});
  const { job } = await jobs.beginUpload(principal, conversation, reserved.id);
  await jobs.uploadFailed(job, true);
  expect(slots.rows.size).toBe(0); expect(asr.transcribeBuffer).not.toHaveBeenCalled();
  expect(logger.warning).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ metadata: expect.objectContaining({ jobId: job.id, abortCategory: 'upload_disconnect' }) }));
  const next = await jobs.reserve(principal, conversation, {});
  const uploading = await jobs.beginUpload(principal, conversation, next.id);
  uploading.job.abortUpload = jest.fn();
  await jobs.discard(principal, conversation, next.id, { action: 'cancel' });
  expect(uploading.job.abortUpload).toHaveBeenCalledTimes(1); expect(slots.rows.size).toBe(0);
  await jobs.upload(uploading.job, wav()); expect(asr.transcribeBuffer).not.toHaveBeenCalled();
});
test('durable slot model declares admission index without import-time DDL or expiry', () => {
  const model = MiienAsrSlot;
  expect(model.schema.options).toMatchObject({ autoIndex: false, autoCreate: false, bufferCommands: false });
  expect(model.schema.indexes()).toContainEqual([{ principalId: 1 }, expect.objectContaining({ unique: true })]);
  expect(model.schema.indexes().some(([, options]) => 'expireAfterSeconds' in options)).toBe(false);
  expect(Object.keys(model.schema.paths)).toEqual(['_id', 'jobId', 'principalId', 'conversationId', 'startedAt']);
});
