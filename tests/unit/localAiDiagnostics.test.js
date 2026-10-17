const { operation, errorDiagnostic } = require('../../services/localAi/diagnostics');
const { Gateway } = require('../../services/localAi/gateway');
describe('Local AI sanitized operational diagnostics', () => {
  test.each([
    [Object.assign(new TypeError('mongodb://user:password@host/database'), { stack: 'private prompt' }), { reasonClass: 'type_error' }],
    [Object.assign(new Error('duplicate private contents'), { name: 'MongoServerError', code: 11000, keyValue: { secret: 'token' } }), { reasonClass: 'mongo_server_error', mongoCode: 11000 }],
    [Object.assign(new Error('C:\\private\\prompt'), { code: 'EACCES', syscall: 'open', path: 'C:\\private' }), { reasonClass: 'system_error', systemCode: 'EACCES', syscall: 'open' }],
    [{ name: 'private_class', code: 'secret_token', syscall: 'prompt', message: 'database contents' }, { reasonClass: 'unexpected_error' }],
    [null, { reasonClass: 'unexpected_error' }],
    [{ code: 'invalid_manual_deadline', httpStatus: 422, response: { data: 'private' } }, { reasonClass: 'application_error', reasonCode: 'invalid_manual_deadline', httpStatus: 422 }],
    [{ code: 'gateway_clock_uncertain', message: 'private' }, { reasonClass: 'application_error', reasonCode: 'gateway_clock_uncertain' }],
  ])('includes only allowlisted classes/codes/syscalls', (error, expected) => {
    expect(errorDiagnostic(error, 'Control.upsert')).toEqual({ operation: 'Control.upsert', ...expected });
  });
  test('retains innermost code-owned operation and original error for retry', async () => {
    const error = new TypeError('private');
    await expect(operation('initialize', () => operation('Job.create_collection', () => { throw error; }))).rejects.toBe(error);
    expect(errorDiagnostic(error, 'tick')).toEqual({ operation: 'Job.create_collection', reasonClass: 'type_error' });
  });
  test.each([422, undefined])('Gateway carries real HTTP status separately from transport fallback (%s)', async status => {
    const raw = Object.assign(new Error('private URI/token/prompt'), { response: status ? { status, data: { detail: { code: 'invalid_manual_deadline', private: 'payload' } } } : undefined });
    const gateway = new Gateway({ http: { request: jest.fn().mockRejectedValue(raw) }, getConfig: () => ({ origin: 'http://gateway.test', client: 'test', token: 'x'.repeat(40) }) });
    try { await operation('gateway.run_admission', () => gateway.putRun('synthetic', {})); throw new Error('expected failure'); }
    catch (error) {
      expect(error.gatewayResponse).toBe(!!status);
      const diagnostic = errorDiagnostic(error, 'tick');
      expect(diagnostic).toMatchObject({ operation: 'gateway.run_admission', reasonCode: status ? 'invalid_manual_deadline' : 'gateway_unreachable' });
      if (status) expect(diagnostic.httpStatus).toBe(status); else expect(diagnostic).not.toHaveProperty('httpStatus');
      expect(JSON.stringify(diagnostic)).not.toMatch(/URI|token|prompt|payload/);
    }
  });
});
