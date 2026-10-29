const fs = require('fs');
const path = require('path');
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const { configuration, readServiceEnvironment, passiveGateway, validateStorageLocation, inspectBootLines, verifyBoot, run } = require('../../scripts/experimental-models-release-check');
const secret = 'synthetic-fixture-secret';
const valid = `MING_ADMIN_TOKEN=${secret}\nEXPERIMENTAL_MODELS_STORAGE_ROOT=C:/ProgramData/Lentmiien/ExperimentalModels\n`;
const target = 'a'.repeat(40);
const since = Date.parse('2026-10-30T01:00:00.000Z');
const bootLine = (overrides = {}) => JSON.stringify({ timestamp: new Date(since + 1000).toISOString(), level: 'notice', category: 'server',
  message: 'Server listening on port 3000', runtime: { revision: target, startedAt: new Date(since + 500).toISOString() }, ...overrides });

test('dotenv parses the existing private file without changing process.env or printing secrets', () => {
  const before = { ...process.env };
  const result = configuration(valid + 'PORT=3000\n');
  expect(result.port).toBe(3000);
  expect(result.gateway.origin).toBe('http://192.168.0.20:8080');
  expect(result.gateway.headers).toEqual({ 'X-Ming-Token': secret });
  expect(configuration(valid).port).toBe(8080);
  expect(process.env).toEqual(before);
});

test.each(['', 'relative', 'C:ProgramData/Lentmiien/ExperimentalModels', 'C:/Projects/lentmiien-site/public',
  'C:/ProgramData/Lentmiien/../ExperimentalModels', 'C:/ProgramData/Lentmiien/ExperimentalModels:stream',
  '//server/share/ExperimentalModels', 'C:/ProgramData/Lentmiien/ExperimentalModels.'])('rejects root %j', root => {
  expect(() => configuration(`MING_ADMIN_TOKEN=${secret}\nEXPERIMENTAL_MODELS_STORAGE_ROOT=${root}`)).toThrow();
});

test.each(['ftp://example.test', 'http://user:password@example.test', 'http://example.test/path',
  'http://example.test/a/..', 'http://example.test?token=x', 'http://example.test/#fragment'])('rejects non-origin %s', origin => {
  expect(() => configuration(valid + `AI_GATEWAY_BASE_URL="${origin}"`)).toThrow('invalid_private_configuration');
});

test.each(['0', '-1', '65536', '3e3', 'pipe-name', ' 3000 '])('rejects ambiguous health port %j', port => {
  expect(() => configuration(valid + `PORT="${port}"`)).toThrow('invalid_health_port');
});

const ordinary = {
  MING_ADMIN_TOKEN: secret, EXPERIMENTAL_MODELS_STORAGE_ROOT: 'C:/ProgramData/Lentmiien/ExperimentalModels',
  AI_GATEWAY_BASE_URL: 'http://gateway.example.test:8080', EXPERIMENTAL_MODELS_TIMEOUT_MS: '2100000',
  PORT: '3000', VUE_PATH: 'C:/Sites/fixture-日本語',
};
const explicit = Object.entries(ordinary).map(([key, value]) => `${key}="${value}"`).join('\n');
const controls = ['NODE_OPTIONS', ...['PATH', 'ENCODING', 'OVERRIDE', 'FAST', 'DEBUG', 'QUIET']
  .flatMap(option => [`DOTENV_${option}`, `DOTENV_CONFIG_${option}`])];
function contextConfiguration(context, file, values) {
  return configuration(file, context === 'operator' ? values : {}, {
    machine: context === 'machine' ? values : {}, winsw: context === 'winsw' ? values : {},
  });
}

test('observed matching WinSW PORT and operator PORT/VUE_PATH preserve the explicit Site configuration', () => {
  const before = { ...process.env };
  const result = configuration(explicit, { PORT: ordinary.PORT, VUE_PATH: ordinary.VUE_PATH }, { machine: {}, winsw: { PORT: ordinary.PORT } });
  expect(result).toEqual(configuration(explicit));
  expect(process.env).toEqual(before);
});

