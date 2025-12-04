const { UseraccountModel, RoleModel, OpenAIUsage, ApiDebugLog, HtmlPageRating } = require('../database');
const { HTML_RATING_CATEGORIES, parseRatingValue, computeAverageRating } = require('../utils/htmlRatings');
const databaseUsageService = require('../services/databaseUsageService');
const { formatBytes, formatNumber, formatPercent, calculatePercent } = require('../utils/metricsFormatter');

const locked_user_id = "5dd115006b7f671c2009709d";

exports.manage_users = async (req, res) => {
  const users = await UseraccountModel.find();
  res.render('manage_users', { users });
}

exports.set_type = async (req, res) => {
  const id = req.body.id;
  if (id === locked_user_id) {
    return res.json({status:"Failed", message:"Can't modify user."});
  }
  const new_type = req.body.type;
  const user = await UseraccountModel.findById(id);
  if (user) {
    user.type_user = new_type;
    await user.save();
    return res.json({status:"Completed", message:"User updated."});
  }
  return res.json({status:"Failed", message:"No user to update."});
}

exports.reset_password = async (req, res) => {
  const id = req.body.id;
  if (id === locked_user_id) {
    return res.json({status:"Failed", message:"Can't modify user."});
  }
  const user = await UseraccountModel.findById(id);
  if (user) {
    user.hash_password = "0";
    await user.save();
    return res.json({status:"Completed", message:"User updated."});
  }
  return res.json({status:"Failed", message:"No user to update."});
}

exports.delete_user = async (req, res) => {
  const id = req.body.id;
  if (id === locked_user_id) {
    return res.json({status:"Failed", message:"Can't modify user."});
  }
  await UseraccountModel.deleteOne({_id: id});
  return res.json({status:"Completed", message:"User deleted."});
}

exports.create_user = async (req, res) => {
  const name = req.body.name;
  const email = req.body.email;
  const type_user = req.body.type_user;

  const entry_data = {
    name,
    email,
    type_user,
    hash_password: "0",
  };
  await new UseraccountModel(entry_data).save();

  return res.json({status:"Completed", message:"User created."});
}

exports.manage_roles = async (req, res) => {
  const users = await UseraccountModel.find();
  const roles = await RoleModel.find();
  const selection = {
    name_list: [],
    role_list: [],
    routes: [
      "chat",
      "chat2",
      "chat3",
      "chat4",
      "chat5",
      "openai",
      "embedding",
      "gptdocument",
      "accounting",
      "budget",
      "cooking",
      "health",
      "box",
      "quicknote",
      "emergencystock",
      "receipt",
      "product",
      "gallery",
      "payroll",
      "scheduletask",
      "image_gen",
      "sora",
      "binpacking",
      "ocr",
      "test",
      "archive",
    ]
  };
  users.forEach(user => {
    if (selection.name_list.indexOf(user.name) === -1) selection.name_list.push(user.name);
    if (selection.role_list.indexOf(user.type_user) === -1) selection.role_list.push(user.type_user);
  });
  res.render('manage_roles', { selection, roles });
}

