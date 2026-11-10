const { MODELS } = require('../decisionsService');

const questionProperties = {
  name: { type: 'string', description: 'Optional unique question name.' },
  instructions: { type: 'string', minLength: 1, maxLength: 2000 },
};
const choices = {
  type: 'array', minItems: 2, maxItems: 255,
  items: { type: 'object', additionalProperties: false, properties: {
    value: { type: ['string', 'boolean'], description: 'Unique typed value; true differs from "true".' },
    description: { type: 'string' },
  }, required: ['value'] },
};
const levels = {
  type: 'array', minItems: 2, maxItems: 10,
  items: { type: 'object', additionalProperties: false, properties: {
    label: { type: 'string', minLength: 1 }, description: { type: 'string' },
  }, required: ['label'] },
};
function questionSchema(type) {
  return { type: 'object', additionalProperties: false,
    properties: { type: { type: 'string', enum: [type] }, ...questionProperties,
      ...(type === 'choice' ? { choices } : type === 'score' ? { levels } : {}) },
    required: ['type', 'instructions', ...(type === 'choice' ? ['choices'] : type === 'score' ? ['levels'] : [])] };
}
const descriptions = {
  models: 'List AI Gateway decision models, credential availability and input limits without running inference.',
  predicate: 'Assess a yes/no question over shared evidence; returns probability from 0 to 1. The caller chooses a threshold.',
  choice: 'Choose one of 2–255 unique string or boolean values; returns choice, probabilities and confidence.',
  score: 'Score evidence on 2–10 ordered levels; returns the probability-weighted mean of zero-based level indices.',
  batch: 'Evaluate 1–32 predicate, choice or score questions against shared text and an optional image, preserving question order.',
};
module.exports = Object.entries(descriptions).map(([type, description]) => {
  const name = `decision_${type}`;
  const properties = type === 'models' ? {} : {
    model: { type: 'string', enum: MODELS },
    input: { type: 'string', maxLength: 6000, description: 'Shared evidence text. May be empty when supplying an image. All text and keys together must fit 6,000 UTF-8 bytes.' },
    image_data_url: { type: 'string', maxLength: 6990548, description: 'Optional single inline base64 PNG/JPEG/WebP, at most 5 MiB, 4 million pixels, 4,096 per edge. Omit or pass an empty string for no image. Remote URLs and animated images are rejected.' },
    ...(type === 'batch' ? { questions: { type: 'array', minItems: 1, maxItems: 32, items: { anyOf: ['predicate', 'choice', 'score'].map(questionSchema) } } }
      : { ...questionProperties, ...(type === 'choice' ? { choices } : type === 'score' ? { levels } : {}) }),
  };
  return {
    name, displayName: `AI Gateway Decisions: ${type[0].toUpperCase()}${type.slice(1)}`,
    description, enabled: true, handlerKey: `decisions.${type}`, sourcePath: 'services/decisionsToolService.js',
    tags: ['ai-gateway', 'decisions', type],
    toolDefinition: { type: 'function', name, description: `${description} Individual questions may return refusals. No automatic retries. Requires ai_gateway.decisions.run.`,
      parameters: { type: 'object', additionalProperties: false, properties,
        required: type === 'models' ? [] : ['model', 'input', ...(type === 'batch' ? ['questions'] : ['instructions']), ...(type === 'choice' ? ['choices'] : type === 'score' ? ['levels'] : [])] } },
    metadata: { capability: 'ai_gateway.decisions.run' },
  };
});