describe.each(['operator', 'machine', 'winsw'])('%s context', context => {
  const code = context === 'operator' ? 'operator' : 'service';
  test.each(Object.keys(ordinary))('allows explicit matching %s and rejects differing, empty or unconfigured values', key => {
    expect(contextConfiguration(context, explicit, { [key.toLowerCase()]: ordinary[key] })).toEqual(configuration(explicit));
    for (const value of ['different-private-value', '', null]) {
      expect(() => contextConfiguration(context, explicit, { [key]: value })).toThrow(`${code}_configuration_mismatch`);
    }
    const withoutKey = explicit.split('\n').filter(line => !line.startsWith(`${key}=`)).join('\n');
    expect(() => contextConfiguration(context, withoutKey, { [key]: ordinary[key] })).toThrow(`${code}_configuration_mismatch`);
    expect(() => contextConfiguration(context, withoutKey, { [key]: '' })).toThrow(`${code}_configuration_mismatch`);
  });
  test.each(controls)('rejects %s presence even empty or matching the file', key => {
    for (const value of ['', 'synthetic-control']) {
      expect(() => contextConfiguration(context, explicit + `\n${key}="${value}"`, { [key.toLowerCase()]: value })).toThrow(`${code}_loader_control`);
    }
  });
  test('absence permits existing defaults but inherited fallback-looking values require an explicit file entry', () => {
    expect(contextConfiguration(context, valid, {}).port).toBe(8080);
    for (const [key, value] of Object.entries({ PORT: '8080', AI_GATEWAY_BASE_URL: 'http://192.168.0.20:8080', EXPERIMENTAL_MODELS_TIMEOUT_MS: '2000000' })) {
      expect(() => contextConfiguration(context, valid, { [key]: value })).toThrow(`${code}_configuration_mismatch`);
    }
    expect(contextConfiguration(context, valid + 'VUE_PATH=""', { VUE_PATH: '' }).env.VUE_PATH).toBe('');
  });
});

test('matching WinSW cannot conceal a conflicting machine value and operator disagreement is separately identified', () => {
  expect(() => configuration(explicit, {}, { machine: { PORT: '9999' }, winsw: { PORT: ordinary.PORT } })).toThrow('service_configuration_mismatch');
  expect(() => configuration(explicit, { PORT: '9999' }, { machine: {}, winsw: { PORT: ordinary.PORT } })).toThrow('operator_configuration_mismatch');
  expect(configuration(explicit, ordinary, { machine: ordinary, winsw: ordinary })).toEqual(configuration(explicit));
});

test('service expansion is refused even for a textually matching value', () => {
  const file = explicit.replace(ordinary.VUE_PATH, 'C:/Sites/%PRIVATE_DIR%');
  for (const context of ['machine', 'winsw']) {
    expect(() => contextConfiguration(context, file, { VUE_PATH: 'C:/Sites/%PRIVATE_DIR%' })).toThrow('service_configuration_mismatch');
  }
});

test('matching values still undergo existing root, origin, secret and timeout validation', () => {
  for (const [key, value] of Object.entries({ MING_ADMIN_TOKEN: '', EXPERIMENTAL_MODELS_STORAGE_ROOT: 'C:/wrong',
    AI_GATEWAY_BASE_URL: 'http://gateway.example.test/path', EXPERIMENTAL_MODELS_TIMEOUT_MS: '1' })) {
    const file = explicit.split('\n').filter(line => !line.startsWith(`${key}=`)).concat(`${key}="${value}"`).join('\n');
    expect(() => configuration(file, { [key]: value }, { machine: {}, winsw: { [key]: value } })).toThrow();
  }
});

test('private comparisons emit no values or hashes, and errors carry only contextual codes', () => {
  const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    configuration(explicit, ordinary, { machine: {}, winsw: ordinary });
    for (const context of ['operator', 'machine', 'winsw']) {
      let error;
      try { contextConfiguration(context, explicit, { MING_ADMIN_TOKEN: 'different-private-token' }); } catch (caught) { error = caught; }
      const code = `${context === 'operator' ? 'operator' : 'service'}_configuration_mismatch`;
      expect(error.message).toBe(code);
      expect(JSON.stringify(error)).toBe(JSON.stringify({ code }));
      expect(error.stack).not.toContain(secret);
      expect(error.stack).not.toContain('different-private-token');
    }
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  } finally { stdout.mockRestore(); stderr.mockRestore(); }
});

