const Model = require('../../models/ai_model_card');
const { parseModelCardInput } = require('../../services/aiModelCardManagementService');

const storedCard = {
  _id: '0123456789abcdef01234567',
  model_name: 'Example', provider: 'OpenAI', api_model: 'example',
  input_1m_token_cost: 0, output_1m_token_cost: 0,
  model_type: 'chat', in_modalities: ['text'], out_modalities: ['text'],
  max_tokens: 1024, max_out_tokens: 512, added_date: new Date(),
  batch_use: false, context_type: 'system',
};

test('legacy documents and new cards do not acquire a thinking default', async () => {
  for (const model of [new Model(storedCard), Model.hydrate(storedCard)]) {
    expect(model.is_thinking).toBeUndefined();
    expect(model.toObject()).not.toHaveProperty('is_thinking');
    await expect(model.validate()).resolves.toBeUndefined();
  }
});

test.each([true, false])('persists explicit %p for any provider and model type', async (flag) => {
  const model = new Model({ ...storedCard, provider: 'Local', model_type: 'image', is_thinking: flag });
  await expect(model.validate()).resolves.toBeUndefined();
  expect(model.toObject().is_thinking).toBe(flag);
});

test('returning to legacy detection generates a database unset for a saved override', () => {
  const model = Model.hydrate({ ...storedCard, is_thinking: false });
  Object.assign(model, parseModelCardInput({ ...storedCard, is_thinking: '' }));
  expect(model.is_thinking).toBeUndefined();
  expect(model.$getChanges().$unset).toEqual(expect.objectContaining({ is_thinking: 1 }));
});
