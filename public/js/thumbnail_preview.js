/* Shared still-image previews: errors never request the full-size original. */
(() => {
  'use strict';
  const allowed = /^\/(?:gpt-image\/api\/images\/[a-f\d]{24}|image_gen\/api\/bulk\/jobs\/[a-f\d]{24}\/prompts\/[a-f\d]{24})\/thumbnail$/i;
  function placeholder(className = '') {
    const element = document.createElement('span');
    element.className = `${className} thumbnail-unavailable`;
    element.textContent = 'Preview unavailable';
    return element;
  }
  function watch(image) {
    const fail = () => image.replaceWith(placeholder(image.className));
    image.addEventListener('error', fail, { once: true });
    if (image.complete && !image.naturalWidth) fail();
    return image;
  }
  function create(url, alt, className = '') {
    if (typeof url !== 'string' || !allowed.test(url)) return placeholder(className);
    const image = document.createElement('img');
    image.alt = alt || 'Image preview';
    image.className = className;
    image.loading = 'lazy';
    // Install before setting src; the caller appends the image synchronously.
    image.addEventListener('error', () => image.replaceWith(placeholder(className)), { once: true });
    image.src = url;
    return image;
  }
  function link(element, original) {
    if (typeof original !== 'string' || !original.trim()) return element;
    try {
      const url = new URL(original, window.location.origin);
      if (!['http:', 'https:'].includes(url.protocol)) return element;
    } catch (_) { return element; }
    const anchor = document.createElement('a');
    anchor.className = 'thumbnail-original-link';
    anchor.href = original;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.setAttribute('aria-label', 'Open original image in a new tab');
    anchor.appendChild(element);
    return anchor;
  }
  window.ThumbnailPreview = { create, watch, link };
})();