exports.update_role = async (req, res) => {
  const name = req.body.role;
  const type = req.body.type;

  if ("route_permissions" in req.body) {
    // Update entry if existing, create otherwise
    const permissions = Array.isArray(req.body.route_permissions) ? req.body.route_permissions : [req.body.route_permissions];

    const roleToUpdate = await RoleModel.findOne({ name, type });
    if (roleToUpdate) {
      roleToUpdate.permissions = permissions;
      await roleToUpdate.save();
    } else {
      const entry_data = {
        name,
        permissions,
        type
      };
      await new RoleModel(entry_data).save();
    }
  } else {
    // Delete entry if existing, ignore otherwise
    await RoleModel.deleteOne({ name, type });
  }

  res.redirect('/admin/manage_roles');
}

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const fsp = fs.promises;
const LOGS_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_LEVELS = ['debug', 'notice', 'warning', 'error'];
const MAX_LOG_ENTRIES = 1000;
const HTML_DIRECTORY = path.resolve(__dirname, '..', 'public', 'html');
const HTML_FILE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const FEEDBACK_STATUSES = new Set(['success', 'error', 'info']);
const htmlDateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const API_DEBUG_TIME_FILTERS = [
  { value: '1h', label: 'Last hour', durationMs: 60 * 60 * 1000 },
  { value: '6h', label: 'Last 6 hours', durationMs: 6 * 60 * 60 * 1000 },
  { value: '12h', label: 'Last 12 hours', durationMs: 12 * 60 * 60 * 1000 },
  { value: '24h', label: 'Last 24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { value: '3d', label: 'Last 3 days', durationMs: 3 * 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Last 7 days', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: 'Last 30 days', durationMs: 30 * 24 * 60 * 60 * 1000 },
  { value: 'all', label: 'All time', durationMs: null },
];
const apiDebugTimeFilterMap = API_DEBUG_TIME_FILTERS.reduce((acc, option) => {
  acc[option.value] = option;
  return acc;
}, {});
const DB_FEEDBACK_STATUSES = new Set(['success', 'error', 'info']);
const DEFAULT_PRUNE_DAYS = 30;
const MIN_PRUNE_DAYS = 1;
const MAX_PRUNE_DAYS = 365;

function normalizeDbStatus(status) {
  const normalized = String(status || '').toLowerCase();
  return DB_FEEDBACK_STATUSES.has(normalized) ? normalized : null;
}

function parseDatabaseUsageFeedback(query) {
  const normalizedStatus = normalizeDbStatus(query.status);
  const message = normalizedStatus ? String(query.message || '') : '';
  return {
    feedbackStatus: message ? normalizedStatus : null,
    feedbackMessage: message || null,
  };
}

function redirectDatabaseUsageWithFeedback(res, status, message) {
  const normalizedStatus = normalizeDbStatus(status) || 'info';
  const text = message ? String(message) : '';
  const location = `/admin/database_usage?status=${encodeURIComponent(normalizedStatus)}${text ? `&message=${encodeURIComponent(text)}` : ''}`;
  return res.redirect(location);
}

