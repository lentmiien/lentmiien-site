// Public-beta eligibility: https://developers.openai.com/api/docs/guides/background
// Keep this allowlist narrow; unrelated variants must retain normal processing.
function normalizeCompletionWindow(value) {
  return value === '2h' || value === '8h' ? value : 'soonest';
}

function effectiveCompletionWindow(value, model) {
  const requested = normalizeCompletionWindow(value);
  const supported = model?.provider === 'OpenAI'
    && /^gpt-(?:6\.2-(?:astra|sol)|6\.1-terra|6-luna)(?:-\d{4}-\d{2}-\d{2})?$/.test(model.api_model);
  return supported ? requested : 'soonest';
}

module.exports = { normalizeCompletionWindow, effectiveCompletionWindow };
