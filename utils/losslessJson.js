// Node 24's reviver source is the original numeric token, before IEEE-754 rounding.
// Apply to the entire envelope, including nested arrays/config.seeds.
function parseLosslessJson(text) {
  if (typeof text !== 'string') throw new TypeError('Expected raw JSON text');
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (!context?.source || !/^-?\d+$/.test(context.source)) throw new TypeError('Unsafe non-integer JSON number');
      return context.source;
    }
    return value;
  });
}
module.exports = { parseLosslessJson };
