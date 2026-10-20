const { DEFAULT_SECRET_NAME, RunpodSecretBootstrapError, ensureRunpodSecret, requiredSecretName } = require('../../scripts/bootstrap-runpod-cloudflare-secret');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const secret = { id: 'secret-1', name: DEFAULT_SECRET_NAME };
const ensure = (fetchImpl, options = {}) => ensureRunpodSecret({ apiKey: 'runpod-key', value: 'cloudflare-token', fetchImpl, ...options });

describe('Runpod REST v2 secret bootstrap', () => {
  test('uses the fixed origin and an exact-name metadata read, without overwriting', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ secrets: [secret] }));
    await expect(ensure(fetchImpl)).resolves.toEqual({ ...secret, created: false, exists: true });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`https://api.runpod.io/v2/account/secrets?name=${DEFAULT_SECRET_NAME}`);
    expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(options.body).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test('creates a missing name once and returns only metadata', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json({ secrets: [] })).mockResolvedValueOnce(json({ ...secret, value: 'must-not-return' }, 201));
    await expect(ensure(fetchImpl)).resolves.toEqual({ ...secret, created: true, exists: true });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({ name: DEFAULT_SECRET_NAME, value: 'cloudflare-token' });
    expect(fetchImpl.mock.calls[1][1].method).toBe('POST');
  });
  test('check mode needs no value and never creates', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(json({ secrets: [] }));
    await expect(ensure(fetchImpl, { value: '', checkOnly: true })).resolves.toMatchObject({ exists: false, created: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test.each([{}, { secrets: null }, { secrets: [{}] }, { secrets: [secret], pagination: { hasNextPage: true, nextCursor: 'next' } }, { secrets: Array(501).fill(secret) }])('rejects malformed or truncated lists before a write', async (body) => {
    const fetchImpl = jest.fn().mockResolvedValue(json(body));
    await expect(ensure(fetchImpl)).rejects.toBeInstanceOf(RunpodSecretBootstrapError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test.each([409, 503, 'network'])('re-reads the exact name after %s without replaying the create', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json({ secrets: [] }));
    if (status === 'network') fetchImpl.mockRejectedValueOnce(new Error('cloudflare-token'));
    else fetchImpl.mockResolvedValueOnce(json({ detail: 'cloudflare-token' }, status));
    fetchImpl.mockResolvedValueOnce(json({ secrets: [secret] }));
    await expect(ensure(fetchImpl)).resolves.toEqual({ ...secret, exists: true, created: false });
    expect(fetchImpl.mock.calls.map(([, o]) => o.method)).toEqual(['GET', 'POST', 'GET']);
  });
  test('an unresolved create is reported honestly and never includes submitted secrets', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json({ secrets: [] }))
      .mockResolvedValueOnce(json({ detail: 'cloudflare-token' }, 503))
      .mockResolvedValueOnce(json({ secrets: [] }));
    const error = await ensure(fetchImpl).catch((e) => e);
    expect(error.code).toBe('RUNPOD_SECRET_OUTCOME_UNKNOWN');
    expect(JSON.stringify(error)).not.toContain('cloudflare-token');
    expect(fetchImpl.mock.calls.filter(([, o]) => o.method === 'POST')).toHaveLength(1);
  });
  test('suppresses all provider error content, including echoes in code/title/detail', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(json({ secrets: [] }))
      .mockResolvedValueOnce(json({ code: 'cloudflare-token', title: 'cloudflare-token', detail: 'cloudflare-token' }, 422));
    const error = await ensure(fetchImpl).catch((e) => e);
    expect(error.code).toBe('RUNPOD_SECRET_PROVIDER_ERROR');
    expect(`${error.stack} ${JSON.stringify(error)}`).not.toContain('cloudflare-token');
  });
  test('cancels an oversized streamed list instead of buffering it', async () => {
    const cancel = jest.fn();
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65537)); }, cancel });
    const fetchImpl = jest.fn().mockResolvedValue(new Response(body));
    await expect(ensure(fetchImpl)).rejects.toMatchObject({ code: 'RUNPOD_SECRET_RESPONSE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  test('rejects invalid configuration without network work', async () => {
    const fetchImpl = jest.fn();
    expect(() => requiredSecretName('../bad')).toThrow(RunpodSecretBootstrapError);
    await expect(ensure(fetchImpl, { value: '' })).rejects.toMatchObject({ code: 'RUNPOD_TUNNEL_TOKEN_NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
