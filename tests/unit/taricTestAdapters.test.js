const { testAdapterConfig, testAdmission } = require('../../services/taric/gate');
const { TEST_ADAPTER } = require('../../utils/taricProtocol');
const next = 'taric-v1.1-20261007';
const settings = { enabled: true, revision: 1, maxTokens: 256, testCatalog: { codes: ['0000000001'] } };

test('legacy settings retain the original adapter; explicit defaults change admission and fingerprint', () => {
  expect(testAdapterConfig(settings)).toEqual({ names: [TEST_ADAPTER], default: TEST_ADAPTER });
  const original = testAdmission(settings, 'code');
  const selected = testAdmission({ ...settings, testAdapters: { names: [TEST_ADAPTER, next], default: next } }, 'code');
  expect(selected).toMatchObject({ test: true, adapter: next, identity: null, run: null, benchmark: null });
  expect(selected.fingerprint).not.toBe(original.fingerprint);
  expect(testAdmission(settings, 'code').adapter).toBe(TEST_ADAPTER);
});

test.each([
  null, [], {}, { names: [], default: next }, { names: next, default: next },
  { names: [next, next], default: next }, { names: [next], default: TEST_ADAPTER },
  { names: [next], default: next, verified: true }, { names: [next] },
  ...['../adapter', '/absolute', 'https://host', '-adapter', 'space name', 'a\n', '<script>', 'a'.repeat(101), 1, null, {}]
    .map(name => ({ names: [name], default: name })),
  { names: Array.from({ length: 21 }, (_, n) => `adapter-${n}`), default: 'adapter-0' },
])('invalid test registry fails closed: %p', testAdapters => {
  expect(() => testAdapterConfig({ testAdapters }, 'INVALID_REQUEST')).toThrow('INVALID_REQUEST');
  expect(() => testAdmission({ ...settings, testAdapters }, 'code')).toThrow('CONFIG_NOT_READY');
});

test('maximum valid registry and adapter length are accepted', () => {
  const names = Array.from({ length: 19 }, (_, n) => `adapter-${n}`); names.push('a'.repeat(100));
  expect(testAdapterConfig({ testAdapters: { names, default: names[19] } }).names).toHaveLength(20);
});
