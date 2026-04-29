const LlmTool = require('../models/llm_tool');
const defaultHandlers = require('./toolHandlerRegistry');
const defaultToolSeeds = require('./data/toolSeeds');

const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function toPlainTool(tool) {
  if (!tool) {
    return null;
  }
  if (typeof tool.toObject === 'function') {
    return tool.toObject({ versionKey: false });
  }
  return { ...tool };
}

function normalizeNameList(names = []) {
  if (typeof names === 'string') {
    return normalizeNameList(names.split(','));
  }
  if (!Array.isArray(names)) {
    return [];
  }
  const cleaned = names
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

function parseJsonField(value, fieldName, fallback = {}) {
  if (value === undefined || value === null || value === '') {
    return cloneJson(fallback);
  }
  if (typeof value === 'object') {
    return cloneJson(value);
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a JSON object.`);
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${fieldName} contains invalid JSON: ${error.message}`);
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => parseBoolean(entry, false));
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeTags(value = []) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(raw
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter(Boolean)));
}

function extractDefinitionName(definition) {
  if (!definition || typeof definition !== 'object') {
    return '';
  }
  if (definition.function && typeof definition.function.name === 'string') {
    return definition.function.name.trim();
  }
  if (typeof definition.name === 'string') {
    return definition.name.trim();
  }
  return '';
}

function ensureDefinitionName(definition, name) {
  const toolDefinition = cloneJson(definition);
  const definitionName = extractDefinitionName(toolDefinition);
  if (definitionName && definitionName !== name) {
    throw new Error(`Tool definition name "${definitionName}" must match tool name "${name}".`);
  }

  if (toolDefinition.type === 'function' && toolDefinition.function) {
    toolDefinition.function.name = name;
  } else if (toolDefinition.type === 'function') {
    toolDefinition.name = name;
  }

  return toolDefinition;
}

function normalizeToolInput(input = {}, actor = 'system') {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new Error('Tool name must be 1-64 characters and only use letters, numbers, underscores, or hyphens.');
  }

  const displayName = typeof input.displayName === 'string' && input.displayName.trim().length > 0
    ? input.displayName.trim()
    : name;
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const handlerKey = typeof input.handlerKey === 'string' ? input.handlerKey.trim() : '';
  if (!handlerKey) {
    throw new Error('Handler key is required.');
  }

  const rawDefinition = parseJsonField(input.toolDefinition, 'Tool definition');
  if (!rawDefinition || typeof rawDefinition !== 'object' || Array.isArray(rawDefinition)) {
    throw new Error('Tool definition must be a JSON object.');
  }
  const toolDefinition = ensureDefinitionName(rawDefinition, name);

  return {
    name,
    displayName,
    description,
    enabled: parseBoolean(input.enabled, false),
    handlerKey,
    sourcePath: typeof input.sourcePath === 'string' ? input.sourcePath.trim() : '',
    tags: normalizeTags(input.tags),
    toolDefinition,
    metadata: parseJsonField(input.metadata, 'Metadata', {}),
    updatedBy: actor,
  };
}

function toResponsesToolDefinition(tool) {
  const definition = cloneJson(tool.toolDefinition);
  if (!definition || typeof definition !== 'object') {
    throw new Error(`Tool ${tool.name} has no valid tool definition.`);
  }

  if (definition.type === 'function' && definition.function) {
    const fn = definition.function;
    const responsesDefinition = {
      type: 'function',
      name: fn.name || tool.name,
      description: fn.description || tool.description || '',
      parameters: fn.parameters || { type: 'object', properties: {} },
    };
    if (Object.prototype.hasOwnProperty.call(fn, 'strict')) {
      responsesDefinition.strict = fn.strict;
    } else if (Object.prototype.hasOwnProperty.call(definition, 'strict')) {
      responsesDefinition.strict = definition.strict;
    }
    return responsesDefinition;
  }

  return definition;
}