test('private service pipe preserves Unicode, empty and absent entries without environment mutation', async () => {
  const before = { ...process.env };
  const service = { machine: {}, winsw: { ...ordinary, VUE_PATH: '' } };
  const encoded = Buffer.from(JSON.stringify(service), 'utf8').toString('base64');
  const { Readable } = require('stream');
  expect(await readServiceEnvironment(Readable.from([encoded.slice(0, 12), encoded.slice(12) + '\r\n']))).toEqual(service);
  expect(await readServiceEnvironment(Readable.from([Buffer.from(JSON.stringify({ machine: ordinary, winsw: {} })).toString('base64')]))).toEqual({ machine: ordinary, winsw: {} });
  expect(process.env).toEqual(before);
});

test.each(['not JSON', 'null', '{}', '{"machine":[],"winsw":{}}', '{"machine":{},"winsw":{},"extra":{}}'])('rejects malformed service pipe %s', async value => {
  await expect(readServiceEnvironment(require('stream').Readable.from([Buffer.from(value).toString('base64')]))).rejects.toMatchObject({ code: 'invalid_private_configuration' });
});

test('bounds private service pipe input', async () => {
  await expect(readServiceEnvironment(require('stream').Readable.from(['a'.repeat(1048577)]))).rejects.toMatchObject({ code: 'invalid_private_configuration' });
});

test('companion command privately checks the exact Site file and its prerequisite probes keep configured auth/direct routing', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const stdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  const inherited = process.env;
  const lstat = jest.spyOn(fs.promises, 'lstat').mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: Buffer.byteLength(explicit) });
  const readFile = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from(explicit));
  const request = jest.spyOn(require('axios'), 'request').mockImplementation(mockGateway());
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'stdin', { value: require('stream').Readable.from([
      Buffer.from(JSON.stringify({ machine: {}, winsw: { PORT: ordinary.PORT } })).toString('base64'),
    ]), configurable: true });
    process.env = { PORT: ordinary.PORT, VUE_PATH: ordinary.VUE_PATH, HTTP_PROXY: 'http://127.0.0.1:9' };
    expect(await run(['configuration'])).toEqual({ configurationMatched: true });
    expect(request).not.toHaveBeenCalled();
    expect(await run(['preflight', '--direct'])).toEqual({ authStatus: true, capability: true });
    expect(readFile.mock.calls.every(([file]) => file === path.resolve(__dirname, '../../.env'))).toBe(true);
    expect(lstat).toHaveBeenCalledWith(path.resolve(__dirname, '../../.env'));
    expect(request.mock.calls.map(([options]) => options.url)).toEqual([
      ordinary.AI_GATEWAY_BASE_URL + '/tts/ming/voices', ordinary.AI_GATEWAY_BASE_URL + '/tts/ming/capabilities',
    ]);
    for (const [options] of request.mock.calls) expect(options).toMatchObject({ proxy: false, headers: { 'X-Ming-Token': secret } });
    expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:9');
  } finally {
    process.env = inherited;
    Object.defineProperty(process, 'platform', platform);
    Object.defineProperty(process, 'stdin', stdin);
    lstat.mockRestore(); readFile.mockRestore(); request.mockRestore();
  }
});

test('requires the existing Ming secret and checks source timeout constraints', () => {
  expect(() => configuration(valid.replace(secret, ''))).toThrow('invalid_private_configuration');
  expect(() => configuration(valid + 'EXPERIMENTAL_MODELS_TIMEOUT_MS=1')).toThrow('invalid_private_configuration');
});

function mockGateway(version = 1) {
  return jest.fn().mockResolvedValueOnce({ status: 200, data: Buffer.from('{"voices":["private inventory"]}') })
    .mockResolvedValueOnce({ status: 200, data: Buffer.from(JSON.stringify({ ephemeral_reference: { version } })) });
}

test('only passive bounded GETs run; direct option stays request-local and receipt contains booleans', async () => {
  const request = mockGateway();
  const before = { ...process.env };
  const result = await passiveGateway(configuration(valid), { direct: true, request });
  expect(result).toEqual({ authStatus: true, capability: true });
  expect(request.mock.calls.map(([options]) => new URL(options.url).pathname)).toEqual(['/tts/ming/voices', '/tts/ming/capabilities']);
  for (const [options] of request.mock.calls) {
    expect(options).toMatchObject({ method: 'GET', proxy: false, maxRedirects: 0, timeout: 10000, maxContentLength: 65536, maxBodyLength: 0 });
    expect(options.headers).toEqual({ 'X-Ming-Token': secret });
    expect(options.url).not.toContain(secret);
  }
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain('inventory');
  expect(process.env).toEqual(before);
});

