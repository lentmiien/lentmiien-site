function escapeInlineScriptText(value) {
  return String(value ?? '').replace(/[<>&\u2028\u2029]/g, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  }[character]));
}

function serializeForInlineScript(value) {
  const json = JSON.stringify(value);
  return escapeInlineScriptText(json === undefined ? 'null' : json);
}

module.exports = { escapeInlineScriptText, serializeForInlineScript };