function getLogFiles() {
  if (!fs.existsSync(LOGS_DIR)) {
    return [];
  }

  return fs.readdirSync(LOGS_DIR)
    .filter((file) => file.endsWith('.log'))
    .map((file) => {
      const filePath = path.join(LOGS_DIR, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        mtime: stats.mtime,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function sanitizeFileName(fileName) {
  if (!fileName) {
    return null;
  }

  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return null;
  }

  return fileName;
}

function readLogEntries(fileName, limit = MAX_LOG_ENTRIES) {
  const filePath = path.join(LOGS_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error('Log file not found.');
  }

  const fileContents = fs.readFileSync(filePath, 'utf8');
  const lines = fileContents.split(/\r?\n/).filter(Boolean);
  const entries = [];

  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      entries.push(parsed);
    } catch (err) {
      continue;
    }
  }

  return entries;
}

function getCategoryOptions(entries) {
  const categories = new Set();
  let hasUncategorized = false;

  entries.forEach((entry) => {
    if (entry && entry.category) {
      categories.add(entry.category);
    } else {
      hasUncategorized = true;
    }
  });

  return {
    categories: Array.from(categories).sort((a, b) => a.localeCompare(b)),
    hasUncategorized,
  };
}

function filterEntries(entries, filters) {
  return entries.filter((entry) => {
    if (!entry) {
      return false;
    }

    const level = (entry.level || '').toLowerCase();
    if (filters.level !== 'all' && level !== filters.level) {
      return false;
    }

    if (filters.category === 'all') {
      return true;
    }

    if (filters.category === 'uncategorized') {
      return !entry.category;
    }

    return entry.category === filters.category;
  });
}

function renderLogViewer(req, res, { selectedFile: overrideFile, strict = false, template = 'app_logs' } = {}) {
  try {
    const files = getLogFiles();
    const fileNames = files.map((file) => file.name);
    const requestedFile = overrideFile || req.query.file;
    let selectedFile = sanitizeFileName(requestedFile);

    if (requestedFile && !selectedFile) {
      if (strict) {
        return res.status(400).render('error_page', { error: 'Invalid file name.' });
      }
      selectedFile = null;
    }

    if (selectedFile && !fileNames.includes(selectedFile)) {
      if (strict) {
        return res.status(404).render('error_page', { error: 'Log file not found.' });
      }
      selectedFile = null;
    }

    if (!selectedFile && files.length > 0) {
      selectedFile = files[0].name;
    }

    const requestedLevel = (req.query.level || 'all').toLowerCase();
    const filters = {
      level: LOG_LEVELS.includes(requestedLevel) ? requestedLevel : 'all',
      category: req.query.category && req.query.category !== '' ? req.query.category : 'all',
    };

    let entries = [];
    let categories = [];
    let hasUncategorized = false;

    if (selectedFile) {
      const rawEntries = readLogEntries(selectedFile);
      const categoryData = getCategoryOptions(rawEntries);
      categories = categoryData.categories;
      hasUncategorized = categoryData.hasUncategorized;
      entries = filterEntries(rawEntries, filters);
    }

    return res.render(template, {
      files,
      selectedFile,
      entries,
      levels: LOG_LEVELS,
      filters,
      categories,
      hasUncategorized,
      formAction: '/admin/app_logs',
    });
  } catch (error) {
    logger.error('Failed to render log viewer', { category: 'admin_logs', metadata: { error } });
    return res.status(500).render('error_page', { error: `Error loading logs: ${error.message}` });
  }
}

exports.app_logs = (req, res) => renderLogViewer(req, res, { template: 'app_logs' });

exports.log_file = (req, res) => renderLogViewer(req, res, { selectedFile: req.params.file, strict: true, template: 'log_file' });

exports.delete_log_file = (req, res) => {
  try {
    const filename = sanitizeFileName(req.params.file);

    if (!filename) {
      return res.status(400).render('error_page', { error: 'Invalid file name.' });
    }

    const allowedFiles = getLogFiles().map((file) => file.name);
    if (!allowedFiles.includes(filename)) {
      return res.status(404).render('error_page', { error: 'File not found.' });
    }

    const filePath = path.join(LOGS_DIR, filename);
    fs.unlinkSync(filePath);

    return res.redirect('/admin/app_logs');
  } catch (error) {
    logger.error('Failed to delete log file', { category: 'admin_logs', metadata: { error } });
    return res.status(500).render('error_page', { error: `Error deleting log file: ${error.message}` });
  }
};

function sanitizeHtmlFileName(rawName) {
  if (!rawName && rawName !== 0) {
    return null;
  }

  const trimmed = String(rawName).trim();
  if (!trimmed) {
    return null;
  }

  const baseName = path.basename(trimmed);
  if (!baseName || baseName.startsWith('.')) {
    return null;
  }

  let normalized = baseName;
  if (!normalized.toLowerCase().endsWith('.html')) {
    normalized = `${normalized}.html`;
  }

  if (!HTML_FILE_NAME_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

async function ensureHtmlDirectory() {
  await fsp.mkdir(HTML_DIRECTORY, { recursive: true });
}

function formatHtmlFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

async function listHtmlFiles() {
  await ensureHtmlDirectory();
  const entries = await fsp.readdir(HTML_DIRECTORY, { withFileTypes: true });
  const htmlEntries = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'));

  const files = await Promise.all(htmlEntries.map(async (entry) => {
    const filePath = path.join(HTML_DIRECTORY, entry.name);
    const stats = await fsp.stat(filePath);
    const modifiedMs = stats.mtime.getTime();

    return {
      name: entry.name,
      href: `/html/${entry.name}`,
      size: formatHtmlFileSize(stats.size),
      modified: htmlDateFormatter.format(stats.mtime),
      modifiedMs,
    };
  }));

  return files.sort((a, b) => {
    if (b.modifiedMs !== a.modifiedMs) {
      return b.modifiedMs - a.modifiedMs;
    }
    return a.name.localeCompare(b.name);
  });
}

function withAverageRating(entry) {
  if (!entry) {
    return null;
  }
  return {
    ...entry,
    averageRating: computeAverageRating(entry.ratings),
  };
}

async function bumpHtmlPageVersion(fileName) {
  if (!fileName) {
    return;
  }
  try {
    const existing = await HtmlPageRating.findOne({ filename: fileName }).exec();
    if (!existing) {
      await HtmlPageRating.create({ filename: fileName, version: 1 });
      return;
    }
    const currentVersion = Number.isFinite(existing.version) ? existing.version : 0;
    existing.version = Math.max(currentVersion + 1, 1);
    await existing.save();
  } catch (error) {
    logger.warning('Unable to update HTML page metadata entry', {
      category: 'admin_html',
      metadata: { fileName, error: error.message },
    });
  }
}

function buildRatingUpdatePayload(body) {
  const ratings = {};
  HTML_RATING_CATEGORIES.forEach(({ key }) => {
    const ratingValue = parseRatingValue(body[`rating_${key}`]);
    ratings[key] = ratingValue;
  });
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : '';
  const isPublic = body.isPublic === 'on' || body.isPublic === 'true';
  return { ratings, notes, isPublic };
}

function redirectWithFeedback(res, status, message) {
  const normalizedStatus = FEEDBACK_STATUSES.has(status) ? status : 'info';
  const text = message ? String(message) : '';
  const location = `/admin/html-pages?status=${encodeURIComponent(normalizedStatus)}${text ? `&message=${encodeURIComponent(text)}` : ''}`;
  return res.redirect(location);
}

exports.html_pages = async (req, res) => {
  try {
    const [files, ratingDocs] = await Promise.all([
      listHtmlFiles(),
      HtmlPageRating.find({}).lean().exec(),
    ]);
    const ratingMap = new Map(ratingDocs.map((entry) => [entry.filename, withAverageRating(entry)]));
    const filesWithRatings = files.map((file) => ({
      ...file,
      ratingEntry: ratingMap.get(file.name) || null,
    }));
    const detachedRatings = ratingDocs
      .filter((entry) => !files.some((file) => file.name === entry.filename))
      .map((entry) => withAverageRating(entry));
    const statusParam = String(req.query.status || '').toLowerCase();
    const tentativeStatus = FEEDBACK_STATUSES.has(statusParam) ? statusParam : null;
    const messageParam = tentativeStatus ? String(req.query.message || '') : '';
    const feedbackStatus = messageParam ? tentativeStatus : null;
    const feedbackMessage = messageParam || null;

    return res.render('admin_html_pages', {
      files: filesWithRatings,
      detachedRatings,
      ratingCategories: HTML_RATING_CATEGORIES,
      feedbackStatus,
      feedbackMessage,
    });
  } catch (error) {
    logger.error('Failed to load HTML content manager', { category: 'admin_html', metadata: { error: error.message } });
    res.status(500);
    return res.render('admin_html_pages', {
      files: [],
      detachedRatings: [],
      ratingCategories: HTML_RATING_CATEGORIES,
      feedbackStatus: 'error',
      feedbackMessage: 'Unable to read the HTML content directory.',
    });
  }
};

exports.create_html_page_from_text = async (req, res) => {
  const fileNameInput = req.body.fileName;
  const htmlContent = typeof req.body.htmlContent === 'string' ? req.body.htmlContent : '';

  const sanitizedName = sanitizeHtmlFileName(fileNameInput);
  if (!sanitizedName) {
    return redirectWithFeedback(res, 'error', 'Please provide a valid filename (letters, numbers, dot, dash, underscore).');
  }

  if (!htmlContent.trim()) {
    return redirectWithFeedback(res, 'error', 'HTML content cannot be empty.');
  }

  try {
    await ensureHtmlDirectory();
    const filePath = path.join(HTML_DIRECTORY, sanitizedName);
    await fsp.writeFile(filePath, htmlContent, 'utf8');
    await bumpHtmlPageVersion(sanitizedName);
    return redirectWithFeedback(res, 'success', `Saved ${sanitizedName}.`);
  } catch (error) {
    logger.error('Failed to save HTML content from textarea', { category: 'admin_html', metadata: { file: sanitizedName, error: error.message } });
    return redirectWithFeedback(res, 'error', `Failed to save ${sanitizedName}: ${error.message}`);
  }
};

exports.create_html_page_from_file = async (req, res) => {
  if (!req.file) {
    return redirectWithFeedback(res, 'error', 'Please select an HTML file to upload.');
  }

  const fallbackName = req.file.originalname ? path.basename(req.file.originalname) : '';
  const providedName = req.body.uploadFileName || fallbackName;
  const sanitizedName = sanitizeHtmlFileName(providedName);

  if (!sanitizedName) {
    return redirectWithFeedback(res, 'error', 'Please provide a valid filename (letters, numbers, dot, dash, underscore).');
  }

  if (!req.file.buffer || req.file.buffer.length === 0) {
    return redirectWithFeedback(res, 'error', 'The uploaded file is empty.');
  }

  try {
    await ensureHtmlDirectory();
    const filePath = path.join(HTML_DIRECTORY, sanitizedName);
    await fsp.writeFile(filePath, req.file.buffer.toString('utf8'), 'utf8');
    await bumpHtmlPageVersion(sanitizedName);
    return redirectWithFeedback(res, 'success', `Uploaded ${sanitizedName}.`);
  } catch (error) {
    logger.error('Failed to process uploaded HTML file', { category: 'admin_html', metadata: { file: sanitizedName, error: error.message } });
    return redirectWithFeedback(res, 'error', `Failed to upload ${sanitizedName}: ${error.message}`);
  }
};

exports.delete_html_page = async (req, res) => {
  const sanitizedName = sanitizeHtmlFileName(req.body.file);
  if (!sanitizedName) {
    return redirectWithFeedback(res, 'error', 'Invalid filename supplied.');
  }

  const targetPath = path.join(HTML_DIRECTORY, sanitizedName);

  try {
    await ensureHtmlDirectory();
    await fsp.unlink(targetPath);
    try {
      await HtmlPageRating.deleteOne({ filename: sanitizedName });
    } catch (metadataError) {
      logger.warning('Failed to remove HTML rating entry after file delete', {
        category: 'admin_html',
        metadata: { file: sanitizedName, error: metadataError.message },
      });
    }
    return redirectWithFeedback(res, 'success', `Deleted ${sanitizedName}.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return redirectWithFeedback(res, 'error', `${sanitizedName} was not found.`);
    }

    logger.error('Failed to delete HTML file', { category: 'admin_html', metadata: { file: sanitizedName, error: error.message } });
    return redirectWithFeedback(res, 'error', `Failed to delete ${sanitizedName}: ${error.message}`);
  }
};

exports.update_html_page_rating = async (req, res) => {
  const sanitizedName = sanitizeHtmlFileName(req.body.filename);
  if (!sanitizedName) {
    return redirectWithFeedback(res, 'error', 'Please select a valid entry to rate.');
  }

  const { ratings, notes, isPublic } = buildRatingUpdatePayload(req.body);
  try {
    await HtmlPageRating.findOneAndUpdate(
      { filename: sanitizedName },
      {
        $set: {
          filename: sanitizedName,
          ratings,
          notes,
          isPublic,
        },
        $setOnInsert: { version: 1 },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return redirectWithFeedback(res, 'success', `Saved rating details for ${sanitizedName}.`);
  } catch (error) {
    logger.error('Failed to update HTML rating entry', { category: 'admin_html', metadata: { file: sanitizedName, error: error.message } });
    return redirectWithFeedback(res, 'error', `Unable to save rating for ${sanitizedName}.`);
  }
};

exports.openai_usage = async (req, res) => {
  const entries = await OpenAIUsage.find().sort({ entry_date: 1 }).lean().exec();

  const monthMap = new Map();
  const modelMetrics = {
    completions: {},
    embeddings: {},
    images: {},
    speeches: {},
    transcriptions: {},
  };

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const getRequestsValue = (entry) => {
    const keys = ['num_model_requests', 'request_count', 'num_requests', 'count'];
    for (const key of keys) {
      if (typeof entry[key] === 'number') {
        return entry[key];
      }
    }
    return 1;
  };

  const getTokenValue = (entry) => {
    const tokenFields = ['total_tokens', 'tokens'];
    let total = 0;
    for (const field of tokenFields) {
      if (typeof entry[field] === 'number') {
        total += entry[field];
      }
    }
    if (typeof entry.input_tokens === 'number') {
      total += entry.input_tokens;
    }
    if (typeof entry.output_tokens === 'number') {
      total += entry.output_tokens;
    }
    if (typeof entry.cached_tokens === 'number') {
      total += entry.cached_tokens;
    }
    if (typeof entry.input_cached_tokens === 'number') {
      total += entry.input_cached_tokens;
    }
    return total;
  };

  const accumulateMetric = (bucket, item) => {
    const model = item.model || 'unknown';
    if (!bucket[model]) {
      bucket[model] = { requests: 0, tokens: 0 };
    }
    bucket[model].requests += getRequestsValue(item);
    bucket[model].tokens += getTokenValue(item);
  };

  entries.forEach((entry) => {
    const monthKey = (entry.entry_date || '').slice(0, 7);
    if (!monthKey) {
      return;
    }

    if (!monthMap.has(monthKey)) {
      const [yearStr, monthStr] = monthKey.split('-');
      const monthIndex = Math.max(0, Math.min(11, (parseInt(monthStr, 10) || 1) - 1));
      monthMap.set(monthKey, {
        month: monthKey,
        label: `${MONTH_NAMES[monthIndex]} ${yearStr}`,
        totalCost: 0,
        dailyEntries: [],
      });
    }

    const monthBucket = monthMap.get(monthKey);
    monthBucket.totalCost += entry.cost || 0;
    monthBucket.dailyEntries.push({
      date: entry.entry_date,
      cost: entry.cost || 0,
      completions: entry.completions || [],
      embeddings: entry.embeddings || [],
      images: entry.images || [],
      speeches: entry.speeches || [],
      transcriptions: entry.transcriptions || [],
    });

    (entry.completions || []).forEach((item) => accumulateMetric(modelMetrics.completions, item));
    (entry.embeddings || []).forEach((item) => accumulateMetric(modelMetrics.embeddings, item));
    (entry.images || []).forEach((item) => accumulateMetric(modelMetrics.images, item));
    (entry.speeches || []).forEach((item) => accumulateMetric(modelMetrics.speeches, item));
    (entry.transcriptions || []).forEach((item) => accumulateMetric(modelMetrics.transcriptions, item));
  });

  const monthlyTimeline = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ month, label, totalCost }) => ({ month, label, totalCost }));

  const monthlyCards = Array.from(monthMap.values())
    .map((monthData) => ({
      ...monthData,
      dailyEntries: monthData.dailyEntries.sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  const usageMetrics = Object.entries(modelMetrics).map(([key, metrics]) => {
    const models = Object.entries(metrics).map(([model, values]) => ({
      model,
      requests: values.requests,
      tokens: values.tokens,
    })).sort((a, b) => {
      if (b.requests === a.requests) {
        return b.tokens - a.tokens;
      }
      return b.requests - a.requests;
    });

    if (models.length === 0) {
      return null;
    }

    const [top] = models;
    const labelMap = {
      completions: 'Completions',
      embeddings: 'Embeddings',
      images: 'Images',
      speeches: 'Speech',
      transcriptions: 'Transcription',
    };

    return {
      key,
      label: labelMap[key] || key,
      topModel: top.model,
      topModelRequests: top.requests,
      topModelTokens: top.tokens,
      models,
    };
  }).filter(Boolean);

  res.render('openai_usage', {
    monthlyTimeline,
    monthlyCards,
    usageMetrics,
  });
};

exports.api_debug_logs = async (req, res) => {
  const query = req.query || {};
  const fileFilter = query.file || '';
  const functionFilter = query.function || '';
  const requestedTimeRange = query.timeRange;
  const DEFAULT_TIME_RANGE = '1h';
  const selectedTimeRange = apiDebugTimeFilterMap[requestedTimeRange] ? requestedTimeRange : DEFAULT_TIME_RANGE;
  const selectedTimeRangeConfig = apiDebugTimeFilterMap[selectedTimeRange];
  const filter = {};
  const LIMIT = 200;

  if (fileFilter) {
    filter.jsFileName = fileFilter;
  }
  if (functionFilter) {
    filter.functionName = functionFilter;
  }
  if (selectedTimeRangeConfig.durationMs) {
    filter.createdAt = {
      $gte: new Date(Date.now() - selectedTimeRangeConfig.durationMs),
    };
  }

  const formatPayload = (payload) => {
    if (payload === null || payload === undefined) {
      return 'null';
    }
    try {
      return JSON.stringify(payload, null, 2);
    } catch (error) {
      return `Unable to serialize payload: ${error.message}`;
    }
  };

  const [logEntries, fileNames, functionNames] = await Promise.all([
    ApiDebugLog.find(filter).sort({ createdAt: -1 }).limit(LIMIT).lean(),
    ApiDebugLog.distinct('jsFileName'),
    ApiDebugLog.distinct('functionName'),
  ]);

  fileNames.sort();
  functionNames.sort();

  const logs = logEntries.map((entry) => ({
    ...entry,
    formattedCreatedAt: entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown',
    requestHeadersFormatted: formatPayload(entry.requestHeaders),
    requestBodyFormatted: formatPayload(entry.requestBody),
    responseHeadersFormatted: formatPayload(entry.responseHeaders),
    responseBodyFormatted: formatPayload(entry.responseBody),
  }));

  res.render('api_debug_logs', {
    logs,
    limit: LIMIT,
    filters: {
      jsFileName: fileFilter,
      functionName: functionFilter,
      timeRange: selectedTimeRange,
      defaultTimeRange: DEFAULT_TIME_RANGE,
      activeTimeRangeLabel: selectedTimeRangeConfig.label,
      timeRanges: API_DEBUG_TIME_FILTERS,
      jsFileNames: fileNames,
      functionNames,
    },
  });
};

exports.database_usage = async (req, res) => {
  const feedback = parseDatabaseUsageFeedback(req.query || {});
  const pruneDefaults = {
    maxAgeDays: DEFAULT_PRUNE_DAYS,
  };
  try {
    const usage = await databaseUsageService.fetchDatabaseUsage();
    const { dbStats, collectionStats, generatedAt } = usage;
    const validCollections = Array.isArray(collectionStats)
      ? collectionStats.filter((collection) => !collection.error)
      : [];
    const totalStorageBytes = dbStats?.storageSizeBytes || 0;
    const documentTotal = validCollections.reduce((sum, collection) => sum + (collection.count || 0), 0);
    const sortedCollections = [...validCollections].sort(
      (a, b) => (b.storageSizeBytes || 0) - (a.storageSizeBytes || 0),
    );
    const apiDebugCollectionName = ApiDebugLog?.collection?.collectionName;
    const apiDebugCollection = sortedCollections.find(
      (collection) => collection.name === apiDebugCollectionName,
    ) || sortedCollections.find(
      (collection) => typeof collection.name === 'string' && collection.name.includes('api_debug'),
    );
    const topCollections = sortedCollections.slice(0, 8).map((collection) => {
      const percent = calculatePercent(totalStorageBytes, collection.storageSizeBytes || 0);
      return {
        name: collection.name,
        documents: collection.count || 0,
        documentsDisplay: formatNumber(collection.count || 0),
        storageSizeDisplay: formatBytes(collection.storageSizeBytes || 0),
        percent,
        percentDisplay: formatPercent(percent),
      };
    });
    const collectionRows = sortedCollections.map((collection) => {
      const percent = calculatePercent(totalStorageBytes, collection.storageSizeBytes || 0);
      return {
        name: collection.name,
        documentsDisplay: formatNumber(collection.count || 0),
        storageSizeDisplay: formatBytes(collection.storageSizeBytes || 0),
        dataSizeDisplay: formatBytes(collection.sizeBytes || 0),
        indexSizeDisplay: formatBytes(collection.totalIndexSizeBytes || 0),
        avgObjSizeDisplay: collection.avgObjSizeBytes ? formatBytes(collection.avgObjSizeBytes) : '—',
        percentDisplay: formatPercent(percent),
      };
    });
    const overviewCards = [
      {
        label: 'Storage Size',
        value: formatBytes(dbStats?.storageSizeBytes || 0),
        helper: 'Allocated bytes including padding',
      },
      {
        label: 'Data Size',
        value: formatBytes(dbStats?.dataSizeBytes || 0),
        helper: 'Actual data stored in collections',
      },
      {
        label: 'Index Size',
        value: formatBytes(dbStats?.indexSizeBytes || 0),
        helper: 'Combined size of all indexes',
      },
      {
        label: 'Collections',
        value: formatNumber(dbStats?.collections || validCollections.length),
        helper: 'User-owned MongoDB collections',
      },
      {
        label: 'Documents',
        value: formatNumber(dbStats?.objects || documentTotal),
        helper: 'Sum of documents across collections',
      },
    ];
    const evaluatedAlerts = databaseUsageService.evaluateAlerts(usage, {
      collectionHints: { apiDebugCollectionName },
    });
    const alerts = evaluatedAlerts.map((alert) => {
      if (alert.type === 'totalStorage') {
        return {
          level: alert.level || 'warning',
          message: `Database storage usage is ${formatBytes(alert.actualBytes)}, above the ${formatBytes(alert.thresholdBytes)} threshold.`,
        };
      }
      if (alert.type === 'apiDebug') {
        const share = calculatePercent(alert.totalStorageBytes || totalStorageBytes, alert.actualBytes || 0);
        return {
          level: alert.level || 'info',
          message: `${alert.collectionName || 'api_debug_log'} is using ${formatBytes(alert.actualBytes || 0)} (${formatPercent(share)}) which exceeds the ${formatBytes(alert.thresholdBytes)} limit.`,
        };
      }
      return {
        level: alert.level || 'info',
        message: 'Database alert triggered.',
      };
    });

    res.render('database_usage', {
      generatedAt,
      generatedAtDisplay: (generatedAt || new Date()).toLocaleString(),
      overviewCards,
      topCollections,
      collectionRows,
      apiDebugCollection: apiDebugCollection
        ? {
            name: apiDebugCollection.name,
            documentsDisplay: formatNumber(apiDebugCollection.count || 0),
            storageSizeDisplay: formatBytes(apiDebugCollection.storageSizeBytes || 0),
            dataSizeDisplay: formatBytes(apiDebugCollection.sizeBytes || 0),
            indexSizeDisplay: formatBytes(apiDebugCollection.totalIndexSizeBytes || 0),
            percentDisplay: formatPercent(calculatePercent(totalStorageBytes, apiDebugCollection.storageSizeBytes || 0)),
          }
        : null,
      alerts,
      feedbackStatus: feedback.feedbackStatus,
      feedbackMessage: feedback.feedbackMessage,
      pruneDefaults,
    });
  } catch (error) {
    logger.error('Failed to load database usage dashboard', {
      category: 'admin_database_usage',
      metadata: { error: error.message },
    });
    res.render('database_usage', {
      loadError: 'Unable to load database statistics right now.',
      feedbackStatus: feedback.feedbackStatus,
      feedbackMessage: feedback.feedbackMessage,
      pruneDefaults,
    });
  }
};

exports.prune_api_debug_logs = async (req, res) => {
  const rawDays = req.body?.maxAgeDays;
  const days = Number.parseInt(rawDays, 10);
  if (!Number.isFinite(days) || days < MIN_PRUNE_DAYS || days > MAX_PRUNE_DAYS) {
    return redirectDatabaseUsageWithFeedback(
      res,
      'error',
      `Enter a value between ${MIN_PRUNE_DAYS} and ${MAX_PRUNE_DAYS} days.`,
    );
  }

  const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const result = await ApiDebugLog.deleteMany({ createdAt: { $lt: cutoffDate } });
    logger.notice('API debug logs pruned by admin', {
      category: 'admin_database_usage',
      metadata: {
        days,
        cutoff: cutoffDate.toISOString(),
        deletedCount: result.deletedCount,
      },
    });
    return redirectDatabaseUsageWithFeedback(
      res,
      'success',
      `Removed ${formatNumber(result.deletedCount || 0)} logs older than ${days} day(s).`,
    );
  } catch (error) {
    logger.error('Failed to prune API debug logs', {
      category: 'admin_database_usage',
      metadata: { error: error.message },
    });
    return redirectDatabaseUsageWithFeedback(
      res,
      'error',
      'Unable to prune API debug logs right now.',
    );
  }
};

