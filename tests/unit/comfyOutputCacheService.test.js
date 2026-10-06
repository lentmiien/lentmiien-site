const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { ComfyOutputCacheService } = require('../../services/comfyOutputCacheService');
let directory;
let fetchImage;
let cache;
const output = (subfolder = 'Qwen-Image-2.1') => ({ filename: 'edit-2ref_00002_.png', subfolder, type: 'output', node_id: '8' });
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comfy-cache-test-'));
  fetchImage = jest.fn(async file => ({ buffer: Buffer.from(`${file.type}:${file.subfolder}:${file.filename}`) }));
  cache = new ComfyOutputCacheService({ provider: 'https://gateway.example', directory, fetchImage });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

test.each([false, true, 'concurrent'])('same basename from different folders stays distinct: %s', async order => {
  const outputs = [output(), output('Qwen-Image-2.1-Uncensored')];
  if (order === true) outputs.reverse();
  // Even a legacy file next to the new cache cannot become a hit.
  await fs.writeFile(path.join(directory, outputs[0].filename), 'WRONG LEGACY BYTES');
  const records = order === 'concurrent'
    ? await Promise.all(outputs.map(file => cache.ensure('job', file, 0)))
    : [await cache.ensure('job', outputs[0], 0), await cache.ensure('job', outputs[1], 0)];
  expect(fetchImage).toHaveBeenCalledTimes(2);
  expect(records[0].url).not.toBe(records[1].url);
  for (let i = 0; i < records.length; i++) {
    expect(await fs.readFile(records[i].localPath, 'utf8')).toBe(`output:${outputs[i].subfolder}:${outputs[i].filename}`);
    expect(records[i]).toMatchObject(outputs[i]);
    await cache.ensure('job', outputs[i], 0);
  }
  expect(fetchImage).toHaveBeenCalledTimes(2);
});

test('job, instance, provider, type, node and output index each distinguish identity', async () => {
  const identities = [
    cache.record('job', output(), 0), cache.record('job2', output(), 0),
    cache.record('job', output(), 0, 'gpu2'), cache.record('job', output(), 1),
    cache.record('job', { ...output(), type: 'temp' }, 0),
    cache.record('job', { ...output(), node_id: '9' }, 0),
    new ComfyOutputCacheService({ provider: 'https://other.example', directory, fetchImage }).record('job', output(), 0),
  ];
  expect(new Set(identities.map(rec => rec.cache_key)).size).toBe(identities.length);
  const records = await Promise.all(['job1', 'job2'].flatMap(job => [null, 'gpu2'].map(instance => cache.ensure(job, output(), 0, instance))));
  expect(new Set(records.map(rec => rec.url)).size).toBe(4);
  expect(fetchImage).toHaveBeenCalledTimes(4);
});

test('concurrent identical fetches coalesce and survive restart without rewriting bytes', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => cache.ensure('job', output(), 0)));
  expect(fetchImage).toHaveBeenCalledTimes(1);
  expect(new Set(results.map(rec => rec.url)).size).toBe(1);
  cache = new ComfyOutputCacheService({ provider: 'https://gateway.example', directory, fetchImage });
  await cache.ensure('job', output(), 0);
  expect(fetchImage).toHaveBeenCalledTimes(1);
  expect((await fs.readdir(directory))).toHaveLength(1);
});

test('fetch failure never falls back to a legacy or other-folder file, and retries', async () => {
  await cache.ensure('job', output(), 0);
  await fs.writeFile(path.join(directory, output().filename), 'wrong');
  fetchImage.mockRejectedValueOnce(new Error('unavailable'));
  await expect(cache.ensure('job', output('other'), 0)).rejects.toThrow('unavailable');
  const rec = await cache.ensure('job', output('other'), 0);
  expect(await fs.readFile(rec.localPath, 'utf8')).toContain('other');
});

test.each([
  { filename: '../x.png' }, { filename: 'a\\x.png' }, { filename: '%2e%2e.png' },
  { filename: 'x.html' }, { filename: 'x.png\n' }, { filename: '/x.png' },
  { subfolder: '../other' }, { subfolder: '/absolute' }, { subfolder: 'a//b' },
  { subfolder: 'a/./b' }, { subfolder: 'a/%2e%2e' }, { subfolder: 'C:\\temp' },
  { subfolder: {} }, { type: 'unknown' }, { node_id: {} },
])('rejects invalid descriptor before any fetch: %j', async change => {
  await expect(cache.ensure('job', { ...output(), ...change }, 0)).rejects.toThrow('Invalid');
  expect(fetchImage).not.toHaveBeenCalled();
});

test('view URL cannot override the validated descriptor', async () => {
  await cache.ensure('job', { ...output(), gateway_view_url: 'https://evil.example/other.png' }, 0);
  expect(fetchImage).toHaveBeenCalledWith({ filename: output().filename, subfolder: output().subfolder, type: 'output' });
});

test('rejects symlink cache files and directory escapes', async () => {
  const victim = path.join(directory, 'victim.png');
  await fs.writeFile(victim, 'wrong');
  const rec = cache.record('job', output(), 0);
  await fs.symlink(victim, rec.localPath);
  await expect(cache.ensure('job', output(), 0)).rejects.toThrow('Invalid');
  const link = path.join(directory, 'link');
  await fs.symlink(directory, link);
  const escaped = new ComfyOutputCacheService({ provider: 'https://gateway.example', directory: link, fetchImage });
  await expect(escaped.ensure('job', output(), 0)).rejects.toThrow('Invalid');
  expect(fetchImage).not.toHaveBeenCalled();
});

test('legacy or tampered persisted identities are not verified', () => {
  const rec = cache.record('job', output(), 0);
  expect(cache.verifiedRecord('job', rec)).not.toBeNull();
  expect(cache.verifiedRecord('other-job', rec)).toBeNull();
  expect(cache.verifiedRecord('job', { ...rec, subfolder: 'different' })).toBeNull();
  expect(cache.verifiedRecord('job', { ...output(), cached_url: '/imgen/old.png' })).toBeNull();
});
