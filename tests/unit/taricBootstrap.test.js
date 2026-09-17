const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { main, readPrivateFile } = require('../../scripts/taric-tool');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn(), notice: jest.fn() }));
let directory;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taric-bootstrap-')); });
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });
test('dry-run CSV validation never connects or exposes source rows', async () => {
  const file = path.join(directory, 'synthetic.csv');
  fs.writeFileSync(file, 'descriptive_name,full_item_name,specs,hs_code,taric_code\nSynthetic,Synthetic fixture,,9503.00,0000000001\n');
  const connect = jest.spyOn(mongoose, 'connect').mockRejectedValue(new Error('Must not connect'));
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await main(['--file', file, '--version', '0']);
  const report = JSON.parse(stdout.mock.calls[0][0]);
  expect(report).toMatchObject({ dryRun: true, import: { accepted: 1, rows: 1, distinctCodes: 1 } });
  expect(JSON.stringify(report)).not.toContain('Synthetic fixture');
  expect(connect).not.toHaveBeenCalled();
});
test('portable private reader rejects symlinks, directories and oversized files', () => {
  const file = path.join(directory, 'source'); const link = path.join(directory, 'link');
  fs.writeFileSync(file, 'bounded'); fs.symlinkSync(file, link);
  expect(readPrivateFile(file, 7).toString()).toBe('bounded');
  expect(() => readPrivateFile(file, 6)).toThrow('Invalid private file');
  expect(() => readPrivateFile(link, 100)).toThrow('Invalid private file');
  expect(() => readPrivateFile(directory, 100)).toThrow('Invalid private file');
});
test.each([['--owner'], ['--file', '--execute'], ['--owner', 'bad/owner', '--execute', '--allow-database-write']])('invalid CLI arguments %j fail before database use', async args => {
  const connect = jest.spyOn(mongoose, 'connect').mockRejectedValue(new Error('Must not connect'));
  await expect(main(args)).rejects.toThrow(); expect(connect).not.toHaveBeenCalled();
});
