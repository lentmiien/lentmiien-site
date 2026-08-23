const logger = require('../utils/logger');
const ToolManagerService = require('./toolManagerService');

async function seedMissingToolManagerEntries({
  toolManagerService = new ToolManagerService(),
  log = logger,
} = {}) {
  try {
    const summary = await toolManagerService.seedMissingDefaultTools({ actor: 'startup' });
    if (summary.upsertedCount > 0) {
      await log.notice('Seeded missing Tool Manager entries at startup', {
        category: 'tool_manager',
        metadata: {
          inserted: summary.upsertedCount,
          defaultToolsChecked: summary.names.length,
        },
      });
    }
    return summary;
  } catch (error) {
    await log.error('Failed to seed missing Tool Manager entries at startup', {
      category: 'tool_manager',
      metadata: { error: error.message },
    });
    return {
      matchedCount: 0,
      upsertedCount: 0,
      names: [],
      error: error.message,
    };
  }
}

module.exports = {
  seedMissingToolManagerEntries,
};
