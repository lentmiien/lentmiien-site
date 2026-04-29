const ToolManagerService = require('../services/toolManagerService');
const defaultToolSeeds = require('../services/data/toolSeeds');
const logger = require('../utils/logger');

const toolManagerService = new ToolManagerService();

function parseFeedback(req) {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const message = typeof req.query.message === 'string' ? req.query.message : '';
  if (!status || !message) {
    return null;
  }
  return { status, message };
}

function redirectWithFeedback(res, status, message, extra = '') {
  const suffix = extra ? `&${extra.replace(/^\?/, '')}` : '';
  return res.redirect(`/admin/tools?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}${suffix}`);
}

function safeJsonString(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch (_error) {
    return '{}';
  }
}

function parseJsonInput(value, label) {
  if (value === undefined || value === null || value === '') {
    return {};
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a JSON object.`);
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed;
  } catch (error) {
    if (error.message.includes('must be a JSON object')) {
      throw error;
    }
    throw new Error(`${label} contains invalid JSON: ${error.message}`);
  }
}

exports.index = async (req, res) => {
  try {
    const [tools, editTool] = await Promise.all([
      toolManagerService.listTools({ includeDisabled: true }),
      req.query.edit ? toolManagerService.getToolById(req.query.edit, { includeDisabled: true }) : Promise.resolve(null),
    ]);

    const createTemplate = {
      name: 'new_tool',
      displayName: 'New Tool',
      description: '',
      handlerKey: '',
      sourcePath: '',
      tags: [],
      enabled: true,
      toolDefinition: {
        type: 'function',
        name: 'new_tool',
        description: '',
        parameters: { type: 'object', properties: {}, required: [] },
        strict: false,
      },
      metadata: {},
    };

    return res.render('admin_tool_manager', {
      title: 'Tool Manager',
      tools,
      editTool,
      feedback: parseFeedback(req),
      handlerKeys: toolManagerService.getRegisteredHandlerKeys(),
      seedToolNames: defaultToolSeeds.map((seed) => seed.name),
      testerConfig: {
        endpoint: '/admin/tools/test',
        tools: tools.map((tool) => ({
          name: tool.name,
          displayName: tool.displayName,
          enabled: tool.enabled,
          handlerKey: tool.handlerKey,
        })),
      },
      formDefaults: editTool || createTemplate,
      toolDefinitionText: safeJsonString(editTool ? editTool.toolDefinition : createTemplate.toolDefinition),
      metadataText: safeJsonString(editTool ? editTool.metadata : createTemplate.metadata),
    });
  } catch (error) {
    logger.error('Failed to render tool manager page', {
      category: 'tool_manager',
      metadata: { error: error.message },
    });
    return res.status(500).render('error_page', {
      message: 'Unable to load the tool manager right now.',
    });
  }
};

exports.save = async (req, res) => {
  try {
    const saved = await toolManagerService.saveTool(req.body || {}, req.user?.name || 'admin');
    return redirectWithFeedback(res, 'success', `Saved tool ${saved.name}.`, `edit=${encodeURIComponent(saved._id.toString())}`);
  } catch (error) {
    logger.warning('Failed to save tool manager entry', {
      category: 'tool_manager',
      metadata: { error: error.message, user: req.user?.name || null },
    });
    return redirectWithFeedback(res, 'error', error.message || 'Unable to save the tool.');
  }
};

exports.toggle = async (req, res) => {
  try {
    const tool = await toolManagerService.toggleTool(
      req.params.id,
      req.body.enabled,
      req.user?.name || 'admin'
    );
    return redirectWithFeedback(res, 'success', `${tool.enabled ? 'Enabled' : 'Disabled'} ${tool.name}.`);
  } catch (error) {
    logger.warning('Failed to toggle tool manager entry', {
      category: 'tool_manager',
      metadata: { id: req.params.id, error: error.message },
    });
    return redirectWithFeedback(res, 'error', error.message || 'Unable to update the tool.');
  }
};

exports.delete = async (req, res) => {
  try {
    const deletedCount = await toolManagerService.deleteTool(req.params.id);
    if (!deletedCount) {
      return redirectWithFeedback(res, 'error', 'Tool not found.');
    }
    return redirectWithFeedback(res, 'success', 'Tool deleted.');
  } catch (error) {
    logger.warning('Failed to delete tool manager entry', {
      category: 'tool_manager',
      metadata: { id: req.params.id, error: error.message },
    });
    return redirectWithFeedback(res, 'error', error.message || 'Unable to delete the tool.');
  }
};

exports.seed = async (req, res) => {
  try {
    const summary = await toolManagerService.seedDefaultTools({ actor: req.user?.name || 'admin' });
    return redirectWithFeedback(
      res,
      'success',
      `Seeded ${summary.names.length} default tool${summary.names.length === 1 ? '' : 's'} (${summary.names.join(', ')}).`
    );
  } catch (error) {
    logger.warning('Failed to seed tool manager entries', {
      category: 'tool_manager',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', error.message || 'Unable to seed default tools.');
  }
};

exports.test = async (req, res) => {
  const toolName = typeof req.body?.toolName === 'string' ? req.body.toolName.trim() : '';
  if (!toolName) {
    return res.status(400).json({
      ok: false,
      error: 'Tool name is required.',
    });
  }

  try {
    const args = parseJsonInput(req.body.arguments, 'Arguments');
    const execution = await toolManagerService.executeTool(toolName, args, {
      user: req.user || null,
      userName: req.user?.name || 'admin',
      userId: req.user?._id ? req.user._id.toString() : null,
      createdBy: 'Tool',
      source: 'admin-tool-manager-test',
    });

    return res.json({
      ok: true,
      execution,
    });
  } catch (error) {
    logger.warning('Manual tool test failed', {
      category: 'tool_manager',
      metadata: {
        toolName,
        error: error.message,
        user: req.user?.name || null,
      },
    });
    return res.status(error.status || 400).json({
      ok: false,
      error: error.message || 'Tool test failed.',
    });
  }
};
