// Private companion of deploy-experimental-models.ps1. No app/server import,
// database connection, inference, secret arguments, environment writes or installs.
const fs = require('fs/promises');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');
const { resolveStorageRoot } = require('../services/experimentalModels/storage');
const { compatible } = require('../services/experimentalModels/wevisInspection');
const { strictJson } = require('../utils/taricProtocol');
const { LabGateway } = require('../services/experimentalModels/gateway');
const { within, assertNoSymlinks } = require('../services/gptImageStorageService');
const ROOT = 'C:\\ProgramData\\Lentmiien\\ExperimentalModels';
const APP = path.resolve(__dirname, '..');
const MAX_LOG_BYTES = 262144;
const CODES = new Set(['invalid_private_configuration', 'operator_configuration_mismatch', 'service_configuration_mismatch',
  'operator_loader_control', 'service_loader_control', 'wrong_storage_root', 'invalid_health_port',
  'wevis_capability_missing', 'ming_auth_failed', 'ming_capability_missing', 'passive_gateway_failed', 'unsafe_storage_location',
  'storage_missing', 'site_health_timeout', 'lab_boot_failed', 'invalid_arguments', 'release_check_failed']);
function fail(code) { throw Object.assign(new Error(code), { code }); }

const CONFIG_KEYS = ['MING_ADMIN_TOKEN', 'EXPERIMENTAL_MODELS_STORAGE_ROOT', 'AI_GATEWAY_BASE_URL', 'EXPERIMENTAL_MODELS_TIMEOUT_MS', 'VUE_PATH', 'PORT'];
const CONTROL_KEYS = ['NODE_OPTIONS',
  ...['PATH', 'ENCODING', 'OVERRIDE', 'FAST', 'DEBUG', 'QUIET'].flatMap(option => [`DOTENV_${option}`, `DOTENV_CONFIG_${option}`])];
