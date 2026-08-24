const toolSeeds = require('../../services/data/toolSeeds');
const toolHandlers = require('../../services/toolHandlerRegistry');
const ToolManagerService = require('../../services/toolManagerService');

describe('Pushover reminder Tool Manager seeds', () => {
  const reminderToolNames = [
    'set_pushover_reminder',
    'fetch_pushover_reminders',
    'delete_pushover_reminder',
  ];

  test('defines three enabled tools backed by registered handlers', () => {
    const seeds = toolSeeds.filter((seed) => reminderToolNames.includes(seed.name));

    expect(seeds.map((seed) => seed.name)).toEqual(reminderToolNames);
    seeds.forEach((seed) => {
      expect(seed.enabled).toBe(true);
      expect(toolHandlers[seed.handlerKey]?.execute).toEqual(expect.any(Function));
      expect(seed.toolDefinition.name).toBe(seed.name);
    });
    expect(seeds.find((seed) => seed.name === 'fetch_pushover_reminders')
      .toolDefinition.description).toContain('id required by delete_pushover_reminder');
    expect(seeds.find((seed) => seed.name === 'delete_pushover_reminder')
      .toolDefinition.parameters.required).toEqual(['reminder_id']);
  });

  test('defines reminder-aware task tools while legacy task tools default to zero reminders', () => {
    const todo = toolSeeds.find((seed) => seed.name === 'add_todo');
    const tobuy = toolSeeds.find((seed) => seed.name === 'add_tobuy');
    const reminderTools = [
      toolSeeds.find((seed) => seed.name === 'add_todo_with_reminders'),
      toolSeeds.find((seed) => seed.name === 'add_tobuy_with_reminders'),
    ];

    expect(todo.metadata.reminderCountDefault).toBe(0);
    expect(tobuy.metadata.reminderCountDefault).toBe(0);
    expect(todo.toolDefinition.parameters.properties).not.toHaveProperty('reminders');
    expect(tobuy.toolDefinition.parameters.properties).not.toHaveProperty('reminders');

    reminderTools.forEach((seed) => {
      expect(seed).toBeDefined();
      expect(seed.enabled).toBe(true);
      expect(toolHandlers[seed.handlerKey]?.execute).toEqual(expect.any(Function));
      expect(seed.toolDefinition.parameters.properties.reminders).toMatchObject({
        type: 'array',
        maxItems: 5,
        default: [],
      });
      expect(seed.toolDefinition.parameters.properties.reminders.items.properties.anchor.enum)
        .toEqual(['start', 'deadline']);
    });
  });

  test('missing-only seeding does not update an existing tool', async () => {
    const exec = jest.fn()
      .mockResolvedValueOnce({ matchedCount: 1, upsertedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 0, upsertedCount: 1 });
    const toolModel = {
      updateOne: jest.fn(() => ({ exec })),
    };
    const seeds = [
      {
        name: 'existing_tool',
        displayName: 'Existing Tool',
        description: 'Existing',
        enabled: true,
        handlerKey: 'demo.existing',
        toolDefinition: {
          type: 'function',
          name: 'existing_tool',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        name: 'missing_tool',
        displayName: 'Missing Tool',
        description: 'Missing',
        enabled: true,
        handlerKey: 'demo.missing',
        toolDefinition: {
          type: 'function',
          name: 'missing_tool',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const service = new ToolManagerService({ toolModel, handlers: {}, seeds });

    await expect(service.seedMissingDefaultTools({ actor: 'startup' })).resolves.toMatchObject({
      matchedCount: 1,
      upsertedCount: 1,
      names: ['existing_tool', 'missing_tool'],
    });
    expect(toolModel.updateOne).toHaveBeenNthCalledWith(
      1,
      { name: 'existing_tool' },
      { $setOnInsert: expect.objectContaining({ name: 'existing_tool', createdBy: 'startup' }) },
      { upsert: true, runValidators: true }
    );
    expect(toolModel.updateOne.mock.calls[0][1]).not.toHaveProperty('$set');
  });
});
