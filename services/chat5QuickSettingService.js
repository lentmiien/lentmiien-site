const REASONING_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const MODE_OPTIONS = ['standard', 'pro'];
const VERBOSITY_OPTIONS = ['low', 'medium', 'high'];

const BUILTIN_TOOLS = [
  {
    name: 'image_generation',
    displayName: 'Generate Images',
    description: 'Generate images from the conversation.',
  },
  {
    name: 'web_search_preview',
    displayName: 'Search Web',
    description: 'Search the web for current information.',
  },
];

class Chat5QuickSettingValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Chat5QuickSettingValidationError';
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeList(value) {
  const entries = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : []);
  return [...new Set(entries
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean))];
}

function fieldIsOverridden(body, field) {
  return body && body[`${field}_mode`] === 'override';
}

function assertListLengths(values, label) {
  if (values.some((value) => value.length > 100)) {
    throw new Chat5QuickSettingValidationError(`${label} entries must be 100 characters or fewer.`);
  }
}

function buildToolOptions(availableTools = []) {
  const byName = new Map();
  [...BUILTIN_TOOLS, ...(Array.isArray(availableTools) ? availableTools : [])].forEach((tool) => {
    const name = normalizeText(tool && tool.name);
    if (!name || byName.has(name)) return;
    byName.set(name, {
      name,
      displayName: normalizeText(tool.displayName) || name,
      description: normalizeText(tool.description),
    });
  });
  return [...byName.values()];
}

function parseQuickSettingForm(body = {}, catalog = {}) {
  const name = normalizeText(body.name);
  if (!name) {
    throw new Chat5QuickSettingValidationError('A quick setting name is required.');
  }
  if (name.length > 120) {
    throw new Chat5QuickSettingValidationError('The quick setting name must be 120 characters or fewer.');
  }

  const overrides = {};

  if (fieldIsOverridden(body, 'category')) {
    const category = normalizeText(body.category);
    if (!category) {
      throw new Chat5QuickSettingValidationError('Category is required when its override is enabled.');
    }
    if (category.length > 100) {
      throw new Chat5QuickSettingValidationError('Category must be 100 characters or fewer.');
    }
    overrides.category = category;
  }

  if (fieldIsOverridden(body, 'tags')) {
    const tags = normalizeList(body.tags);
    assertListLengths(tags, 'Tag');
    overrides.tags = tags;
  }

  const contextMode = normalizeText(body.context_mode);
  if (contextMode === 'text') {
    overrides.context = {
      source: 'text',
      text: typeof body.context_text === 'string' ? body.context_text : '',
      templateId: null,
    };
  } else if (contextMode === 'template') {
    const templateId = normalizeText(body.context_template_id);
    const template = (catalog.contextTemplates || []).find((entry) => String(entry._id) === templateId);
    if (!template) {
      throw new Chat5QuickSettingValidationError('Select an existing context template.');
    }
    overrides.context = {
      source: 'template',
      text: typeof template.TemplateText === 'string' ? template.TemplateText : '',
      templateId,
    };
  } else if (contextMode && contextMode !== 'ignore') {
    throw new Chat5QuickSettingValidationError('Select a valid context override mode.');
  }

  if (fieldIsOverridden(body, 'tools')) {
    const tools = normalizeList(body.tools);
    const allowedTools = new Set((catalog.tools || []).map((tool) => tool.name));
    const unknownTool = tools.find((tool) => !allowedTools.has(tool));
    if (unknownTool) {
      throw new Chat5QuickSettingValidationError(`Tool "${unknownTool}" is not available.`);
    }
    overrides.tools = tools;
  }

  if (fieldIsOverridden(body, 'model')) {
    const model = normalizeText(body.model);
    const availableModels = new Set((catalog.models || []).map((entry) => entry.api_model));
    if (!model || !availableModels.has(model)) {
      throw new Chat5QuickSettingValidationError('Select an existing model.');
    }
    overrides.model = model;
  }

  if (fieldIsOverridden(body, 'maxMessages')) {
    const maxMessages = Number.parseInt(body.maxMessages, 10);
    if (!Number.isFinite(maxMessages) || maxMessages <= 0) {
      throw new Chat5QuickSettingValidationError('Max messages must be a positive whole number.');
    }
    overrides.maxMessages = maxMessages;
  }

  if (fieldIsOverridden(body, 'reasoning')) {
    const reasoning = normalizeText(body.reasoning);
    if (!REASONING_OPTIONS.includes(reasoning)) {
      throw new Chat5QuickSettingValidationError('Select an existing reasoning effort.');
    }
    overrides.reasoning = reasoning;
  }

  if (fieldIsOverridden(body, 'mode')) {
    const mode = normalizeText(body.mode);
    if (!MODE_OPTIONS.includes(mode)) {
      throw new Chat5QuickSettingValidationError('Select an existing reasoning mode.');
    }
    overrides.mode = mode;
  }

  if (fieldIsOverridden(body, 'verbosity')) {
    const verbosity = normalizeText(body.verbosity);
    if (!VERBOSITY_OPTIONS.includes(verbosity)) {
      throw new Chat5QuickSettingValidationError('Select an existing verbosity level.');
    }
    overrides.verbosity = verbosity;
  }

  if (fieldIsOverridden(body, 'members')) {
    const members = normalizeList(body.members);
    assertListLengths(members, 'Member');
    overrides.members = members;
  }

  return { name, overrides };
}

