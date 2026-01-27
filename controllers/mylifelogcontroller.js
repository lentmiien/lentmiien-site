const logger = require('../utils/logger');
const myLifeLogService = require('../services/myLifeLogService');
const ollama = require('../utils/Ollama_API');

const LIFE_LOG_TYPES = ['basic', 'medical', 'diary', 'visual_log'];
const TYPE_LABELS = {
  basic: 'Basic',
  medical: 'Medical',
  diary: 'Diary',
  visual_log: 'Visual log',
};

const MY_LIFE_LOG_PROMPT = `You are a journaling assistant that cleans up short, raw life-log notes.

Goals:
- Preserve the original meaning and facts.
- Improve clarity and structure.
- Keep the entry compact and easy to scan.

Output rules:
- Return Markdown only.
- Use short paragraphs or short bullet lists when it helps clarity.
- Do NOT add new information, interpretations, or advice.
- Keep timestamps, names, numbers, and tags exactly as provided.
- If the input is already clean, return it with minimal changes.`;

const pad2 = (value) => String(value).padStart(2, '0');

const formatDateTimeInput = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const formatDisplayTimestamp = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const formatDisplayDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const formatDisplayTime = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const parseDateTimeInput = (value, { isEnd = false } = {}) => {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const suffix = isEnd ? 'T23:59:59' : 'T00:00:00';
    const local = new Date(`${trimmed}${suffix}`);
    return Number.isNaN(local.getTime()) ? null : local;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseCsv = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseBoolean = (value) => {
  if (Array.isArray(value)) {
    return parseBoolean(value[value.length - 1]);
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
  return false;
};

const extractAssistantText = (response) => {
  if (!response || !Array.isArray(response.choices)) return '';
  const segments = [];
  response.choices.forEach((choice) => {
    if (!choice || !choice.message) return;
    const text = flattenAssistantContent(choice.message.content);
    if (text) {
      segments.push(text);
    }
  });
  return segments.join('\n\n').trim();
};

const flattenAssistantContent = (content) => {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => flattenAssistantContent(item))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
  if (typeof content === 'object') {
    if (typeof content.text === 'string') return content.text.trim();
    if (typeof content.content === 'string') return content.content.trim();
  }
  return '';
};

const normalizeEntry = (entry) => ({
  id: entry.id,
  type: entry.type,
  typeLabel: TYPE_LABELS[entry.type] || entry.type,
  label: entry.label || '',
  value: entry.value || '',
  text: entry.text || '',
  v_log_data: entry.v_log_data || '',
  timestamp: entry.timestamp,
  displayTimestamp: formatDisplayTimestamp(entry.timestamp),
  displayDate: formatDisplayDate(entry.timestamp),
  displayTime: formatDisplayTime(entry.timestamp),
  isLegacy: entry.isLegacy === true,
});

const buildDailySummary = (entries) => {
  const days = new Map();

  entries.forEach((entry) => {
    const dayKey = formatDisplayDate(entry.timestamp);
    if (!dayKey) return;

    let day = days.get(dayKey);
    if (!day) {
      day = {
        key: dayKey,
        displayDate: dayKey,
        groups: new Map(),
      };
      days.set(dayKey, day);
    }

    const label = entry.label ? entry.label.trim() : '';
    const groupLabel = label || entry.typeLabel || entry.type;
    const groupKey = label ? label.toLowerCase() : `type:${entry.type}`;

    let group = day.groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        label: groupLabel,
        entries: [],
      };
      day.groups.set(groupKey, group);
    }
    group.entries.push(entry);
  });

  return Array.from(days.values()).map((day) => ({
    key: day.key,
    displayDate: day.displayDate,
    groups: Array.from(day.groups.values()),
  }));
};

exports.life_log_page = async (req, res) => {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  const rawStart = req.query?.start;
  const rawEnd = req.query?.end;
  const start = parseDateTimeInput(rawStart) || defaultStart;
  const end = parseDateTimeInput(rawEnd, { isEnd: true }) || now;
  const labels = parseCsv(req.query?.labels || req.query?.label);
  const types = parseCsv(req.query?.types || req.query?.type);
  const includeLegacy = req.query?.include_legacy === undefined
    ? true
    : parseBoolean(req.query?.include_legacy);

  try {
    const entries = await myLifeLogService.listEntries({
      start,
      end,
      labels,
      types,
      includeLegacy,
    });
    const suggestions = myLifeLogService.getLabelSuggestions(now);
    const normalizedEntries = entries.map(normalizeEntry);
    const dailySummary = buildDailySummary(normalizedEntries);

    res.render('my_life_log', {
      entries: normalizedEntries,
      dailySummary,
      filters: {
        start: formatDateTimeInput(start),
        end: formatDateTimeInput(end),
        labels: labels.join(', '),
        types,
        includeLegacy,
      },
      labelOptions: suggestions.all,
      typeOptions: LIFE_LOG_TYPES.map((type) => ({
        value: type,
        label: TYPE_LABELS[type] || type,
      })),
    });
  } catch (error) {
    logger.error('Failed to render life log page', {
      category: 'life_log',
      metadata: { message: error?.message || error },
    });
    res.status(500).render('error_page', { error: 'Unable to load life log right now.' });
  }
};

