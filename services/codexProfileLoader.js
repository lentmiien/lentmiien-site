const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const TOML = require('@iarna/toml');

const {
  buildRemoteShellCommand,
  buildSshArgs,
  getRemoteCodexInvocation,
  getRemoteShell,
  getSshBinary,
  quotePosixShellArg,
} = require('./codexSsh');

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_PROFILE_BYTES = 1024 * 1024;
const DEFAULT_REMOTE_TIMEOUT_MS = 15000;

class CodexProfileLoadError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'CodexProfileLoadError';
    this.code = code;
  }
}

function normalizeProfileName(value) {
  const profileName = String(value || '').trim();
  if (!profileName || !/^[A-Za-z0-9_-]+$/.test(profileName)) {
    throw new CodexProfileLoadError(
      'The Codex profile name is invalid.',
      'CODEX_PROFILE_INVALID_NAME'
    );
  }
  return profileName;
}

function resolveCodexHome(codexHome) {
  const configuredHome = String(codexHome || process.env.CODEX_HOME || '').trim();
  return configuredHome
    ? path.resolve(configuredHome)
    : path.join(os.homedir(), '.codex');
}

function localProfilePath(profileName, codexHome) {
  return path.join(resolveCodexHome(codexHome), `${normalizeProfileName(profileName)}.config.toml`);
}

function normalizeParsedConfig(parsed, profileName) {
  let config;
  try {
    config = JSON.parse(JSON.stringify(parsed));
  } catch (error) {
    throw new CodexProfileLoadError(
      `Codex profile "${profileName}" contains values App Server cannot receive.`,
      'CODEX_PROFILE_INVALID',
      error
    );
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new CodexProfileLoadError(
      `Codex profile "${profileName}" must contain a TOML table.`,
      'CODEX_PROFILE_INVALID'
    );
  }
  return config;
}

function parseCodexProfile(source, profileName, maxProfileBytes = DEFAULT_MAX_PROFILE_BYTES) {
  const normalizedName = normalizeProfileName(profileName);
  const sourceBuffer = Buffer.isBuffer(source) ? source : Buffer.from(String(source || ''), 'utf8');
  if (sourceBuffer.length > maxProfileBytes) {
    throw new CodexProfileLoadError(
      `Codex profile "${normalizedName}" exceeds the allowed size.`,
      'CODEX_PROFILE_TOO_LARGE'
    );
  }
  try {
    return normalizeParsedConfig(TOML.parse(sourceBuffer.toString('utf8')), normalizedName);
  } catch (error) {
    if (error instanceof CodexProfileLoadError) {
      throw error;
    }
    throw new CodexProfileLoadError(
      `Codex profile "${normalizedName}" is not valid TOML.`,
      'CODEX_PROFILE_INVALID',
      error
    );
  }
}

function isRemoteTarget(target) {
  return target && target.type === 'remote-ssh-linux';
}

function buildRemoteProfileReadCommand(profileName, target) {
  const normalizedName = normalizeProfileName(profileName);
  const connection = target?.connection || {};
  const profileReadScript = [
    'set -eu',
    'codex_profile_home=${CODEX_HOME:-"$HOME/.codex"}',
    `codex_profile_file="$codex_profile_home/${normalizedName}.config.toml"`,
    '[ -f "$codex_profile_file" ] || exit 66',
    'cat -- "$codex_profile_file"',
  ].join('; ');
  const codexInvocation = getRemoteCodexInvocation(connection);
  const environmentPrefix = codexInvocation.length > 1 ? codexInvocation.slice(0, -1) : [];
  const readInvocation = [
    ...environmentPrefix,
    getRemoteShell(connection),
    '-lc',
    profileReadScript,
  ];
  const remoteCommand = buildRemoteShellCommand(
    `exec ${readInvocation.map(quotePosixShellArg).join(' ')}`,
    connection
  );
  return {
    binary: getSshBinary(connection),
    args: buildSshArgs(connection, remoteCommand),
  };
}

async function readLocalProfile(profileName, options = {}) {
  const normalizedName = normalizeProfileName(profileName);
  const profilePath = localProfilePath(normalizedName, options.codexHome);
  const statFile = options.statFile || fs.promises.stat;
  const readFile = options.readFile || fs.promises.readFile;
  let stats;
  try {
    stats = await statFile(profilePath);
  } catch (error) {
    throw new CodexProfileLoadError(
      `Codex profile "${normalizedName}" was not found on the execution target.`,
      error?.code === 'ENOENT' ? 'CODEX_PROFILE_NOT_FOUND' : 'CODEX_PROFILE_READ_FAILED',
      error
    );
  }
  if (!stats.isFile()) {
    throw new CodexProfileLoadError(
      `Codex profile "${normalizedName}" is not a regular file.`,
      'CODEX_PROFILE_READ_FAILED'
    );
  }
  if (stats.size > options.maxProfileBytes) {
    throw new CodexProfileLoadError(
      `Codex profile "${normalizedName}" exceeds the allowed size.`,
      'CODEX_PROFILE_TOO_LARGE'
    );
  }
  try {
    return await readFile(profilePath);
  } catch (error) {
    throw new CodexProfileLoadError(
      `Codex profile "${normalizedName}" could not be read on the execution target.`,
      'CODEX_PROFILE_READ_FAILED',
      error
    );
  }
}

async function readRemoteProfile(profileName, target, options = {}) {
  const normalizedName = normalizeProfileName(profileName);
  const command = buildRemoteProfileReadCommand(normalizedName, target);
  const executeFile = options.executeFile || execFileAsync;
  try {
    const result = await executeFile(command.binary, command.args, {
      timeout: options.remoteTimeoutMs,
      maxBuffer: options.maxProfileBytes + 1,
      windowsHide: true,
    });
    return Buffer.from(String(result.stdout || ''), 'utf8');
  } catch (error) {
    throw new CodexProfileLoadError(
      `Codex profile "${normalizedName}" could not be read on the remote execution target.`,
      'CODEX_PROFILE_READ_FAILED',
      error
    );
  }
}

async function loadCodexProfile(profileName, target, options = {}) {
  const maxProfileBytes = Number.isFinite(options.maxProfileBytes)
    ? Math.max(1024, options.maxProfileBytes)
    : DEFAULT_MAX_PROFILE_BYTES;
  const remoteTimeoutMs = Number.isFinite(options.remoteTimeoutMs)
    ? Math.max(1000, options.remoteTimeoutMs)
    : DEFAULT_REMOTE_TIMEOUT_MS;
  const readOptions = { ...options, maxProfileBytes, remoteTimeoutMs };
  const source = isRemoteTarget(target)
    ? await readRemoteProfile(profileName, target, readOptions)
    : await readLocalProfile(profileName, readOptions);
  return parseCodexProfile(source, profileName, maxProfileBytes);
}

module.exports = {
  CodexProfileLoadError,
  DEFAULT_MAX_PROFILE_BYTES,
  buildRemoteProfileReadCommand,
  loadCodexProfile,
  localProfilePath,
  parseCodexProfile,
};