function toPlainObject(setting) {
  if (!setting) return {};
  if (typeof setting.toObject === 'function') {
    return setting.toObject({ versionKey: false });
  }
  return { ...setting };
}

function serializeQuickSetting(setting, contextTemplates = []) {
  const plain = toPlainObject(setting);
  const raw = plain.overrides || {};
  const overrides = {};

  ['category', 'tags', 'tools', 'model', 'maxMessages', 'reasoning', 'mode', 'verbosity', 'members'].forEach((field) => {
    if (hasOwn(raw, field) && typeof raw[field] !== 'undefined') {
      overrides[field] = raw[field];
    }
  });

  if (raw.context && typeof raw.context === 'object') {
    let contextText = typeof raw.context.text === 'string' ? raw.context.text : '';
    if (raw.context.source === 'template' && raw.context.templateId) {
      const template = contextTemplates.find((entry) => String(entry._id) === String(raw.context.templateId));
      if (template && typeof template.TemplateText === 'string') {
        contextText = template.TemplateText;
      }
    }
    overrides.context = contextText;
  }

  return {
    _id: plain._id ? String(plain._id) : '',
    name: plain.name || '',
    overrides,
  };
}

function toManagementView(setting) {
  const plain = toPlainObject(setting);
  const raw = plain.overrides || {};
  const context = raw.context && typeof raw.context === 'object' ? raw.context : null;
  const enabledFields = ['category', 'tags', 'context', 'tools', 'model', 'maxMessages', 'reasoning', 'mode', 'verbosity', 'members']
    .filter((field) => hasOwn(raw, field) && typeof raw[field] !== 'undefined');

  return {
    _id: plain._id ? String(plain._id) : '',
    name: plain.name || '',
    summary: enabledFields.length > 0 ? enabledFields.join(', ') : 'No overrides',
    form: {
      categoryEnabled: hasOwn(raw, 'category'),
      category: raw.category || '',
      tagsEnabled: hasOwn(raw, 'tags'),
      tags: Array.isArray(raw.tags) ? raw.tags.join(', ') : '',
      contextMode: context ? context.source : 'ignore',
      contextText: context && typeof context.text === 'string' ? context.text : '',
      contextTemplateId: context && context.templateId ? String(context.templateId) : '',
      toolsEnabled: hasOwn(raw, 'tools'),
      tools: Array.isArray(raw.tools) ? raw.tools : [],
      modelEnabled: hasOwn(raw, 'model'),
      model: raw.model || '',
      maxMessagesEnabled: hasOwn(raw, 'maxMessages'),
      maxMessages: raw.maxMessages || 999,
      reasoningEnabled: hasOwn(raw, 'reasoning'),
      reasoning: raw.reasoning || 'medium',
      modeEnabled: hasOwn(raw, 'mode'),
      mode: raw.mode || 'standard',
      verbosityEnabled: hasOwn(raw, 'verbosity'),
      verbosity: raw.verbosity || 'medium',
      membersEnabled: hasOwn(raw, 'members'),
      members: Array.isArray(raw.members) ? raw.members.join(', ') : '',
    },
  };
}

class Chat5QuickSettingService {
  constructor(model) {
    this.model = model;
  }

  async listForUser(user) {
    return this.model.find({ user })
      .sort({ name: 1, createdAt: 1 })
      .lean()
      .exec();
  }

  async createForUser(user, data) {
    const setting = new this.model({ user, ...data });
    await setting.save();
    return setting;
  }

  async updateForUser(user, id, data) {
    const setting = await this.model.findOne({ _id: id, user });
    if (!setting) return null;
    setting.name = data.name;
    setting.overrides = data.overrides;
    await setting.save();
    return setting;
  }

  async deleteForUser(user, id) {
    return this.model.findOneAndDelete({ _id: id, user });
  }
}

module.exports = {
  BUILTIN_TOOLS,
  Chat5QuickSettingService,
  Chat5QuickSettingValidationError,
  MODE_OPTIONS,
  REASONING_OPTIONS,
  VERBOSITY_OPTIONS,
  buildToolOptions,
  normalizeList,
  parseQuickSettingForm,
  serializeQuickSetting,
  toManagementView,
};
