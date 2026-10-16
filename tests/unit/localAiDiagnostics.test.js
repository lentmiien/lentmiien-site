const { operation, errorDiagnostic } = require('../../services/localAi/diagnostics');
describe('Local AI sanitized operational diagnostics', () => {
  test.each([
    [Object.assign(new TypeError('mongodb://user:password@host/database'), { stack: 'private prompt' }), { reasonClass: 'type_error' }],
    [Object.assign(new Error('duplicate private contents'), { name: 'MongoServerError', code: 11000, keyValue: { secret: 'token' } }), { reasonClass: 'mongo_server_error', mongoCode: 11000 }],
    [Object.assign(new Error('C:\\private\\prompt'), { code: 'EACCES', syscall: 'open', path: 'C:\\private' }), { reasonClass: 'system_error', systemCode: 'EACCES', syscall: 'open' }],
    [{ name: 'private_class', code: 'secret_token', syscall: 'prompt', message: 'database contents' }, { reasonClass: 'unexpected_error' }],
    [null, { reasonClass: 'unexpected_error' }],
  ])('includes only allowlisted classes/codes/syscalls', (error, expected) => {
    expect(errorDiagnostic(error, 'Control.upsert')).toEqual({ operation: 'Control.upsert', ...expected });
  });
  test('retains innermost code-owned operation and original error for retry', async () => {
    const error = new TypeError('private');
    await expect(operation('initialize', () => operation('Job.create_collection', () => { throw error; }))).rejects.toBe(error);
    expect(errorDiagnostic(error, 'tick')).toEqual({ operation: 'Job.create_collection', reasonClass: 'type_error' });
  });
});
