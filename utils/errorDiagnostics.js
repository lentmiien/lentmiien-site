// Deliberately omit messages, URLs, request bodies and arbitrary error properties.
function errorDiagnostics(error) {
  const codes = new Set();
  const seen = new Set();
  const queue = [error];
  for (let index = 0; index < queue.length && index < 8; index += 1) {
    const item = queue[index];
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (typeof item.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(item.code)) codes.add(item.code);
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 4));
  }
  const status = Number(error?.status || error?.statusCode || error?.response?.status);
  return { codes: [...codes], status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null };
}

module.exports = { errorDiagnostics };
