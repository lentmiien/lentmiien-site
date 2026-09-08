jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
const axios = require('axios');
beforeEach(() => jest.resetModules());
test('gateway coalesces simultaneous expansion, caches 30s and returns only safe compact fields', async () => {
  const client = require('axios');
  client.get.mockResolvedValue({ data: { now: { gpu_busy_percent: 20, temp_c: 50 }, active: true, containers: [], token: 'private' } });
  const { getStatus } = require('../../services/accountGatewayStatus');
  const [a, b] = await Promise.all([getStatus(), getStatus()]);
  expect(client.get).toHaveBeenCalledTimes(3); expect(a).toEqual(b);
  await getStatus(); expect(client.get).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(a)).not.toContain('private');
  const paths = client.get.mock.calls.map(c => new URL(c[0]).pathname);
  expect(paths).toEqual(['/gpu', '/gpu/reservation', '/containers']);
  for (const [, options] of client.get.mock.calls) expect(options).toMatchObject({ timeout: 4000, maxRedirects: 0, maxContentLength: 262144 });
});
test('partial failures are visibly stale and never expose provider payloads', async () => {
  const client = require('axios'); client.get.mockRejectedValue(new Error('private URL'));
  const result = await require('../../services/accountGatewayStatus').getStatus();
  expect(result.state).toBe('stale'); expect(JSON.stringify(result)).not.toContain('private URL');
});
