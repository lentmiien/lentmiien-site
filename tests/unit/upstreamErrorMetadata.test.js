const { upstreamErrorMetadata } = require('../../utils/upstreamErrorMetadata');

test('keeps only recognized network codes and validated status, including nested causes', () => {
  const error = Object.assign(new Error('private body'), { name: 'APIConnectionError',
    cause: { cause: { code: 'ENOTFOUND', hostname: 'private-host' } }, response: { status: 503, data: 'secret' } });
  expect(upstreamErrorMetadata(error)).toEqual({
    errorName: 'APIConnectionError', errorCode: 'ENOTFOUND', causeCode: 'ENOTFOUND', status: 503, phase: 'dns',
  });
});

test('bounds cyclic cause chains and rejects arbitrary code, name and status fields', () => {
  const error = { name: 'secret-name', code: 'secret-code', status: 'secret-status' };
  error.cause = error;
  expect(upstreamErrorMetadata(error)).toEqual({ errorName: 'Error', errorCode: null, causeCode: null, status: null, phase: 'request' });
  expect(upstreamErrorMetadata(null).status).toBeNull();
});