test('default proxy handling is not silently changed', async () => {
  const request = mockGateway();
  await passiveGateway(configuration(valid), { request });
  expect(request.mock.calls[0][0]).not.toHaveProperty('proxy');
});

test.each([301, 401, 403, 404, 500])('voices HTTP %i stops before capability and never emits provider data', async status => {
  const request = jest.fn().mockResolvedValue({ status, data: Buffer.from(secret) });
  await expect(passiveGateway(configuration(valid), { request })).rejects.toMatchObject({ code: 'ming_auth_failed', message: 'ming_auth_failed' });
  expect(request).toHaveBeenCalledTimes(1);
});

test.each([null, 0, 2, '1'])('requires exact ephemeral version 1: %j', async version => {
  await expect(passiveGateway(configuration(valid), { request: mockGateway(version) })).rejects.toMatchObject({ code: 'ming_capability_missing' });
});

test('transport failures do not expose Axios configuration or private response', async () => {
  const request = jest.fn().mockRejectedValue(Object.assign(new Error(secret), { config: { headers: { 'X-Ming-Token': secret } } }));
  await expect(passiveGateway(configuration(valid), { request })).rejects.toMatchObject({ code: 'passive_gateway_failed', message: 'passive_gateway_failed' });
});

test('storage validator uses canonical locations and performs no creation, sweep or data migration', async () => {
  const io = fs.promises;
  const temp = await io.mkdtemp(path.join(require('os').tmpdir(), 'lab-release-'));
  const root = path.join(temp, 'protected');
  await io.mkdir(root);
  try {
    expect(await validateStorageLocation({ root, env: {} })).toEqual({ storageValidated: true });
    await expect(validateStorageLocation({ root, env: { VUE_PATH: temp } })).rejects.toMatchObject({ code: 'unsafe_storage_location' });
    await expect(validateStorageLocation({ root: path.join(__dirname, '../../public'), env: {} })).rejects.toMatchObject({ code: 'unsafe_storage_location' });
    await io.symlink(root, path.join(temp, 'alias'));
    await expect(validateStorageLocation({ root: path.join(temp, 'alias'), env: {} })).rejects.toThrow();
    await expect(validateStorageLocation({ root: path.join(temp, 'absent'), env: {} })).rejects.toThrow();
    expect(await io.readdir(root)).toEqual([]);
    expect(await io.readdir(temp)).toEqual(['alias', 'protected']);
  } finally { await io.rm(temp, { recursive: true, force: true }); }
});

test('boot filtering requires new runtime, expected source and valid timestamp; errors fail closed', () => {
  expect(inspectBootLines('partial\n' + bootLine(), since, target)).toBe(true);
  expect(inspectBootLines(bootLine(), since, 'b'.repeat(40))).toBe(false);
  expect(inspectBootLines(bootLine({ timestamp: 'invalid' }), since, target)).toBe(false);
  expect(inspectBootLines(bootLine({ runtime: { revision: target, startedAt: new Date(since - 1).toISOString() } }), since, target)).toBe(false);
  expect(() => inspectBootLines(bootLine({ category: 'experimental_models', level: 'error', message: secret }), since, target)).toThrow('lab_boot_failed');
});

function clock() {
  let time = since;
  return { now: () => time, sleep: jest.fn(async ms => { time += ms; }) };
}
const ready = () => ({ status: 200, data: { status: 'ok', database: 'ready' } });

test('waits through startup and validates the configured local health shape without auth', async () => {
  const timer = clock();
  const request = jest.fn().mockResolvedValueOnce({ status: 503 }).mockResolvedValue(ready());
  const result = await verifyBoot(configuration(valid + 'PORT=3000'), since, target, { ...timer, request, logs: jest.fn().mockResolvedValue(true) });
  expect(result).toEqual({ healthy: true, bootLogObserved: true });
  expect(timer.now() - since).toBeGreaterThanOrEqual(15000);
  expect(request.mock.calls[0][0]).toMatchObject({ url: 'http://127.0.0.1:3000/apphealth', method: 'GET', proxy: false, timeout: 2000, maxRedirects: 0, maxContentLength: 4096 });
  expect(request.mock.calls[0][0]).not.toHaveProperty('headers');
});

