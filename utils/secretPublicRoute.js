const SECRET_PUBLIC_ROUTES = [
  ['PUBLIC_TOBUY_LIST_PATH', '/secret-public/to-buy'],
  ['REQUEST_COUNTER_PATH', '/secret-public/request-counter'],
  ['DEVICE_USAGE_PATH', '/secret-public/device-usage'],
  ['MINUTE_LOGGER_PATH', '/secret-public/minute-logger'],
];

function normalizeConfiguredPath(value) {
  const path = String(value || '').trim().replace(/\/+$/, '');
  return path.startsWith('/') && path !== '/' ? path : null;
}

function redactSecretPublicPath(pathname, environment = process.env) {
  const requestPath = String(pathname || '/');
  for (const [environmentKey, label] of SECRET_PUBLIC_ROUTES) {
    const configuredPath = normalizeConfiguredPath(environment[environmentKey]);
    if (configuredPath
      && (requestPath === configuredPath || requestPath.startsWith(`${configuredPath}/`))) {
      return `${label}${requestPath.slice(configuredPath.length)}`;
    }
  }
  return requestPath;
}

module.exports = { redactSecretPublicPath };