function assertEnvironment(env, inherited, context) {
  // Windows names are case-insensitive. Empty strings are present and suppress
  // dotenv; never equate them with absence or an application's fallback value.
  for (const [name, value] of Object.entries(inherited)) {
    const key = name.toUpperCase();
    if (CONTROL_KEYS.includes(key)) fail(`${context}_loader_control`);
    if (CONFIG_KEYS.includes(key) && (!Object.hasOwn(env, key) || typeof value !== 'string' || value !== env[key] ||
        context === 'service' && value.includes('%'))) fail(`${context}_configuration_mismatch`);
  }
}
function configuration(file, inherited = {}, service = { machine: {}, winsw: {} }) {
  const env = dotenv.parse(file);
  // Check both service layers, not just the winning WinSW value: every possible
  // inherited value must agree with the explicit file. Registry blocks are
  // refused by PowerShell. LocalSystem does not inherit the operator's User env.
  assertEnvironment(env, service.machine, 'service');
  assertEnvironment(env, service.winsw, 'service');
  assertEnvironment(env, inherited, 'operator');
  let root, gateway;
  try {
    root = resolveStorageRoot(env.EXPERIMENTAL_MODELS_STORAGE_ROOT, 'win32');
    gateway = new LabGateway({ env }).config('ming-tts');
  } catch (_) { fail('invalid_private_configuration'); }
  // Reject path components even when URL parsing would normalize them away.
  if (env.AI_GATEWAY_BASE_URL && !/^https?:\/\/[^/?#]+\/?$/i.test(env.AI_GATEWAY_BASE_URL)) fail('invalid_private_configuration');
  if (root.toLowerCase() !== ROOT.toLowerCase()) fail('wrong_storage_root');
  const portText = env.PORT || '8080'; // app.js's documented listener default.
  if (!/^[1-9]\d{0,4}$/.test(portText) || Number(portText) > 65535) fail('invalid_health_port');
  return { env, root, gateway, port: Number(portText) };
}
async function loadConfiguration(service) {
  const file = path.join(APP, '.env');
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) fail('invalid_private_configuration');
  return configuration(await fs.readFile(file), process.env, service);
}
async function readServiceEnvironment(input = process.stdin) {
  // PowerShell 5.1's native pipe uses an ASCII encoding by default. Base64 of
  // UTF-8 JSON preserves private Unicode values without arguments or temp files.
  let encoded = '';
  for await (const chunk of input) {
    encoded += chunk.toString('ascii');
    if (encoded.length > 1048576) fail('invalid_private_configuration');
  }
  let service;
  try { service = JSON.parse(Buffer.from(encoded.trim(), 'base64').toString('utf8')); } catch (_) { fail('invalid_private_configuration'); }
  if (!service || Object.keys(service).sort().join(',') !== 'machine,winsw' ||
      ['machine', 'winsw'].some(key => !service[key] || typeof service[key] !== 'object' || Array.isArray(service[key]))) fail('invalid_private_configuration');
  return service;
}
async function passiveGateway(config, { direct = false, request = axios.request } = {}) {
  // --direct is per-request only, matching the Site client; an inspecting proxy
  // such as HTTP_PROXY=http://127.0.0.1:9 is never rewritten or cleared globally.
  const options = { method: 'GET', headers: config.gateway.headers, timeout: 10000,
    maxContentLength: 65536, maxBodyLength: 0, maxRedirects: 0,
    responseType: 'arraybuffer', validateStatus: () => true, ...(direct ? { proxy: false } : {}) };
  let voices, capabilities;
  try {
    voices = await request({ ...options, url: config.gateway.origin + '/tts/ming/voices' });
    if (voices.status !== 200) fail('ming_auth_failed');
    // Deliberately discard the voice inventory; no names or contents are reported.
    capabilities = await request({ ...options, url: config.gateway.origin + '/tts/ming/capabilities' });
  } catch (error) {
    if (error.code === 'ming_auth_failed') throw error;
    fail('passive_gateway_failed');
  }
  let body;
  try { body = JSON.parse(Buffer.from(capabilities.data).toString('utf8')); } catch (_) { fail('ming_capability_missing'); }
  if (capabilities.status !== 200 || body?.ephemeral_reference?.version !== 1) fail('ming_capability_missing');
  return { authStatus: true, capability: true };
}
async function inspectWevisCapability(config, request = axios.request) {
  // Passive discovery only; no model load, inference or worker state change.
  try {
    const response = await request({ method: 'GET', url: config.gateway.origin + '/perception/wevisone-vl/capabilities',
      proxy: false, timeout: 10000, maxContentLength: 65536, maxBodyLength: 0, maxRedirects: 0,
      responseType: 'arraybuffer', validateStatus: () => true });
    const bytes = Buffer.from(response.data);
    if (response.status !== 200 || bytes.length > 65536
      || !compatible(strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).failure_inspection)) fail('wevis_capability_missing');
    return { failureInspectionCompatible: true };
  } catch (_) { fail('wevis_capability_missing'); }
}
async function validateStorageLocation(config, io = fs) {
  // Read-only counterpart of LabStore.checkRoot's location checks. The wrapper
  // runs the EXISTING native ACL validator first; mkdir/initialize/sweep would
  // be inappropriate in an operator validation process.
  const root = config.root;
  const paths = path;
  for (const mount of [paths.join(APP, 'public'), paths.join(APP, 'games'), paths.join(APP, 'node_modules'), config.env.VUE_PATH].filter(Boolean)) {
    const real = await io.realpath(mount).catch(error => { if (error.code === 'ENOENT') return paths.resolve(mount); throw error; });
    // Production runs on Windows; use the feature's actual confinement primitive.
    if ([paths.resolve(mount), real].some(value => within(value, root) || within(root, value))) fail('unsafe_storage_location');
  }
  await assertNoSymlinks(root);
  if (path.relative(root, await io.realpath(root))) fail('unsafe_storage_location');
  const stat = await io.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('storage_missing');
  return { storageValidated: true };
}
function inspectBootLines(text, since, target) {
  let observed = false;
  for (const line of text.split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; } // bounded tail may start mid-record
    if (entry.runtime?.revision !== target || !Number.isFinite(Date.parse(entry.runtime?.startedAt)) ||
        !Number.isFinite(Date.parse(entry.timestamp)) || Date.parse(entry.runtime.startedAt) < since || Date.parse(entry.timestamp) < since) continue;
    if (entry.category === 'experimental_models' && entry.level === 'error') fail('lab_boot_failed');
    if (entry.category === 'server' && entry.level === 'notice' && /^Server listening on port \d+$/.test(entry.message)) observed = true;
  }
  return observed;
}
async function readBootLogs(since, target, now = Date.now()) {
  let observed = false;
  const dates = new Set([new Date(since).toISOString().slice(0, 10), new Date(now).toISOString().slice(0, 10)]);
  for (const date of dates) {
    let handle;
    try {
      const file = path.join(APP, 'logs', `app-${date}.log`);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      handle = await fs.open(file, 'r');
      const bytes = Buffer.alloc(Math.min(stat.size, MAX_LOG_BYTES));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length));
      observed = inspectBootLines(bytes.subarray(0, bytesRead).toString('utf8'), since, target) || observed;
    } catch (error) {
      if (error.code === 'lab_boot_failed') throw error;
      // No log contents/errors are emitted. Missing/inaccessible logs are explicitly
      // reported as unobserved, never as proof of successful lab initialization.
    } finally { if (handle) await handle.close(); }
  }
  return observed;
}
async function verifyBoot(config, since, target, { request = axios.request, logs = readBootLogs,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + 120000;
  let bootLogObserved = false;
  let firstHealthyAt;
  while (now() < deadline) {
    bootLogObserved = await logs(since, target, now()) || bootLogObserved;
    let healthy = false;
    try {
      const response = await request({ method: 'GET', url: `http://127.0.0.1:${config.port}/apphealth`,
        proxy: false, timeout: 2000, maxContentLength: 4096, maxRedirects: 0, responseType: 'json', validateStatus: () => true });
      healthy = response.status === 200 && response.data?.status === 'ok' && response.data?.database === 'ready';
    } catch (_) { /* bounded retry; never render a response or Axios config */ }
    // Give the startup ACL subprocess (10s timeout) time to report a failure,
    // even if stopping/starting the wrapper consumed most of the restart wait.
    // Absence of errors remains only negative evidence; browser session creation
    // is the actual LocalSystem storage/UI integration test.
    if (!healthy) firstHealthyAt = undefined;
    else if (firstHealthyAt === undefined) firstHealthyAt = now();
    if (healthy && now() - firstHealthyAt >= 15000) {
      bootLogObserved = await logs(since, target, now()) || bootLogObserved;
      return { healthy: true, bootLogObserved };
    }
    await sleep(2000);
  }
  fail('site_health_timeout');
}
async function run(args) {
  const [command, ...rest] = args;
  if (command === 'failure' && rest.length === 1 && /^[a-z_]{1,64}$/.test(rest[0])) {
    await require('../utils/logger').error('Experimental Models operator release stopped; inspect the reported stage before resuming',
      { category: 'experimental_models_release', metadata: { stage: rest[0] } });
    return { logged: true };
  }
  if (process.platform !== 'win32') fail('invalid_arguments');
  if (command === 'configuration' && rest.length === 0) {
    await loadConfiguration(await readServiceEnvironment());
    return { configurationMatched: true };
  }
  if (command === 'preflight' && (rest.length === 0 || rest.length === 1 && rest[0] === '--direct')) {
    return passiveGateway(await loadConfiguration(), { direct: rest[0] === '--direct' });
  }
  if (command === 'inspection' && rest.length === 0) return inspectWevisCapability(await loadConfiguration());
  if (command === 'storage' && rest.length === 0) return validateStorageLocation(await loadConfiguration());
  if (command === 'boot' && rest.length === 2 && /^\d{4}-\d\d-\d\dT/.test(rest[0]) && /^[0-9a-f]{40}$/.test(rest[1])) {
    const since = Date.parse(rest[0]);
    if (!Number.isFinite(since) || since > Date.now() || Date.now() - since > 300000) fail('invalid_arguments');
    return verifyBoot(await loadConfiguration(), since, rest[1]);
  }
  fail('invalid_arguments');
}
if (require.main === module) {
  run(process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stdout.write(`${JSON.stringify({ ok: false, code: CODES.has(error.code) ? error.code : 'release_check_failed' })}\n`);
    process.exitCode = 1;
  });
}
module.exports = { inspectWevisCapability, configuration, readServiceEnvironment, passiveGateway, validateStorageLocation, inspectBootLines, verifyBoot, run };
