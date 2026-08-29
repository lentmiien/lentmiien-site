const path = require('path');

function getFirstPathSegment(requestUrl) {
  const rawUrl = String(requestUrl || '/');
  const rawPath = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)
    ? new URL(rawUrl).pathname
    : rawUrl.split('?')[0] || '/';
  const decodedPath = decodeURIComponent(rawPath);
  if (decodedPath.includes('\0')) {
    throw new URIError('URL path contains a null byte.');
  }

  const normalizedPath = path.posix.normalize(decodedPath.replace(/\\/g, '/'));
  return normalizedPath.split('/').find(Boolean) || '';
}

function targetsProtectedStaticDirectory(requestUrl, protectedDirectories) {
  const directories = protectedDirectories instanceof Set
    ? protectedDirectories
    : new Set(protectedDirectories || []);
  return directories.has(getFirstPathSegment(requestUrl));
}

module.exports = { getFirstPathSegment, targetsProtectedStaticDirectory };
