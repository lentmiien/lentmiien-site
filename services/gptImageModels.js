// Verified against official OpenAI Images documentation on 2026-09-10.
// Keep the original service/tool defaults independent from the Studio default.
const MODEL_NAME = 'gpt-image-2';
const STUDIO_MODEL_NAME = 'gpt-image-2.5-sunburst';
const MODEL_CONTRACTS = Object.freeze({
  'gpt-image-2': Object.freeze({
    label: 'GPT Image 2',
    qualities: ['auto', 'low', 'medium', 'high'],
    backgrounds: ['auto', 'opaque'], // Preserve the original options; transparency is preview.
  }),
  'gpt-image-2.5-sunburst': Object.freeze({
    label: 'GPT Image 2.5 Sunburst',
    qualities: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    backgrounds: ['auto', 'opaque', 'transparent'],
  }),
  'gpt-image-2.5-flare': Object.freeze({
    label: 'GPT Image 2.5 Flare',
    qualities: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    backgrounds: ['auto', 'opaque', 'transparent'],
  }),
});
function modelMetadata(model) {
  const resolved = model || MODEL_NAME;
  return { model: resolved, modelLabel: MODEL_CONTRACTS[resolved]?.label || resolved };
}
module.exports = { MODEL_NAME, STUDIO_MODEL_NAME, MODEL_CONTRACTS, modelMetadata };
