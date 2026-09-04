const toolSeeds = require('../../services/data/toolSeeds');
const toolHandlers = require('../../services/toolHandlerRegistry');

describe('Codex and Ask Lennart Tool Manager seeds', () => {
  const names = [
    'codex_ai_gateway_linux',
    'codex_lentmiien_site_linux',
    'codex_lentmiien_site_production',
    'ask_lennart_for_codex',
    'fetch_codex_request_options',
    'run_codex_in_workspace',
    'ask_lennart',
  ];

  test('registers all seven enabled tools with executable handlers', () => {
    const seeds = names.map((name) => toolSeeds.find((seed) => seed.name === name));

    seeds.forEach((seed, index) => {
      expect(seed).toBeDefined();
      expect(seed.name).toBe(names[index]);
      expect(seed.enabled).toBe(true);
      expect(seed.toolDefinition.name).toBe(seed.name);
      expect(seed.toolDefinition.parameters.additionalProperties).toBe(false);
      expect(toolHandlers[seed.handlerKey]?.execute).toEqual(expect.any(Function));
    });
  });

  test('pins important Codex tools to the requested workspaces and High OpenAI profile', () => {
    const gateway = toolSeeds.find((seed) => seed.name === 'codex_ai_gateway_linux');
    const development = toolSeeds.find((seed) => seed.name === 'codex_lentmiien_site_linux');
    const production = toolSeeds.find((seed) => seed.name === 'codex_lentmiien_site_production');

    expect(gateway.metadata).toMatchObject({
      workspaceId: '773f1818-2313-44b0-93e2-880693129439',
      modelProvider: 'openai',
      requestProfileId: 'high',
      permissionMode: 'yolo',
    });
    expect(development.metadata).toMatchObject({
      workspaceId: '3b73bde5-4b30-4731-a0e4-45c4180864f2',
      modelProvider: 'openai',
      requestProfileId: 'high',
      permissionMode: 'yolo',
    });
    expect(production.metadata).toMatchObject({
      workspaceId: '4ef51c48-3ecd-4ab1-ba3b-d8fe767f884b',
      modelProvider: 'openai',
      requestProfileId: 'high',
      permissionMode: 'read-only',
      productionMutationAllowed: false,
    });
    [gateway, development, production].forEach((seed) => {
      expect(seed.toolDefinition.parameters.required).toEqual(['prompt']);
      expect(Object.keys(seed.toolDefinition.parameters.properties)).toEqual(['prompt']);
    });
  });

  test('keeps general discovery paired with the validated any-workspace runner', () => {
    const fetch = toolSeeds.find((seed) => seed.name === 'fetch_codex_request_options');
    const run = toolSeeds.find((seed) => seed.name === 'run_codex_in_workspace');

    expect(fetch.metadata.pairWith).toBe(run.name);
    expect(run.metadata.optionsTool).toBe(fetch.name);
    expect(run.toolDefinition.description).toContain('must call fetch_codex_request_options');
    expect(run.toolDefinition.parameters.properties.permission_mode.enum).toContain('auto');
    expect(run.toolDefinition.parameters.required).toEqual([
      'workspace_id',
      'prompt',
      'model_provider',
      'mode',
      'permission_mode',
    ]);
  });

  test('provides distinct durable human tools for Codex and general workflows', () => {
    const codexAsk = toolSeeds.find((seed) => seed.name === 'ask_lennart_for_codex');
    const generalAsk = toolSeeds.find((seed) => seed.name === 'ask_lennart');

    expect(codexAsk.metadata).toMatchObject({ requestVariant: 'codex', durableAcrossRestart: true });
    expect(generalAsk.metadata).toMatchObject({ requestVariant: 'general', durableAcrossRestart: true });
    expect(codexAsk.handlerKey).not.toBe(generalAsk.handlerKey);
  });
});