function toChatCompletionsToolDefinition(tool) {
  const responsesDefinition = toResponsesToolDefinition(tool);
  if (!responsesDefinition || responsesDefinition.type !== 'function' || responsesDefinition.function) {
    return responsesDefinition;
  }

  const fn = {
    name: responsesDefinition.name || tool.name,
    description: responsesDefinition.description || tool.description || '',
    parameters: responsesDefinition.parameters || { type: 'object', properties: {} },
  };
  if (Object.prototype.hasOwnProperty.call(responsesDefinition, 'strict')) {
    fn.strict = responsesDefinition.strict;
  }

  return {
    type: 'function',
    function: fn,
  };
}

function formatToolDefinition(tool, format = 'responses') {
  if (format === 'raw') {
    return cloneJson(tool.toolDefinition);
  }
  if (format === 'chat_completions') {
    return toChatCompletionsToolDefinition(tool);
  }
  return toResponsesToolDefinition(tool);
}

function parseToolArguments(value) {
  if (value === undefined || value === null || value === '') {
    return {};
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    throw new Error('Tool call arguments must be a JSON object or JSON string.');
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Tool call arguments contain invalid JSON: ${error.message}`);
  }
}

function extractToolCall(toolCall = {}) {
  const functionCall = toolCall.function || {};
  const name = functionCall.name || toolCall.name;
  if (!name) {
    throw new Error('Tool call is missing a function name.');
  }

  return {
    id: toolCall.id || toolCall.tool_call_id || toolCall.call_id || null,
    callId: toolCall.call_id || toolCall.id || toolCall.tool_call_id || null,
    name,
    arguments: parseToolArguments(
      Object.prototype.hasOwnProperty.call(functionCall, 'arguments')
        ? functionCall.arguments
        : toolCall.arguments
    ),
    raw: toolCall,
  };
}

function stringifyToolOutput(result) {
  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result);
}

class ToolManagerService {
  constructor({
    toolModel = LlmTool,
    handlers = defaultHandlers,
    seeds = defaultToolSeeds,
  } = {}) {
    this.toolModel = toolModel;
    this.handlers = handlers || {};
    this.seeds = Array.isArray(seeds) ? seeds : [];
  }

  getRegisteredHandlerKeys() {
    return Object.keys(this.handlers).sort();
  }

  async listTools({ includeDisabled = false } = {}) {
    const query = includeDisabled ? {} : { enabled: true };
    const tools = await this.toolModel.find(query)
      .sort({ displayName: 1, name: 1 })
      .lean()
      .exec();
    return tools.map(toPlainTool);
  }

  async getAvailableTools() {
    return this.listTools({ includeDisabled: false });
  }

  async getToolById(id, { includeDisabled = true } = {}) {
    const query = includeDisabled ? { _id: id } : { _id: id, enabled: true };
    const tool = await this.toolModel.findOne(query).lean().exec();
    return toPlainTool(tool);
  }

  async getTool(name, { includeDisabled = false } = {}) {
    const query = { name };
    if (!includeDisabled) {
      query.enabled = true;
    }
    const tool = await this.toolModel.findOne(query).lean().exec();
    return toPlainTool(tool);
  }

  async getToolJson(name, { format = 'responses', includeDisabled = false } = {}) {
    const tool = await this.getTool(name, { includeDisabled });
    if (!tool) {
      return null;
    }
    return formatToolDefinition(tool, format);
  }

  async getToolDefinitions(selectedToolNames = [], {
    format = 'responses',
    includeDisabled = false,
    strict = false,
  } = {}) {
    const names = normalizeNameList(selectedToolNames);
    if (names.length === 0) {
      return [];
    }

    const query = { name: { $in: names } };
    if (!includeDisabled) {
      query.enabled = true;
    }

    const tools = await this.toolModel.find(query).lean().exec();
    const byName = new Map(tools.map((tool) => [tool.name, toPlainTool(tool)]));
    const missing = names.filter((name) => !byName.has(name));
    if (strict && missing.length > 0) {
      throw new Error(`Selected tool${missing.length === 1 ? '' : 's'} unavailable: ${missing.join(', ')}`);
    }

    return names
      .map((name) => byName.get(name))
      .filter(Boolean)
      .map((tool) => formatToolDefinition(tool, format));
  }

  async getAvailableToolDefinitions({ format = 'responses' } = {}) {
    const tools = await this.listTools({ includeDisabled: false });
    return tools.map((tool) => formatToolDefinition(tool, format));
  }

  async saveTool(input = {}, actor = 'system') {
    const normalized = normalizeToolInput(input, actor);
    if (input.id) {
      const updated = await this.toolModel.findByIdAndUpdate(
        input.id,
        { $set: normalized },
        { new: true, runValidators: true }
      ).lean().exec();
      if (!updated) {
        throw new Error('Tool not found.');
      }
      return toPlainTool(updated);
    }

    const created = await new this.toolModel({
      ...normalized,
      createdBy: actor,
    }).save();
    return toPlainTool(created);
  }

  async toggleTool(id, enabled, actor = 'system') {
    const updated = await this.toolModel.findByIdAndUpdate(
      id,
      {
        $set: {
          enabled: parseBoolean(enabled, false),
          updatedBy: actor,
        },
      },
      { new: true, runValidators: true }
    ).lean().exec();
    if (!updated) {
      throw new Error('Tool not found.');
    }
    return toPlainTool(updated);
  }

  async deleteTool(id) {
    const result = await this.toolModel.deleteOne({ _id: id }).exec();
    return result.deletedCount || 0;
  }

  async seedDefaultTools({ actor = 'system' } = {}) {
    const summary = {
      matchedCount: 0,
      modifiedCount: 0,
      upsertedCount: 0,
      names: [],
    };

    for (const seed of this.seeds) {
      const normalized = normalizeToolInput(seed, actor);
      const result = await this.toolModel.updateOne(
        { name: normalized.name },
        {
          $set: {
            displayName: normalized.displayName,
            description: normalized.description,
            handlerKey: normalized.handlerKey,
            sourcePath: normalized.sourcePath,
            tags: normalized.tags,
            toolDefinition: normalized.toolDefinition,
            metadata: normalized.metadata,
            updatedBy: actor,
            lastSeededAt: new Date(),
          },
          $setOnInsert: {
            name: normalized.name,
            enabled: seed.enabled !== false,
            createdBy: actor,
          },
        },
        { upsert: true, runValidators: true }
      ).exec();

      summary.matchedCount += result.matchedCount || 0;
      summary.modifiedCount += result.modifiedCount || 0;
      summary.upsertedCount += result.upsertedCount || 0;
      summary.names.push(normalized.name);
    }

    return summary;
  }

  async executeTool(name, args = {}, context = {}) {
    const tool = await this.getTool(name, { includeDisabled: false });
    if (!tool) {
      throw new Error(`Tool "${name}" is not available.`);
    }

    const handler = this.handlers[tool.handlerKey];
    if (!handler) {
      throw new Error(`No registered handler for tool "${name}" (${tool.handlerKey}).`);
    }

    const execute = typeof handler === 'function' ? handler : handler.execute;
    if (typeof execute !== 'function') {
      throw new Error(`Handler for tool "${name}" is not executable.`);
    }

    const result = await execute(args, {
      ...context,
      tool,
      toolName: name,
      handlerKey: tool.handlerKey,
    });

    return {
      ok: true,
      tool: name,
      handlerKey: tool.handlerKey,
      result,
    };
  }

  async executeToolCall(toolCall, context = {}) {
    const parsed = extractToolCall(toolCall);
    const execution = await this.executeTool(parsed.name, parsed.arguments, {
      ...context,
      toolCall: parsed.raw,
      toolCallId: parsed.id,
      callId: parsed.callId,
    });

    return {
      ...execution,
      toolCallId: parsed.id,
      callId: parsed.callId,
    };
  }

  formatToolResultForOpenAI(toolCall, result, { format = 'responses' } = {}) {
    const parsed = extractToolCall(toolCall);
    const output = stringifyToolOutput(result);
    if (format === 'chat_completions') {
      return {
        role: 'tool',
        tool_call_id: parsed.id,
        name: parsed.name,
        content: output,
      };
    }
    return {
      type: 'function_call_output',
      call_id: parsed.callId,
      output,
    };
  }
}

ToolManagerService.normalizeToolInput = normalizeToolInput;
ToolManagerService.extractToolCall = extractToolCall;
ToolManagerService.formatToolDefinition = formatToolDefinition;

module.exports = ToolManagerService;
