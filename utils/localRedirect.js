const LOCAL_REDIRECT_BASE = 'https://local-redirect.invalid';

function resolveLocalRedirect(rawValue, fallback = '/') {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value
    || !value.startsWith('/')
    || value.startsWith('//')
    || /[\\\u0000-\u001f\u007f]/.test(value)
    || /%(?:00|0a|0d|2f|5c)/i.test(value)) {
    return fallback;
  }

  try {
    const parsed = new URL(value, LOCAL_REDIRECT_BASE);
    if (parsed.origin !== LOCAL_REDIRECT_BASE) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    return fallback;
  }
}

module.exports = { resolveLocalRedirect };
