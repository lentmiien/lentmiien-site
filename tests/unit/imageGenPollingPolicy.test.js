const fs = require('fs');
const path = require('path');
const vm = require('vm');

const clientSource = fs.readFileSync(
  path.join(process.cwd(), 'public', 'js', 'image_gen.js'),
  'utf8'
);

function createStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) values.set('imageGenActiveJobId', initialValue);
  return {
    getItem: jest.fn((key) => values.get(key) ?? null),
    setItem: jest.fn((key, value) => values.set(key, String(value))),
    removeItem: jest.fn((key) => values.delete(key)),
    value: (key) => values.get(key) ?? null,
  };
}

function runClient({ storedValue, jobStatus = 200, jobTtlMs = null } = {}) {
  const localStorage = createStorage(storedValue);
  const requests = [];
  const fetch = jest.fn(async (url) => {
    requests.push(url);
    if (url.includes('/api/jobs/')) {
      const payload = jobStatus === 404
        ? { error: 'job expired or not found', code: 'JOB_NOT_FOUND', terminal: true }
        : jobStatus >= 500
          ? { error: 'gateway unavailable' }
          : { job_id: 'job-1', status: 'running', files: [] };
      return new Response(JSON.stringify(payload), {
        status: jobStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0.5;
  const sandbox = {
    document: { querySelector: () => null },
    localStorage,
    fetch,
    FormData,
    URLSearchParams,
    Response,
    structuredClone,
    setTimeout,
    clearTimeout,
    Date,
    Math: deterministicMath,
  };

  const source = jobTtlMs === null
    ? clientSource
    : clientSource.replace(
      'const JOB_STORAGE_TTL_MS = 24 * 60 * 60 * 1000;',
      `const JOB_STORAGE_TTL_MS = ${jobTtlMs};`
    );
  vm.runInNewContext(source, sandbox, { filename: 'public/js/image_gen.js' });
  return { fetch, localStorage, requests };
}

describe('image generation polling policy', () => {
  test('discards legacy and expired stored job markers instead of resuming forever', () => {
    const legacy = runClient({ storedValue: 'legacy-job-id' });
    expect(legacy.localStorage.value('imageGenActiveJobId')).toBeNull();
    expect(legacy.requests.some((url) => url.includes('/api/jobs/'))).toBe(false);

    const expired = runClient({
      storedValue: JSON.stringify({ jobId: 'old-job', storedAt: Date.now() - (25 * 60 * 60 * 1000) }),
    });
    expect(expired.localStorage.value('imageGenActiveJobId')).toBeNull();
    expect(expired.requests.some((url) => url.includes('/api/jobs/'))).toBe(false);
  });

  test('treats a not-found response as terminal and clears the stored job', async () => {
    const state = runClient({
      storedValue: JSON.stringify({ jobId: 'job-1', storedAt: Date.now() }),
      jobStatus: 404,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(state.requests.filter((url) => url.includes('/api/jobs/'))).toHaveLength(1);
    expect(state.localStorage.value('imageGenActiveJobId')).toBeNull();
  });

  test('caps consecutive transient polling failures', async () => {
    jest.useFakeTimers();
    try {
      const state = runClient({
        storedValue: JSON.stringify({ jobId: 'job-1', storedAt: Date.now() }),
        jobStatus: 503,
      });
      await jest.runAllTimersAsync();

      expect(state.requests.filter((url) => url.includes('/api/jobs/'))).toHaveLength(8);
      expect(state.localStorage.value('imageGenActiveJobId')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('expires an actively pending poll instead of running forever', async () => {
    jest.useFakeTimers();
    try {
      const state = runClient({
        storedValue: JSON.stringify({ jobId: 'job-1', storedAt: Date.now() }),
        jobStatus: 200,
        jobTtlMs: 25,
      });
      await jest.runAllTimersAsync();

      expect(state.requests.filter((url) => url.includes('/api/jobs/'))).toHaveLength(1);
      expect(state.localStorage.value('imageGenActiveJobId')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
