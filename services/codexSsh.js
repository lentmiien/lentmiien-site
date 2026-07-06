function quotePosixShellArg(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function normalizeConnection(connection = {}) {
  return connection && typeof connection === 'object' ? connection : {};
}

function getSshDestination(connectionInput = {}) {
  const connection = normalizeConnection(connectionInput);
  const destination = String(connection.destination || '').trim();
  if (destination) {
    return destination;
  }

  const host = String(connection.host || '').trim();
  if (!host) {
    throw new Error('Remote SSH target requires a host or destination.');
  }

  const user = String(connection.user || '').trim();
  return user ? `${user}@${host}` : host;
}

function getSshBinary(connectionInput = {}) {
  const connection = normalizeConnection(connectionInput);
  return String(connection.sshBinaryPath || connection.sshBinary || process.env.CODEX_SSH_BINARY_PATH || 'ssh').trim() || 'ssh';
}

function getRemoteCodexBinary(connectionInput = {}) {
  const connection = normalizeConnection(connectionInput);
  return String(connection.codexBinaryPath || connection.codexBinary || 'codex').trim() || 'codex';
}

function getRemoteCodexInvocation(connectionInput = {}) {
  const connection = normalizeConnection(connectionInput);
  if (Array.isArray(connection.codexCommand) && connection.codexCommand.length) {
    return connection.codexCommand.map((entry) => String(entry)).filter(Boolean);
  }

  const envWrapperPath = String(connection.envWrapperPath || connection.envWrapper || '').trim();
  if (envWrapperPath) {
    return [envWrapperPath, getRemoteCodexBinary(connection)];
  }

  return [getRemoteCodexBinary(connection)];
}

function getRemoteTempDir(connectionInput = {}) {
  const connection = normalizeConnection(connectionInput);
  const tempDir = String(connection.tempDir || '/tmp').trim();
  return tempDir || '/tmp';
}

function getRemoteShell(connectionInput = {}) {
  const connection = normalizeConnection(connectionInput);
  const shell = String(connection.shell || '/bin/sh').trim();
  return shell || '/bin/sh';
}

function getSshOptions(connectionInput = {}) {
  const connection = normalizeConnection(connectionInput);
  const options = ['-T'];

  if (connection.port) {
    options.push('-p', String(connection.port));
  }

  if (Array.isArray(connection.options)) {
    connection.options.forEach((option) => {
      if (option !== undefined && option !== null && String(option).trim()) {
        options.push(String(option));
      }
    });
  }

  return options;
}

function buildRemoteShellCommand(script, connectionInput = {}) {
  return `${quotePosixShellArg(getRemoteShell(connectionInput))} -lc ${quotePosixShellArg(script)}`;
}

function buildSshArgs(connectionInput = {}, remoteCommand) {
  const connection = normalizeConnection(connectionInput);
  return [
    ...getSshOptions(connection),
    getSshDestination(connection),
    remoteCommand,
  ];
}

module.exports = {
  buildRemoteShellCommand,
  buildSshArgs,
  getRemoteCodexBinary,
  getRemoteCodexInvocation,
  getRemoteTempDir,
  getSshBinary,
  getSshDestination,
  quotePosixShellArg,
};