test('unavailable boot logs stay explicitly unobserved, even with HTTP readiness', async () => {
  expect(await verifyBoot(configuration(valid), since, target, { ...clock(), request: jest.fn().mockResolvedValue(ready()), logs: jest.fn().mockResolvedValue(false) }))
    .toEqual({ healthy: true, bootLogObserved: false });
});

test('a slow restart still gets a full observation period after first health', async () => {
  const timer = clock();
  await timer.sleep(60000);
  await verifyBoot(configuration(valid), since, target, { ...timer, request: jest.fn().mockResolvedValue(ready()), logs: jest.fn().mockResolvedValue(true) });
  expect(timer.now() - since).toBeGreaterThanOrEqual(75000);
});

test.each([{ status: 200, data: { status: 'ok' } }, { status: 503 }, { status: 302 }])('unready or wrong health responses time out', async response => {
  const timer = clock();
  await expect(verifyBoot(configuration(valid), since, target, { ...timer, request: jest.fn().mockResolvedValue(response), logs: jest.fn().mockResolvedValue(true) }))
    .rejects.toMatchObject({ code: 'site_health_timeout' });
  expect(timer.now() - since).toBe(120000);
});

test('storage error during boot defeats a healthy database endpoint', async () => {
  await expect(verifyBoot(configuration(valid), since, target, { ...clock(), request: jest.fn().mockResolvedValue(ready()),
    logs: jest.fn(async () => inspectBootLines(bootLine({ category: 'experimental_models', level: 'error' }), since, target)) }))
    .rejects.toMatchObject({ code: 'lab_boot_failed' });
});

test('operator failure uses the shared production logger with only a bounded stage', async () => {
  await run(['failure', 'restart_site']);
  expect(require('../../utils/logger').error).toHaveBeenCalledWith(expect.any(String), {
    category: 'experimental_models_release', metadata: { stage: 'restart_site' },
  });
  await expect(run(['failure', secret + '\nprivate'])).rejects.toMatchObject({ code: 'invalid_arguments' });
});

// Source contracts are deliberately labeled: these are NOT PowerShell execution
// or real NTFS/LocalSystem qualification. No pwsh is installed in the source host.
const ps = fs.readFileSync(path.join(__dirname, '../../scripts/deploy-experimental-models.ps1'), 'utf8');
const acl = fs.readFileSync(path.join(__dirname, '../../scripts/assert-gpt-image-acl.ps1'), 'utf8');
test('PowerShell source excludes loader controls before Node, preserves presence and privately checks service precedence', () => {
  const check = ps.slice(ps.indexOf('function Assert-ServiceConfiguration'), ps.indexOf('function Invoke-NodeCheck'));
  expect(check.indexOf("throw 'service_loader_control'")).toBeLessThan(check.indexOf('$version = & $Node'));
  expect(check.indexOf("throw 'operator_loader_control'")).toBeLessThan(check.indexOf('$version = & $Node'));
  expect(check.indexOf("throw 'service_environment_override'")).toBeLessThan(check.indexOf('$version = & $Node'));
  expect(check).toContain("[Environment]::GetEnvironmentVariables('Machine').GetEnumerator()");
  expect(check).toContain("[Environment]::GetEnvironmentVariables('Process').GetEnumerator()");
  expect(check).toContain('$machine = @{}; $operator = @{}'); // PowerShell maps have case-insensitive keys.
  expect(check).toContain('if ($machine.Contains($key))');
  expect(check).toContain('$entries.Count -gt 1');
  expect(check).toContain("!$entries[0].HasAttribute('value')");
  expect(check).toContain('$serviceEnv.machine[$key]');
  expect(check).toContain('$serviceEnv.winsw[$key]');
  expect(check).toContain("Invoke-NodeCheck @('configuration') $inputBase64");
  expect(check).toContain('[Text.Encoding]::UTF8.GetBytes($inputJson)');
  expect(ps).toContain('$PrivateInput | & $Node');
  expect(ps).not.toMatch(/SetEnvironmentVariable|\$env:\w+\s*=|Set-Content|Out-File/);
  const companion = fs.readFileSync(path.join(__dirname, '../../scripts/experimental-models-release-check.js'), 'utf8');
  expect(companion).toContain('dotenv.parse(file)');
  expect(companion).not.toContain('dotenv.config(');
});

