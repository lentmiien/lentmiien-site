const { spawnSync } = require('child_process');
const path = require('path');
const { SYSTEM, render, VERSIONS } = require('../../utils/taricProtocol');
const template = require('../../config/taric-training-template.json');

test('shared versioned training template preserves Site renderer and literal field substitutions', () => {
  expect(template.version).toBe(VERSIONS.renderer);
  expect(template.system).toBe(SYSTEM);
  expect(render({ descriptive_name: 'Synthetic {specs}', full_item_name: 'Synthetic 🧪', specs: 'line\n{hs_code}', hs_code: '001234' }))
    .toBe('Please give me a description and suitable TARIC code for the following item:\n\nCategory: Synthetic {specs}\n\n### Synthetic 🧪\n\nline\n{hs_code}\n\nOur HS code: 0012.34');
});
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' });
if (python.error?.code === 'ENOENT') console.warn('SKIP: TARIC offline converter integration requires Python 3.9+ on the test workstation.');
const pythonTest = python.error?.code === 'ENOENT' ? test.skip : test;
pythonTest('Python stdlib converter suite, including actual JS service-export to CLI artifacts', () => {
  const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests/python', '-p', 'test_taric_dataset_converter.py'], {
    cwd: path.join(__dirname, '../..'), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  expect({ status: result.status, error: result.error?.message, stderr: result.status ? result.stderr : undefined }).toEqual({ status: 0 });
}, 35000);
