jest.mock('../../utils/logger', () => ({ notice: jest.fn(), warning: jest.fn(), error: jest.fn() }));
const logger = require('../../utils/logger');
const { TaricError } = require('../../utils/taricContracts');
const { createWorker } = require('../../services/taric/worker');
const { createService } = require('../../services/taric/service');
const query = value => ({ maxTimeMS() { return this; }, lean() { return this; }, limit() { return this; }, exec: async () => value });

test.each(['EVIDENCE_NOT_FOUND', 'CATALOG_REJECTED', 'STORAGE_FAILED', 'PROVIDER_FAILED'])(
  '%s retains request failure semantics and logs at the appropriate application level', async code => {
    const missingEvidence = code === 'EVIDENCE_NOT_FOUND';
    const request = { _id: 'a'.repeat(32), input: { test: true }, admission: { adapter: 'synthetic' } };
    const models = {
      Control: { findOneAndUpdate: () => query({}), findOne: () => query({}), updateOne: () => query({ matchedCount: 1 }) },
      Run: { find: () => query([]) },
      Request: { updateMany: () => query({ modifiedCount: 0 }), findOneAndUpdate: () => query(request), updateOne: jest.fn(() => query({ matchedCount: 1 })) },
    };
    const generate = jest.fn().mockRejectedValue(new TaricError(code));
    const open = jest.fn().mockResolvedValue({ id: 'synthetic' });
    const resolve = missingEvidence ? jest.fn().mockRejectedValue(new TaricError(code)) : jest.fn().mockResolvedValue({ facts: {} });
    const service = { models, now: Date.now, authorize: async () => {}, principalFrom: () => ({}),
      checkAdmission: async () => ({ settings: { testCatalog: { codes: [] } } }), evidence: { resolve },
      warmSessions: { open, generate, close: async () => ({ idle: true }) } };
    const worker = createWorker(service);
    worker.start();
    try { await worker.tick(); } finally { worker.stop(); }
    expect(models.Request.updateOne).toHaveBeenCalledWith(expect.anything(), { $set: expect.objectContaining({ state: 'failed', active: false, result: null, error: code, retryable: false }) });
    const expected = ['EVIDENCE_NOT_FOUND', 'CATALOG_REJECTED'].includes(code);
    expect(logger[expected ? 'notice' : 'warning']).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      metadata: expect.objectContaining({ code, requestId: request._id, operation: 'request' }),
    }));
    expect(logger[expected ? 'warning' : 'notice']).not.toHaveBeenCalled();
    if (missingEvidence) { expect(open).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled(); }
  },
);

test.each([false, true])('unapproved registry diagnostics stay visible without app warnings (rejected=%s)', async rejected => {
  const rejection = new TaricError('CATALOG_REJECTED');
  const generate = async (_session, _row, _codes, _tokens, options) => {
    if (rejected) { options.onDiagnostics({ proposal: { taric_code: '9999999999' } }); throw rejection; }
    return { taric_code: '9999999999' };
  };
  const service = createService({ models: { ApprovedCode: { find: () => query([]) } }, transport: {},
    codeVersion: 'synthetic', warmSessions: { generate } });
  const onDiagnostics = jest.fn();
  const result = service.warmSessions.generate({}, {}, [], 10, { onDiagnostics });
  if (rejected) {
    await expect(result).rejects.toBe(rejection);
    expect(onDiagnostics).toHaveBeenLastCalledWith(expect.objectContaining({ approved_code: { status: 'unapproved', taric_code: '9999999999', revision: null } }));
  } else await expect(result).resolves.toMatchObject({ warnings: ['unapproved_taric_code'] });
  expect(logger.notice).toHaveBeenCalledWith(expect.stringContaining('unapproved code'), expect.objectContaining({ category: 'taric' }));
  expect(logger.warning).not.toHaveBeenCalled();
});
