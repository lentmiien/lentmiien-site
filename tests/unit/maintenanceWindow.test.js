const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMaintenanceWindow } = require('../../utils/maintenanceWindow');
const { run } = require('../../scripts/maintenance');
let root, file, state;
const at = new Date('2026-10-20T00:00:00Z');
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-maintenance-'));
  file = path.join(root, 'operations/maintenance.json');
  state = createMaintenanceWindow(file);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
test('bounded maintenance persists across processes and expires without a running app or DB', () => {
  const result = state.start(60, 'deployment', at);
  expect(result).toMatchObject({ reason: 'deployment', startedAt: at.toISOString(), endsAt: '2026-10-20T01:00:00.000Z' });
  const restarted = createMaintenanceWindow(file);
  expect(restarted.active(new Date(+at + 1000))).toEqual(result);
  expect(restarted.active(new Date(+at - 1))).toBeNull();
  expect(restarted.active(new Date(+at + 3600000))).toBeNull();
  expect(() => restarted.start(1, 'host', at)).toThrow('already active');
  expect(restarted.end()).toEqual(result);
  expect(state.active(at)).toBeNull();
});
test.each([0, -1, 1441, 1.2, NaN, '60'])('rejects invalid duration %p without writing', value => {
  expect(() => state.start(value, 'host', at)).toThrow();
  expect(fs.existsSync(file)).toBe(false);
});
test('rejects arbitrary reason/payload and invalid, oversized or symlink state', () => {
  expect(() => state.start(1, 'secret-text', at)).toThrow();
  state.start(1, 'other', at);
  fs.writeFileSync(file, '{"endsAt":"9999-01-01"}');
  expect(() => state.active(at)).toThrow('alerts remain enabled');
  fs.writeFileSync(file, 'x'.repeat(3000));
  expect(() => state.active(at)).toThrow();
  fs.unlinkSync(file); fs.writeFileSync(path.join(root, 'foreign'), '{}');
  fs.symlinkSync(path.join(root, 'foreign'), file);
  expect(() => state.active(at)).toThrow();
});
test('CLI starts, reports and ends the same durable flag, with an audit entry', async () => {
  const log = { notice: jest.fn() };
  const started = await run(['start', '5', 'database'], { state, log });
  expect((await run(['status'], { state, log })).active).toEqual(started);
  expect(await run(['end'], { state, log })).toEqual({ active: false });
  expect(log.notice).toHaveBeenCalledTimes(2);
  await expect(run(['start', '5junk'], { state, log })).rejects.toThrow('Usage');
  expect(state.active()).toBeNull();
});
