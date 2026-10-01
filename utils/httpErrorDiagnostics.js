const path = require('path');
const { redactSecretPublicPath } = require('./secretPublicRoute');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function sourceLocation(filename, line, column) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) return null;
  const relative = path.relative(PROJECT_ROOT, filename).replace(/\\/g, '/');
  if (!/^(?:(?:controllers|middleware|routes|services|utils|views|models)\/[A-Za-z0-9_./-]+|app)\.(?:js|pug)$/.test(relative)
    || relative.split('/').includes('..')) return null;
  return { file: relative, line: Number(line) || null, column: Number(column) || null };
}

function httpErrorDiagnostics(error, req) {
  // Use the registered route pattern. URL paths, mounted parameter values and
  // query strings can contain private content or bearer secrets.
  const route = typeof req.route?.path === 'string'
    ? redactSecretPublicPath(req.route.path).slice(0, 200)
    : null;
  let location = null;
  if (typeof error?.path === 'string' && error.path.endsWith('.pug')) {
    const firstLine = String(error.message || '').split('\n', 1)[0];
    const suffix = firstLine.startsWith(`${error.path}:`) ? firstLine.slice(error.path.length + 1) : '';
    location = sourceLocation(error.path, /^\d+$/.test(suffix) ? suffix : null);
  }
  if (!location) {
    for (const frame of String(error?.stack || '').slice(0, 8192).split('\n').slice(1, 30)) {
      const match = frame.match(/^\s+at (?:.* \()?([^()]+):(\d+):(\d+)\)?$/);
      if (match) location = sourceLocation(match[1], match[2], match[3]);
      if (location) break;
    }
  }
  return { route, location };
}

module.exports = { httpErrorDiagnostics };
