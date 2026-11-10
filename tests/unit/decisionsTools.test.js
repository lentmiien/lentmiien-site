jest.mock('../../services/toolExecutionPrincipalService', () => ({ resolveAuthorizedToolPrincipal: jest.fn() }));
jest.mock('../../services/decisionsService', () => ({ ...jest.requireActual('../../services/decisionsService'), service: { evaluate: jest.fn(), models: jest.fn() } }));
const seeds = require('../../services/data/decisionToolSeeds');
const handlers = require('../../services/toolHandlerRegistry');
const { resolveAuthorizedToolPrincipal } = require('../../services/toolExecutionPrincipalService');
const { service, DecisionsService } = require('../../services/decisionsService');

test('all five enabled seeds have registered handlers and typed schemas', () => {
  expect(seeds.map(seed => seed.name)).toEqual(['decision_models', 'decision_predicate', 'decision_choice', 'decision_score', 'decision_batch']);
  for (const seed of seeds) { expect(seed.enabled).toBe(true); expect(handlers[seed.handlerKey].execute).toEqual(expect.any(Function)); }
  expect(seeds[2].toolDefinition.parameters.properties.choices.items.properties.value.type).toEqual(['string', 'boolean']);
  expect(seeds[4].toolDefinition.parameters.properties.questions.items.anyOf).toHaveLength(3);
});
test.each(['models', 'predicate', 'choice', 'score', 'batch'])('denies %s without a fresh authorized principal', async type => {
  resolveAuthorizedToolPrincipal.mockRejectedValueOnce(new Error('Denied'));
  await expect(handlers[`decisions.${type}`].execute({}, {})).rejects.toThrow('Denied');
  expect(service.evaluate).not.toHaveBeenCalled(); expect(service.models).not.toHaveBeenCalled();
});
test.each(['predicate', 'choice', 'score'])('adapts %s question and uses resolved identity', async type => {
  resolveAuthorizedToolPrincipal.mockResolvedValueOnce({ _id: 'resolved-user' });
  const args = { model: 'd3-mini-q8', input: 'synthetic', instructions: 'Assess', image_data_url: 'inline', ...(type === 'choice' ? { choices: [{ value: true }, { value: 'true' }] } : type === 'score' ? { levels: [{ label: 'low' }, { label: 'high' }] } : {}) };
  await handlers[`decisions.${type}`].execute(args, { user: { _id: 'caller' } });
  const { model, input, image_data_url, ...question } = args;
  expect(service.evaluate).toHaveBeenCalledWith({ model, input, image_data_url, questions: [{ ...question, type }] }, 'resolved-user');
  expect(resolveAuthorizedToolPrincipal).toHaveBeenCalledWith(expect.anything(), 'ai_gateway.decisions.run', expect.objectContaining({ roleCapabilityBundles: { admin: ['ai_gateway.decisions.run'], family: [], user: [] } }));
});
test.each(['predicate', 'choice', 'score', 'batch'])('%s sends text-only evidence when the optional image is empty', async type => {
  resolveAuthorizedToolPrincipal.mockResolvedValueOnce({ _id: 'resolved-user' });
  const questionType = type === 'batch' ? 'predicate' : type;
  const question = { type: questionType, instructions: 'Assess the evidence.',
    ...(type === 'choice' ? { choices: [{ value: true }, { value: false }] }
      : type === 'score' ? { levels: [{ label: 'low' }, { label: 'high' }] } : {}) };
  const { type: ignoredType, ...fields } = question;
  const args = { model: 'd3-mini-q8', input: 'Synthetic evidence', image_data_url: '',
    ...(type === 'batch' ? { questions: [question] } : fields) };
  const result = { model: args.model, answers: [{ type: questionType }] };
  const client = { request: jest.fn().mockResolvedValue({ data: result }) };
  const realService = new DecisionsService({ client });
  service.evaluate.mockImplementationOnce((...parameters) => realService.evaluate(...parameters));
  await expect(handlers[`decisions.${type}`].execute(args, { user: { _id: 'caller' } })).resolves.toEqual(result);
  expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
    data: { model: args.model, input: args.input, questions: [question] },
  }));
});