exports.life_log_analytics_page = async (req, res) => {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  const rawStart = req.query?.start;
  const rawEnd = req.query?.end;
  const start = parseDateTimeInput(rawStart) || defaultStart;
  const end = parseDateTimeInput(rawEnd, { isEnd: true }) || now;
  const basicLabels = parseCsv(req.query?.basic_labels);
  const medicalLabels = parseCsv(req.query?.medical_labels);
  const types = parseCsv(req.query?.types || req.query?.type);
  const includeLegacy = req.query?.include_legacy === undefined
    ? true
    : parseBoolean(req.query?.include_legacy);
  const analyticsAutoRun = parseBoolean(req.query?.auto);

  try {
    const suggestions = myLifeLogService.getLabelSuggestions(now);

    res.render('my_life_log_analytics', {
      filters: {
        start: formatDateTimeInput(start),
        end: formatDateTimeInput(end),
        basicLabels,
        medicalLabels,
        types,
        includeLegacy,
      },
      analyticsAutoRun,
      labelOptions: suggestions.all,
      typeOptions: LIFE_LOG_TYPES.map((type) => ({
        value: type,
        label: TYPE_LABELS[type] || type,
      })),
    });
  } catch (error) {
    logger.error('Failed to render life log analytics page', {
      category: 'life_log',
      metadata: { message: error?.message || error },
    });
    res.status(500).render('error_page', { error: 'Unable to load life log analytics right now.' });
  }
};

exports.life_log_entries = async (req, res) => {
  const start = parseDateTimeInput(req.query?.start);
  const end = parseDateTimeInput(req.query?.end, { isEnd: true });
  const labels = parseCsv(req.query?.labels || req.query?.label);
  const types = parseCsv(req.query?.types || req.query?.type);
  const includeLegacy = parseBoolean(req.query?.include_legacy);
  const limitRaw = req.query?.limit;
  const limit = Number.isFinite(parseInt(limitRaw, 10)) ? parseInt(limitRaw, 10) : null;

  try {
    const entries = await myLifeLogService.listEntries({
      start,
      end,
      labels,
      types,
      includeLegacy,
      limit,
    });
    res.json({
      entries: entries.map((entry) => ({
        ...normalizeEntry(entry),
        timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : entry.timestamp,
      })),
    });
  } catch (error) {
    logger.error('Failed to list life log entries', {
      category: 'life_log',
      metadata: { message: error?.message || error },
    });
    res.status(500).json({ error: 'Unable to load life log entries.' });
  }
};

exports.life_log_add_entry = async (req, res) => {
  const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
  if (!LIFE_LOG_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid entry type.' });
  }

  const rawTimestamp = req.body?.timestamp || req.body?.time || null;
  const timestamp = parseDateTimeInput(rawTimestamp) || new Date();
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
  const value = typeof req.body?.value === 'string' || typeof req.body?.value === 'number'
    ? String(req.body.value).trim()
    : '';
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const v_log_data = typeof req.body?.v_log_data === 'string' ? req.body.v_log_data : '';

  if ((type === 'basic' || type === 'medical') && (!label || !value)) {
    return res.status(400).json({ error: 'Label and value are required.' });
  }
  if (type === 'diary' && !text) {
    return res.status(400).json({ error: 'Diary text is required.' });
  }
  if (type === 'visual_log' && !v_log_data) {
    return res.status(400).json({ error: 'Visual log data is required.' });
  }

  const payload = {
    type,
    label: type === 'visual_log' && !label ? 'body_map' : label,
    value: type === 'basic' || type === 'medical' ? value : '',
    text: type === 'diary' ? text : '',
    v_log_data: type === 'visual_log' ? v_log_data : '',
    timestamp,
  };

  try {
    const saved = await myLifeLogService.addEntry(payload);
    res.json({
      entry: normalizeEntry({
        id: saved._id?.toString() || '',
        type: saved.type,
        label: saved.label || '',
        value: saved.value || '',
        text: saved.text || '',
        v_log_data: saved.v_log_data || '',
        timestamp: saved.timestamp,
        isLegacy: false,
      }),
    });
  } catch (error) {
    logger.error('Failed to add life log entry', {
      category: 'life_log',
      metadata: { message: error?.message || error },
    });
    res.status(500).json({ error: 'Unable to save life log entry.' });
  }
};

exports.life_log_delete_entry = async (req, res) => {
  const { id } = req.params;
  if (!id || id.startsWith('legacy-')) {
    return res.status(400).json({ error: 'Legacy entries cannot be deleted here.' });
  }

  try {
    const deleted = await myLifeLogService.deleteEntry(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    return res.json({ status: 'ok' });
  } catch (error) {
    logger.error('Failed to delete life log entry', {
      category: 'life_log',
      metadata: { message: error?.message || error },
    });
    return res.status(500).json({ error: 'Unable to delete life log entry.' });
  }
};

exports.life_log_format = async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    return res.status(400).json({ error: 'Text is required for formatting.' });
  }

  try {
    const conversation = {
      context_prompt: MY_LIFE_LOG_PROMPT,
      metadata: { temperature: 0.2, max_tokens: 500 },
    };
    const messages = [{
      user_id: 'user',
      contentType: 'text',
      content: { text },
      timestamp: new Date(),
    }];
    const model = { api_model: 'gpt-oss:20b', allow_images: false, in_modalities: ['text'] };

    const response = await ollama.chat(conversation, messages, model);
    const formatted = extractAssistantText(response) || text;
    return res.json({ formatted });
  } catch (error) {
    logger.error('Life log formatter failed', {
      category: 'life_log',
      metadata: { message: error?.message || error },
    });
    return res.status(502).json({ error: 'Unable to format diary text right now.' });
  }
};
