const { EventEmitter } = require('events');
const { createDelivery } = require('../../services/localAi/privateDelivery');
const descriptor = { media_type: 'video/mp4', sha256: 'a'.repeat(64) };
function pair(range) {
  const req = Object.assign(new EventEmitter(), { method: 'GET', get: key => key === 'Range' ? range : undefined });
  const res = new EventEmitter();
  res.set = jest.fn(() => res); res.status = jest.fn(() => res);
  res.send = jest.fn(); res.end = jest.fn();
  return [req, res];
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
afterEach(() => jest.useRealTimers());
test('three overlapping previews wait and preserve partial video responses', async () => {
  const deliver = createDelivery(), a = pair(), b = pair(), c = pair('bytes=2-4');
  await deliver(...a, async () => Buffer.from('abcdef'), descriptor);
  await deliver(...b, async () => Buffer.from('abcdef'), descriptor);
  const load = jest.fn(async () => Buffer.from('abcdef'));
  const pending = deliver(...c, load, descriptor);
  expect(load).not.toHaveBeenCalled();
  a[1].emit('finish'); await pending;
  expect(c[1].status).toHaveBeenCalledWith(206);
  expect(c[1].send).toHaveBeenCalledWith(Buffer.from('cde'));
  expect(c[1].set).toHaveBeenCalledWith('Content-Range', 'bytes 2-4/6');
  b[1].emit('close'); c[1].emit('finish');
});
test('waiting disconnects do not read media; active disconnect retains slot until its read finishes', async () => {
  const deliver = createDelivery({ concurrency: 1 }), a = pair(), b = pair(), c = pair();
  let done;
  const first = deliver(...a, () => new Promise(resolve => { done = resolve; }), descriptor);
  const abandoned = jest.fn(), next = jest.fn(async () => Buffer.from('next'));
  const second = deliver(...b, abandoned, descriptor);
  const third = deliver(...c, next, descriptor);
  b[0].emit('aborted'); await second;
  a[1].emit('close'); await flush();
  expect(next).not.toHaveBeenCalled();
  done(Buffer.from('finished')); await Promise.all([first, third]);
  expect(abandoned).not.toHaveBeenCalled();
  expect(a[1].send).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
  c[1].emit('finish');
});
test('queue length and waiting time are bounded; failures release slots exactly once', async () => {
  jest.useFakeTimers();
  const deliver = createDelivery({ concurrency: 1, maxPending: 1, waitMs: 10 });
  const a = pair(), b = pair(), c = pair();
  await deliver(...a, async () => Buffer.from('a'), descriptor);
  const second = deliver(...b, jest.fn(), descriptor);
  const expiry = expect(second).rejects.toMatchObject({ code: 'private_media_delivery_busy' });
  await expect(deliver(...c, jest.fn(), descriptor)).rejects.toMatchObject({ status: 503 });
  await jest.advanceTimersByTimeAsync(10); await expiry;
  expect(b[1].set).toHaveBeenCalledWith('Retry-After', '2');
  a[1].emit('close'); a[1].emit('finish');
  await expect(deliver(...pair(), async () => { throw new Error('read failed'); }, descriptor)).rejects.toThrow('read failed');
  const invalidRange = pair('bytes=99-100');
  await expect(deliver(...invalidRange, async () => Buffer.from('abc'), descriptor)).rejects.toMatchObject({ status: 416 });
  const good = pair();
  await deliver(...good, async () => Buffer.from('ok'), descriptor);
  good[1].emit('finish');
});