test('PowerShell source orders approval, atomic creation, validation, maintenance, restart and successful end', () => {
  const main = ps.slice(ps.indexOf("try {\n  if ($PSVersionTable"));
  const steps = ["Assert-Source", 'Assert-ServiceConfiguration', "Assert-Acl 'C:\\ProgramData' -AncestorOnly", 'Invoke-NodeCheck $checkArgs', 'Read-Host',
    '[ExperimentalModelsPrivateDirectory]::Create($Parent)', 'Assert-Dedicated $Parent', '[ExperimentalModelsPrivateDirectory]::Create($Root)',
    'Assert-Dedicated $Root', "Invoke-NodeCheck @('storage')", 'Write-Receipt', 'scripts/maintenance.js start 60 deployment',
    "Restart-Service -Name 'LennartWeb'", "WaitForStatus('Running', [TimeSpan]::FromSeconds(60))", "Invoke-NodeCheck @('boot'", 'scripts/maintenance.js end'];
  let index = -1;
  for (const step of steps) {
    const next = main.indexOf(step, index + 1);
    expect({ step, found: next > index }).toEqual({ step, found: true });
    index = next;
  }
  const failure = main.slice(main.lastIndexOf('} catch {'));
  expect(failure).not.toContain('scripts/maintenance.js end');
  expect(failure).toContain('Maintenance was NOT ended');
});

test('PowerShell source guards checkout, target ancestry, dependencies and existing folders', () => {
  for (const guard of ['--show-toplevel', '--show-current', 'head_mismatch', '--untracked-files=all', '--is-ancestor', 'origin/main',
    'package-lock.json', 'git_operation_in_progress', 'elevation_required', 'existing_dedicated_folder_inspect_do_not_rerun',
    'operator_loader_control', 'service_loader_control', 'service_environment_override', 'node_version_mismatch', 'ntfs_required', 'restart_timeout_or_failure']) expect(ps).toContain(guard);
  expect(ps).toContain("[ValidateSet('LennartWeb')]");
  expect(ps).toContain("[ValidatePattern('^[0-9a-f]{40}$')]");
  expect(ps).not.toMatch(/Set-Acl\s+-|icacls|Set-ExecutionPolicy|ExecutionPolicy',?\s*['"]?Bypass|git\s+(?:reset|clean|stash)|npm\s+(?:ci|install|start)/);
});

test('creation source uses protected SDDL in SECURITY_ATTRIBUTES and refuses existing directories without repair', () => {
  expect(ps).toContain('O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)');
  expect(ps).toContain('attributes.Length = Marshal.SizeOf(typeof(SecurityAttributes))');
  expect(ps).toContain('attributes.Descriptor = descriptor');
  expect(ps).toContain('if (!CreateDirectoryW(path, ref attributes)) throw');
  expect(ps).toContain('finally { LocalFree(descriptor); }');
  expect(ps).toContain('[System.IO.FileMode]::CreateNew');
  expect(ps).toContain('$rules.Count -ne 2');
  expect(ps).toContain('!$acl.AreAccessRulesProtected');
  expect(ps).not.toMatch(/SetAccessControl|SetNamedSecurityInfo|AdjustTokenPrivileges|Remove-Item|Directory\.Delete/);
});

test('shared ACL checker retains strict roots and enables only explicit ancestor inspection', () => {
  expect(acl).toContain('[switch]$AncestorOnly');
  expect(acl).toContain('$isRoot = !$AncestorOnly');
  expect(acl).toContain("if ($isRoot -or ([int]$rule.FileSystemRights -band $dangerous))");
  expect(acl).toContain("if (!$isRoot -and ($rule.PropagationFlags -band");
  expect(acl).toContain('64 -bor 65536 -bor 262144 -bor 524288 -bor 268435456');
  expect(acl).not.toContain('ServiceIdentity');
});
