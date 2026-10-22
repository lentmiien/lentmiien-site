(function (root) {
  'use strict';

  const MEDIA_PREFIX = '/gpt-image/media/';
  const PRIVATE_NAME = /^gpt-image-private-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

  // Shared by server views and browser previews. Resolution grants no access:
  // private delivery still checks capabilities and registered library membership.
  function resolveImageReference(reference) {
    if (typeof reference !== 'string' || !reference || reference.length > 512 || reference.trim() !== reference) return null;
    let fileName = reference;
    if (reference.startsWith(MEDIA_PREFIX)) {
      fileName = reference.slice(MEDIA_PREFIX.length);
      if (!PRIVATE_NAME.test(fileName)) return null;
    } else if (reference.startsWith('/img/')) {
      try {
        fileName = decodeURIComponent(reference.slice(5));
      } catch (_) {
        return null;
      }
    }
    // Validate decoded public paths too; regex end anchors alone can accept a
    // trailing line break, and browsers normalize control characters in URLs.
    if (fileName.trim() !== fileName || /[\x00-\x1f\x7f]/.test(fileName)) return null;
    if (PRIVATE_NAME.test(fileName)) {
      return { fileName, url: `${MEDIA_PREFIX}${fileName}`, isPrivate: true };
    }
    // Reserve the private namespace even for malformed names; never fall back
    // to public storage. Public references must be a single raster filename.
    if (/^gpt-image-private-/i.test(fileName) || fileName.length > 240
      || fileName.includes('..') || !/^[\p{L}\p{N}_][\p{L}\p{N}_. ()-]*\.(?:png|jpe?g|webp|gif|avif|bmp|tiff?)$/iu.test(fileName)) return null;
    return { fileName, url: `/img/${encodeURIComponent(fileName)}`, isPrivate: false };
  }

  function resolveImageUrl(reference) {
    return resolveImageReference(reference)?.url || null;
  }

  const api = { MEDIA_PREFIX, PRIVATE_NAME, resolveImageReference, resolveImageUrl };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LibraryImages = api;
})(typeof window === 'object' ? window : globalThis);
