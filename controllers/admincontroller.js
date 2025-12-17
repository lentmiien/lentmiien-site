const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');
const { UseraccountModel, RoleModel, OpenAIUsage, ApiDebugLog, HtmlPageRating } = require('../database');
const { HTML_RATING_CATEGORIES, parseRatingValue, computeAverageRating } = require('../utils/htmlRatings');
const databaseUsageService = require('../services/databaseUsageService');
const { formatBytes, formatNumber, formatPercent, calculatePercent } = require('../utils/metricsFormatter');
const EmbeddingApiService = require('../services/embeddingApiService');

const locked_user_id = "5dd115006b7f671c2009709d";

const routes = [
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
  "asr",
  "test",
  "archive",
];

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
    routes
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
const TEMP_AUDIO_DIR = path.resolve(__dirname, '..', 'public', 'temp');
const JS_FILE_NAME = 'controllers/admincontroller.js';
const recordApiDebugLog = createApiDebugLogger(JS_FILE_NAME);
const embeddingApiService = new EmbeddingApiService();
const EMBEDDING_TEST_MAX_TEXTS = 10;
const EMBEDDING_DEFAULT_OVERLAP = 32;
const EMBEDDING_SPLIT_MODES = ['single', 'lines'];
const EMBEDDING_SEARCH_DEFAULT_TOP_K = 10;
const EMBEDDING_SEARCH_MAX_TOP_K = 50;
const EMBEDDING_RECENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const EMBEDDING_RECENT_FETCH_LIMIT = 500;
const EMBEDDING_CHUNK_SAMPLE_LIMIT = 5;
const EMBEDDING_SEARCH_TYPES = [
  { value: 'default', label: 'Fast (default)' },
  { value: 'high_quality', label: 'High-quality model' },
  { value: 'combined', label: 'Combined (rerank with high-quality)' },
];
const EMBEDDING_SEARCH_TYPE_MAP = EMBEDDING_SEARCH_TYPES.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});
const EMBEDDING_DEFAULT_SEARCH_TYPE = EMBEDDING_SEARCH_TYPES[0].value;
const ASR_API_BASE = process.env.ASR_API_BASE || 'http://192.168.0.20:8010';
const ASR_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const ASR_DEFAULT_FORM = Object.freeze({
  language: 'auto',
  task: 'transcribe',
  vadFilter: true,
  beamSize: 5,
  temperature: 1.0,
  wordTimestamps: false,
});
const TTS_API_BASE = process.env.TTS_API_BASE || 'http://192.168.0.20:8080';
const TOKENS_PER_500_CHARS = 1024;
const MAX_NEW_TOKENS_DEFAULT = 1024;
const MAX_NEW_TOKENS_MIN = 1;
const MAX_NEW_TOKENS_MAX = 8192;
const TTS_JOB_RETENTION_MS = 60 * 60 * 1000; // 1 hour
const ttsJobs = new Map();
const TTS_KEYWORDS = {
  basicEmotions: [
    '(angry)', '(sad)', '(excited)', '(surprised)', '(satisfied)', '(delighted)',
    '(scared)', '(worried)', '(upset)', '(nervous)', '(frustrated)', '(depressed)',
    '(empathetic)', '(embarrassed)', '(disgusted)', '(moved)', '(proud)', '(relaxed)',
    '(grateful)', '(confident)', '(interested)', '(curious)', '(confused)', '(joyful)',
  ],
  advancedEmotions: [
    '(disdainful)', '(unhappy)', '(anxious)', '(hysterical)', '(indifferent)',
    '(impatient)', '(guilty)', '(scornful)', '(panicked)', '(furious)', '(reluctant)',
    '(keen)', '(disapproving)', '(negative)', '(denying)', '(astonished)', '(serious)',
    '(sarcastic)', '(conciliative)', '(comforting)', '(sincere)', '(sneering)',
    '(hesitating)', '(yielding)', '(painful)', '(awkward)', '(amused)',
  ],
  toneMarkers: [
    '(in a hurry tone)', '(shouting)', '(screaming)', '(whispering)', '(soft tone)',
  ],
  audioEffects: [
    '(laughing)', '(chuckling)', '(sobbing)', '(crying loudly)', '(sighing)', '(panting)',
    '(groaning)', '(crowd laughing)', '(background laughter)', '(audience laughing)',
  ],
};

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

async function fetchEmbeddingHealth() {
  try {
    const health = await embeddingApiService.health();
    return { health, healthError: null };
  } catch (error) {
    return {
      health: null,
      healthError: error?.message || 'Unable to reach the embedding API.',
    };
  }
}

function defaultEmbeddingForm() {
  return {
    text: '',
    splitMode: 'single',
    autoChunk: true,
    maxTokensPerChunk: '',
    overlapTokens: EMBEDDING_DEFAULT_OVERLAP,
  };
}

function normalizeEmbeddingForm(form = {}) {
  const maxTokensRaw = form?.maxTokensPerChunk;
  const overlapRaw = form?.overlapTokens;
  const maxTokensParsed = Number.parseInt(maxTokensRaw, 10);
  const overlapParsed = Number.parseInt(overlapRaw, 10);

  return {
    text: typeof form?.text === 'string' ? form.text : '',
    splitMode: EMBEDDING_SPLIT_MODES.includes(form?.splitMode) ? form.splitMode : 'single',
    autoChunk: form?.autoChunk !== false,
    maxTokensPerChunk: Number.isFinite(maxTokensParsed) && maxTokensParsed > 0 ? maxTokensParsed : (maxTokensRaw === null ? null : ''),
    overlapTokens: Number.isFinite(overlapParsed) && overlapParsed >= 0
      ? overlapParsed
      : overlapRaw === '' ? '' : EMBEDDING_DEFAULT_OVERLAP,
  };
}

function normalizeSearchType(raw) {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (EMBEDDING_SEARCH_TYPE_MAP[value]) {
    return value;
  }
  return EMBEDDING_DEFAULT_SEARCH_TYPE;
}

function normalizeSearchForm(form = {}) {
  const query = typeof form?.query === 'string'
    ? form.query
    : typeof form?.searchText === 'string'
      ? form.searchText
      : typeof form?.search_text === 'string'
        ? form.search_text
        : '';
  const startDate = typeof form?.startDate === 'string'
    ? form.startDate
    : typeof form?.start_date === 'string'
      ? form.start_date
      : '';
  const endDate = typeof form?.endDate === 'string'
    ? form.endDate
    : typeof form?.end_date === 'string'
      ? form.end_date
      : '';

  const rawTopK = form?.topK ?? form?.top_k ?? form?.searchTopK ?? form?.search_top_k;
  const parsedTopK = Number.parseInt(rawTopK, 10);
  const topK = Number.isFinite(parsedTopK) && parsedTopK > 0
    ? Math.min(parsedTopK, EMBEDDING_SEARCH_MAX_TOP_K)
    : EMBEDDING_SEARCH_DEFAULT_TOP_K;
  const searchType = normalizeSearchType(form?.searchType ?? form?.search_type ?? form?.mode);

  return {
    query,
    topK,
    searchType,
    startDate,
    endDate,
  };
}

function buildSearchDateRange(startRaw, endRaw) {
  const parseDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return 'invalid';
    }
    return parsed;
  };

  const start = parseDate(startRaw);
  if (start === 'invalid') {
    return { error: 'Invalid start date. Please use YYYY-MM-DD.' };
  }
  const end = parseDate(endRaw);
  if (end === 'invalid') {
    return { error: 'Invalid end date. Please use YYYY-MM-DD.' };
  }

  if (start) {
    start.setUTCHours(0, 0, 0, 0);
  }
  if (end) {
    end.setUTCHours(23, 59, 59, 999);
  }

  if (start && end && start > end) {
    return { error: 'Start date must be before or equal to end date.' };
  }

  return { start, end };
}

function parseEmbeddingTexts(rawText, splitMode) {
  const normalizedText = (rawText || '').replace(/\r\n/g, '\n');
  if (splitMode === 'lines') {
    return normalizedText.split('\n').map((t) => t.trim()).filter(Boolean);
  }
  const single = normalizedText.trim();
  return single ? [single] : [];
}

function parsePositiveInt(raw, fieldLabel) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: undefined };
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { error: `${fieldLabel} must be a positive number or left blank.` };
  }
  return { value: parsed };
}

function parseNonNegativeInt(raw, fieldLabel) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: undefined };
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { error: `${fieldLabel} must be zero or a positive number.` };
  }
  return { value: parsed };
}

function buildSourceKey(source = {}) {
  return [
    source.collectionName || '',
    source.documentId || '',
    source.contentType || '',
    source.parentCollection || '',
    source.parentId || '',
  ].join('::');
}

function resolveStorageMode(mode) {
  const normalized = normalizeSearchType(mode);
  if (normalized === 'high_quality') {
    return 'high_quality';
  }
  return 'default';
}

function normalizeDeleteSource(body = {}) {
  const source = {
    collectionName: typeof body.collectionName === 'string'
      ? body.collectionName.trim()
      : typeof body['source.collectionName'] === 'string'
        ? body['source.collectionName'].trim()
        : '',
    documentId: typeof body.documentId === 'string'
      ? body.documentId.trim()
      : typeof body.document_id === 'string'
        ? body.document_id.trim()
        : '',
    contentType: typeof body.contentType === 'string'
      ? body.contentType.trim()
      : typeof body.content_type === 'string'
        ? body.content_type.trim()
        : '',
    parentCollection: typeof body.parentCollection === 'string'
      ? body.parentCollection.trim()
      : typeof body.parent_collection === 'string'
        ? body.parent_collection.trim()
        : '',
    parentId: typeof body.parentId === 'string'
      ? body.parentId.trim()
      : typeof body.parent_id === 'string'
        ? body.parent_id.trim()
        : '',
  };

  if (!source.collectionName || !source.documentId || !source.contentType) {
    return { error: 'Source, document, and content type are required to delete embeddings.' };
  }

  if (!source.parentCollection) {
    source.parentCollection = null;
  }
  if (!source.parentId) {
    source.parentId = null;
  }

  return { source };
}

function groupEmbeddingDocs(docs = [], { mode = EMBEDDING_DEFAULT_SEARCH_TYPE, chunkLimit = EMBEDDING_CHUNK_SAMPLE_LIMIT } = {}) {
  const groups = new Map();
  docs.forEach((doc) => {
    const key = buildSourceKey(doc?.source || {});
    if (!key) return;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        mode,
        source: doc?.source || {},
        chunkCount: 0,
        chunks: [],
        models: new Set(),
        dim: doc?.dim || null,
        textLength: 0,
        latestCreatedAt: null,
        latestUpdatedAt: null,
        previewText: '',
      });
    }
    const group = groups.get(key);
    group.chunkCount += 1;
    if (doc?.model) {
      group.models.add(doc.model);
    }
    if (doc?.dim && !group.dim) {
      group.dim = doc.dim;
    }
    group.textLength += doc?.textLength || 0;
    if (!group.previewText && doc?.previewText) {
      group.previewText = doc.previewText;
    }

    const createdAt = doc?.createdAt ? new Date(doc.createdAt) : null;
    const updatedAt = doc?.updatedAt ? new Date(doc.updatedAt) : null;
    if (!group.latestCreatedAt || (createdAt && createdAt > group.latestCreatedAt)) {
      group.latestCreatedAt = createdAt;
    }
    if (!group.latestUpdatedAt || (updatedAt && updatedAt > group.latestUpdatedAt)) {
      group.latestUpdatedAt = updatedAt;
    }

    if (group.chunks.length < chunkLimit) {
      group.chunks.push({
        chunkIndex: doc?.chunk?.chunkIndex ?? 0,
        textIndex: doc?.chunk?.textIndex ?? 0,
        startToken: doc?.chunk?.startToken ?? 0,
        endToken: doc?.chunk?.endToken ?? 0,
        previewText: (doc?.previewText || '').slice(0, 280),
      });
    }
  });

  return Array.from(groups.values())
    .map((entry) => ({
      ...entry,
      models: Array.from(entry.models),
      truncatedChunks: entry.chunkCount > entry.chunks.length,
      latestTimestamp: entry.latestUpdatedAt || entry.latestCreatedAt,
    }))
    .sort((a, b) => {
      const aTime = a.latestTimestamp ? a.latestTimestamp.getTime() : 0;
      const bTime = b.latestTimestamp ? b.latestTimestamp.getTime() : 0;
      return bTime - aTime;
    });
}

async function loadRecentEmbeddings() {
  const since = new Date(Date.now() - EMBEDDING_RECENT_LOOKBACK_MS);
  const modes = ['default', 'high_quality'];
  const result = {};

  for (const mode of modes) {
    try {
      const recent = await embeddingApiService.fetchRecentEmbeddings({
        mode,
        since,
        limit: EMBEDDING_RECENT_FETCH_LIMIT,
      });
      result[mode] = {
        mode,
        label: EMBEDDING_SEARCH_TYPE_MAP[mode] || mode,
        groups: groupEmbeddingDocs(recent.docs, { mode }),
        totalCount: recent.totalCount,
        truncated: recent.truncated,
        since,
      };
    } catch (error) {
      logger.error('Failed to load recent embeddings', {
        category: 'admin_embedding_test',
        metadata: { mode, error: error?.message },
      });
      result[mode] = {
        mode,
        label: EMBEDDING_SEARCH_TYPE_MAP[mode] || mode,
        groups: [],
        totalCount: 0,
        truncated: false,
        since,
        error: error?.message || 'Unable to load recent embeddings.',
      };
    }
  }

  return result;
}

async function performEmbeddingSearch(searchFormInput = {}) {
  const searchForm = normalizeSearchForm(searchFormInput);
  searchForm.query = searchForm.query.trim();
  searchForm.startDate = searchForm.startDate.trim();
  searchForm.endDate = searchForm.endDate.trim();

  if (!searchForm.query) {
    return { form: searchForm, searchForm, error: 'Please enter text to search stored embeddings.' };
  }

  const dateRange = buildSearchDateRange(searchForm.startDate, searchForm.endDate);
  if (dateRange.error) {
    return { form: searchForm, searchForm, error: dateRange.error };
  }

  const searchOptions = { topK: searchForm.topK, dateRange };

  try {
    let result;
    if (searchForm.searchType === 'high_quality') {
      result = await embeddingApiService.similaritySearchHighQuality(searchForm.query, searchOptions);
    } else if (searchForm.searchType === 'combined') {
      result = await embeddingApiService.combinedSimilaritySearch(searchForm.query, searchOptions);
    } else {
      result = await embeddingApiService.similaritySearch(searchForm.query, searchOptions);
    }

    logger.notice('Admin embedding similarity search completed', {
      category: 'admin_embedding_test',
      metadata: {
        queryLength: searchForm.query.length,
        topK: searchForm.topK,
        returned: result?.results?.length || 0,
        searchType: searchForm.searchType,
        mode: result?.mode || null,
        updatedAfter: dateRange.start ? dateRange.start.toISOString() : null,
        updatedBefore: dateRange.end ? dateRange.end.toISOString() : null,
      },
    });

    const storageMode = resolveStorageMode(result?.mode || searchForm.searchType);
    const sources = Array.isArray(result?.results)
      ? result.results
        .map((row) => row?.source)
        .filter((source) => source && source.collectionName && source.documentId && source.contentType)
      : [];
    let hydratedGroups = [];
    if (sources.length) {
      try {
        const docs = await embeddingApiService.fetchEmbeddingsBySources(sources, { mode: storageMode });
        hydratedGroups = groupEmbeddingDocs(docs, { mode: storageMode });
      } catch (error) {
        logger.error('Failed to hydrate embedding search results', {
          category: 'admin_embedding_test',
          metadata: { mode: storageMode, error: error?.message },
        });
      }
    }
    const hydratedLookup = new Map(hydratedGroups.map((entry) => [entry.key, entry]));
    const groupedResults = Array.isArray(result?.results)
      ? result.results.map((row) => {
        const key = buildSourceKey(row?.source || {});
        const baseGroup = hydratedLookup.get(key) || groupEmbeddingDocs([{
          source: row?.source || {},
          chunk: row?.chunk || {},
          previewText: row?.previewText || '',
          model: row?.model || result?.model || null,
          createdAt: row?.createdAt || null,
          updatedAt: row?.updatedAt || null,
          textLength: row?.textLength || 0,
          dim: row?.dim || result?.dim || null,
        }], { mode: storageMode })[0] || null;

        return {
          ...baseGroup,
          key,
          similarity: Number.isFinite(row?.similarity) ? row.similarity : null,
          rerank: row?.rerank || null,
          previewText: row?.previewText || baseGroup?.chunks?.[0]?.previewText || '',
          matchedChunk: row?.chunk || null,
        };
      })
      : [];

    return {
      form: searchForm,
      searchForm,
      result,
      groupedResults,
      error: null,
    };
  } catch (error) {
    let message = error?.message || 'Unable to search embeddings.';

    if (error?.code === 'ETIMEOUT') {
      message = `Embedding API request timed out after ${embeddingApiService.timeoutMs}ms.`;
    }

    logger.error('Admin embedding similarity search failed', {
      category: 'admin_embedding_test',
      metadata: {
        status: error?.status,
        code: error?.code,
        message: error?.message,
        searchType: searchForm.searchType,
      },
    });

    return {
      form: searchForm,
      searchForm,
      error: message,
      status: error?.status || 502,
    };
  }
}

function renderEmbeddingTestPage(res, {
  form,
  result = null,
  error = null,
  info = null,
  submittedTexts = [],
  requestOptions = {},
  health = null,
  healthError = null,
  search = {},
  recentEmbeddings = null,
  deleteFeedback = null,
}) {
  const normalizedForm = normalizeEmbeddingForm(form);
  const normalizedSearchForm = normalizeSearchForm(search?.form || search);
  const searchResult = search?.result
    ? {
      ...search.result,
      modeLabel: search?.result?.mode ? EMBEDDING_SEARCH_TYPE_MAP[search.result.mode] || search.result.mode : null,
    }
    : null;
  const searchGroups = Array.isArray(search?.groupedResults) ? search.groupedResults : [];
  return res.render('admin_embedding_test', {
    form: normalizedForm,
    result,
    error,
    info,
    submittedTexts,
    requestOptions: {
      autoChunk: requestOptions?.autoChunk !== false,
      maxTokensPerChunk: requestOptions?.maxTokensPerChunk,
      overlapTokens: requestOptions?.overlapTokens,
    },
    health,
    healthError,
    apiBase: embeddingApiService.baseUrl,
    highQualityApiBase: embeddingApiService.highQualityBaseUrl,
    maxTexts: EMBEDDING_TEST_MAX_TEXTS,
    defaultOverlap: EMBEDDING_DEFAULT_OVERLAP,
    searchForm: normalizedSearchForm,
    searchResult,
    searchError: search?.error || null,
    searchGroups,
    searchTypes: EMBEDDING_SEARCH_TYPES,
    searchTypeLabels: EMBEDDING_SEARCH_TYPE_MAP,
    searchLimits: {
      defaultTopK: EMBEDDING_SEARCH_DEFAULT_TOP_K,
      maxTopK: EMBEDDING_SEARCH_MAX_TOP_K,
    },
    recentEmbeddings,
    recentHours: EMBEDDING_RECENT_LOOKBACK_MS / (60 * 60 * 1000),
    deleteFeedback,
  });
}

exports.embedding_test_page = async (req, res) => {
  const form = defaultEmbeddingForm();
  const { health, healthError } = await fetchEmbeddingHealth();
  const recentEmbeddings = await loadRecentEmbeddings();

  return renderEmbeddingTestPage(res, {
    form,
    submittedTexts: [],
    requestOptions: { autoChunk: true, overlapTokens: EMBEDDING_DEFAULT_OVERLAP },
    health,
    healthError,
    recentEmbeddings,
  });
};

exports.embedding_test_generate = async (req, res) => {
  const rawText = typeof req.body.text === 'string' ? req.body.text : '';
  const splitMode = req.body.split_mode === 'lines' ? 'lines' : 'single';
  const autoChunk = req.body.auto_chunk !== undefined;
  const maxTokensInput = req.body.max_tokens_per_chunk;
  const overlapTokensInput = req.body.overlap_tokens;
  const { health, healthError } = await fetchEmbeddingHealth();
  const recentEmbeddings = await loadRecentEmbeddings();
  const form = {
    text: rawText,
    splitMode,
    autoChunk,
    maxTokensPerChunk: maxTokensInput,
    overlapTokens: overlapTokensInput,
  };

  const parsedTexts = parseEmbeddingTexts(rawText, splitMode);
  if (!parsedTexts.length) {
    res.status(400);
    return renderEmbeddingTestPage(res, {
      form,
      error: 'Please enter at least one non-empty text to embed.',
      submittedTexts: [],
      requestOptions: { autoChunk, maxTokensPerChunk: maxTokensInput, overlapTokens: overlapTokensInput },
      health,
      healthError,
      recentEmbeddings,
    });
  }

  if (parsedTexts.length > EMBEDDING_TEST_MAX_TEXTS) {
    res.status(400);
    return renderEmbeddingTestPage(res, {
      form,
      error: `Please limit requests to ${EMBEDDING_TEST_MAX_TEXTS} texts or fewer.`,
      submittedTexts: parsedTexts,
      requestOptions: { autoChunk, maxTokensPerChunk: maxTokensInput, overlapTokens: overlapTokensInput },
      health,
      healthError,
      recentEmbeddings,
    });
  }

  const maxTokensResult = parsePositiveInt(maxTokensInput, 'max_tokens_per_chunk');
  if (maxTokensResult.error) {
    res.status(400);
    return renderEmbeddingTestPage(res, {
      form,
      error: maxTokensResult.error,
      submittedTexts: parsedTexts,
      requestOptions: { autoChunk, maxTokensPerChunk: maxTokensInput, overlapTokens: overlapTokensInput },
      health,
      healthError,
      recentEmbeddings,
    });
  }

  const overlapResult = parseNonNegativeInt(overlapTokensInput, 'overlap_tokens');
  if (overlapResult.error) {
    res.status(400);
    return renderEmbeddingTestPage(res, {
      form,
      error: overlapResult.error,
      submittedTexts: parsedTexts,
      requestOptions: { autoChunk, maxTokensPerChunk: maxTokensInput, overlapTokens: overlapTokensInput },
      health,
      healthError,
      recentEmbeddings,
    });
  }

  const requestOptions = {
    autoChunk,
    maxTokensPerChunk: maxTokensResult.value,
    overlapTokens: overlapResult.value,
  };

  try {
    const embeddingResult = await embeddingApiService.embed(parsedTexts, requestOptions);

    logger.notice('Admin embedding test completed', {
      category: 'admin_embedding_test',
      metadata: {
        textCount: parsedTexts.length,
        vectorCount: embeddingResult?.vectors?.length,
        chunkCount: embeddingResult?.chunks?.length,
        model: embeddingResult?.model,
      },
    });

    const info = `Sent ${parsedTexts.length} text${parsedTexts.length === 1 ? '' : 's'} (${splitMode === 'lines' ? 'one per line' : 'single block'}).`;

    return renderEmbeddingTestPage(res, {
      form,
      result: embeddingResult,
      info,
      submittedTexts: parsedTexts,
      requestOptions,
      health,
      healthError,
      recentEmbeddings,
    });
  } catch (error) {
    const status = error?.status || 502;
    let message = error?.message || 'Unable to reach the embedding API.';

    if (error?.code === 'ETIMEOUT') {
      message = `Embedding API request timed out after ${embeddingApiService.timeoutMs}ms.`;
    } else if (error?.status) {
      const detail = typeof error?.responseBody === 'string'
        ? error.responseBody.slice(0, 200)
        : '';
      message = `Embedding API returned ${error.status}. ${detail}`.trim();
    }

    logger.error('Admin embedding test failed', {
      category: 'admin_embedding_test',
      metadata: {
        status: error?.status,
        code: error?.code,
        message: error?.message,
      },
    });

    res.status(status);
    return renderEmbeddingTestPage(res, {
      form,
      error: message,
      submittedTexts: parsedTexts,
      requestOptions,
      health,
      healthError,
      recentEmbeddings,
    });
  }
};

exports.embedding_test_search = async (req, res) => {
  const form = defaultEmbeddingForm();
  const searchAttempt = await performEmbeddingSearch({
    query: typeof req.body.search_text === 'string' ? req.body.search_text : req.body.query,
    topK: req.body.top_k ?? req.body.topK,
    searchType: req.body.search_type ?? req.body.searchType ?? req.body.search_mode,
    startDate: req.body.start_date ?? req.body.startDate,
    endDate: req.body.end_date ?? req.body.endDate,
  });
  const { health, healthError } = await fetchEmbeddingHealth();
  const recentEmbeddings = await loadRecentEmbeddings();

  if (searchAttempt.error) {
    res.status(searchAttempt.status || 400);
  }

  return renderEmbeddingTestPage(res, {
    form,
    submittedTexts: [],
    requestOptions: { autoChunk: true, overlapTokens: EMBEDDING_DEFAULT_OVERLAP },
    health,
    healthError,
    recentEmbeddings,
    search: searchAttempt,
  });
};

exports.embedding_test_delete = async (req, res) => {
  const form = defaultEmbeddingForm();
  const deleteMode = resolveStorageMode(req.body.mode || req.body.search_type || req.body.searchType);
  const normalizedSource = normalizeDeleteSource(req.body || {});
  const { health, healthError } = await fetchEmbeddingHealth();
  const recentEmbeddings = await loadRecentEmbeddings();
  let search = null;

  if (req.body.search_text || req.body.query) {
    search = await performEmbeddingSearch({
      query: typeof req.body.search_text === 'string' ? req.body.search_text : req.body.query,
      topK: req.body.top_k ?? req.body.topK,
      searchType: req.body.search_type ?? req.body.searchType ?? req.body.search_mode,
      startDate: req.body.start_date ?? req.body.startDate,
      endDate: req.body.end_date ?? req.body.endDate,
    });
  }

  if (normalizedSource.error) {
    res.status(400);
    return renderEmbeddingTestPage(res, {
      form,
      submittedTexts: [],
      requestOptions: { autoChunk: true, overlapTokens: EMBEDDING_DEFAULT_OVERLAP },
      health,
      healthError,
      recentEmbeddings,
      search,
      deleteFeedback: { status: 'error', message: normalizedSource.error },
    });
  }

  try {
    const deletedCount = await embeddingApiService.deleteEmbeddings(normalizedSource.source, { mode: deleteMode });
    logger.notice('Admin deleted stored embeddings', {
      category: 'admin_embedding_test',
      metadata: {
        deletedCount,
        mode: deleteMode,
        source: normalizedSource.source,
      },
    });
    return renderEmbeddingTestPage(res, {
      form,
      submittedTexts: [],
      requestOptions: { autoChunk: true, overlapTokens: EMBEDDING_DEFAULT_OVERLAP },
      health,
      healthError,
      recentEmbeddings,
      search,
      deleteFeedback: {
        status: 'success',
        message: `Deleted ${formatNumber(deletedCount || 0)} embedding${deletedCount === 1 ? '' : 's'} for ${normalizedSource.source.collectionName}/${normalizedSource.source.documentId}.`,
      },
    });
  } catch (error) {
    logger.error('Failed to delete embeddings', {
      category: 'admin_embedding_test',
      metadata: {
        mode: deleteMode,
        source: normalizedSource.source,
        message: error?.message,
      },
    });
    res.status(error?.status || 500);
    return renderEmbeddingTestPage(res, {
      form,
      submittedTexts: [],
      requestOptions: { autoChunk: true, overlapTokens: EMBEDDING_DEFAULT_OVERLAP },
      health,
      healthError,
      recentEmbeddings,
      search,
      deleteFeedback: { status: 'error', message: error?.message || 'Unable to delete embeddings right now.' },
    });
  }
};

function defaultAsrForm() {
  return { ...ASR_DEFAULT_FORM };
}

function parseBooleanOption(raw, defaultValue = false) {
  if (raw === undefined || raw === null || raw === '') {
    return defaultValue;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  const normalized = String(raw).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function normalizeAsrForm(body = {}) {
  const defaults = defaultAsrForm();
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : defaults.language;
  const task = body.task === 'translate' ? 'translate' : defaults.task;
  const beamSizeRaw = Number.parseInt(body.beam_size ?? body.beamSize, 10);
  const beamSize = Number.isFinite(beamSizeRaw) && beamSizeRaw > 0 ? beamSizeRaw : defaults.beamSize;
  const temperatureRaw = Number.parseFloat(body.temperature ?? body.temp);
  const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : defaults.temperature;
  const vadFilter = parseBooleanOption(body.vad_filter ?? body.vadFilter, defaults.vadFilter);
  const wordTimestamps = parseBooleanOption(body.word_timestamps ?? body.wordTimestamps, defaults.wordTimestamps);

  return {
    language,
    task,
    vadFilter,
    beamSize,
    temperature,
    wordTimestamps,
  };
}

function buildAsrRequestInfo(file, form) {
  return {
    fileName: file?.originalname || 'audio.webm',
    fileSize: Number.isFinite(file?.size) ? file.size : 0,
    mimeType: file?.mimetype || null,
    options: normalizeAsrForm(form),
  };
}

function requestWantsJson(req) {
  const accept = String(req.headers?.accept || '').toLowerCase();
  return accept.includes('application/json') || accept.includes('text/json') || req.xhr;
}

function renderAsrTestPage(res, { form, result = null, error = null, requestInfo = null }) {
  const normalizedForm = normalizeAsrForm(form);
  return res.render('admin_asr_test', {
    apiBase: ASR_API_BASE,
    form: normalizedForm,
    result,
    error,
    requestInfo,
  });
}

async function transcribeAudioWithAsrApi(file, form) {
  const normalized = normalizeAsrForm(form);
  const requestUrl = `${ASR_API_BASE}/transcribe`;
  const fileName = file?.originalname || 'audio.webm';
  const requestMetadata = {
    fileName,
    fileSize: Number.isFinite(file?.size) ? file.size : 0,
    mimeType: file?.mimetype || null,
    options: normalized,
  };

  const formData = new FormData();
  formData.append('file', file.buffer, {
    filename: fileName,
    contentType: file?.mimetype || 'application/octet-stream',
  });
  formData.append('language', normalized.language);
  formData.append('task', normalized.task);
  formData.append('vad_filter', String(normalized.vadFilter));
  formData.append('beam_size', String(normalized.beamSize));
  formData.append('temperature', String(normalized.temperature));
  formData.append('word_timestamps', String(normalized.wordTimestamps));

  try {
    const response = await axios.post(requestUrl, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: ASR_REQUEST_TIMEOUT_MS,
    });

    await recordApiDebugLog({
      functionName: 'asr_test_transcribe',
      requestUrl,
      requestBody: requestMetadata,
      responseHeaders: response.headers || null,
      responseBody: response.data,
    });

    return { data: response.data, request: requestMetadata };
  } catch (error) {
    await recordApiDebugLog({
      functionName: 'asr_test_transcribe',
      requestUrl,
      requestBody: requestMetadata,
      responseHeaders: error?.response?.headers || null,
      responseBody: error?.response?.data || error?.message || 'Unknown error',
    });
    throw error;
  }
}

exports.asr_test_page = (req, res) => {
  const form = req.asrForm || defaultAsrForm();
  const error = req.asrError || null;
  return renderAsrTestPage(res, { form, error });
};

exports.asr_test_transcribe = async (req, res) => {
  const form = normalizeAsrForm(req.body || {});
  const wantsJson = requestWantsJson(req);
  const file = req.file;

  if (!file || !file.buffer) {
    const message = req.asrError || 'Please upload or record an audio file to transcribe.';
    if (wantsJson) {
      return res.status(400).json({ error: message });
    }
    res.status(400);
    return renderAsrTestPage(res, { form, error: message });
  }

  try {
    const { data, request } = await transcribeAudioWithAsrApi(file, form);

    logger.notice('Admin ASR test completed', {
      category: 'admin_asr',
      metadata: {
        fileName: request.fileName,
        fileSize: request.fileSize,
        mimeType: request.mimeType,
        language: request.options.language,
        task: request.options.task,
      },
    });

    if (wantsJson) {
      return res.json({ result: data, request });
    }

    return renderAsrTestPage(res, { form, result: data, requestInfo: request });
  } catch (error) {
    const status = error?.response?.status || 502;
    let message = 'Unable to transcribe audio.';

    if (error?.response) {
      const detail = typeof error.response.data === 'string' ? error.response.data.slice(0, 200) : '';
      message = `ASR API returned ${error.response.status}. ${detail}`.trim();
    } else if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
      message = `Unable to reach the ASR API at ${ASR_API_BASE}.`;
    } else if (error?.code === 'ETIMEDOUT' || error?.code === 'ESOCKETTIMEDOUT') {
      message = `ASR API request timed out after ${ASR_REQUEST_TIMEOUT_MS}ms.`;
    }

    logger.error('Admin ASR test failed', {
      category: 'admin_asr',
      metadata: {
        error: error?.message,
        status: error?.response?.status,
        code: error?.code,
      },
    });

    if (wantsJson) {
      return res.status(status).json({ error: message });
    }

    res.status(status);
    return renderAsrTestPage(res, { form, error: message, requestInfo: buildAsrRequestInfo(file, form) });
  }
};

async function ensureTempAudioDirectory() {
  await fsp.mkdir(TEMP_AUDIO_DIR, { recursive: true });
}

function clampMaxNewTokens(value) {
  const numeric = Math.round(Number(value) || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return MAX_NEW_TOKENS_DEFAULT;
  }
  return Math.max(MAX_NEW_TOKENS_MIN, Math.min(MAX_NEW_TOKENS_MAX, numeric));
}

function estimateMaxNewTokens(text) {
  const length = typeof text === 'string' ? text.length : 0;
  if (length <= 0) {
    return MAX_NEW_TOKENS_DEFAULT;
  }
  const estimated = Math.round((length / 500) * TOKENS_PER_500_CHARS);
  return clampMaxNewTokens(estimated || MAX_NEW_TOKENS_DEFAULT);
}

function normalizeMaxNewTokens(rawValue, text) {
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return clampMaxNewTokens(parsed);
  }
  return estimateMaxNewTokens(text);
}

function normalizeFormat(raw) {
  const allowed = new Set(['wav', 'pcm', 'mp3', 'opus']);
  if (allowed.has(raw)) {
    return raw;
  }
  return 'wav';
}

function renderTtsTestPage(res, { form, result = null, error = null, job = null, info = null, recommendedMax = MAX_NEW_TOKENS_DEFAULT }) {
  const normalizedForm = {
    text: typeof form?.text === 'string' ? form.text : '',
    referenceId: typeof form?.referenceId === 'string' ? form.referenceId : '',
    maxNewTokens: Number.isFinite(form?.maxNewTokens) ? form.maxNewTokens : MAX_NEW_TOKENS_DEFAULT,
    format: normalizeFormat(form?.format),
  };

  return res.render('admin_tts_test', {
    form: normalizedForm,
    result,
    error,
    job,
    info,
    recommendedMax,
    recommendationNote: `~${TOKENS_PER_500_CHARS} tokens per 500 characters`,
    keywords: TTS_KEYWORDS,
    apiBase: TTS_API_BASE,
  });
}

async function generateTtsFile(text, referenceId, maxNewTokens, format) {
  const payload = {
    text,
    format,
    normalize: true,
    streaming: false,
    chunk_length: 200,
    max_new_tokens: maxNewTokens,
  };

  if (referenceId) {
    payload.reference_id = referenceId;
  }

  const requestUrl = `${TTS_API_BASE}/v1/tts`;
  const textPreview = text.replace(/\s+/g, ' ').slice(0, 120);

  logger.notice('Submitting TTS request', {
    category: 'admin_tts',
    metadata: {
      apiBase: TTS_API_BASE,
      referenceId: referenceId || null,
      textLength: text.length,
      textPreview,
      maxNewTokens,
      format,
    },
  });

  try {
    const response = await axios.post(requestUrl, payload, {
      responseType: 'arraybuffer',
      timeout: 5 * 60 * 1000,
    });
    const buffer = Buffer.from(response.data);

    await ensureTempAudioDirectory();
    const fileName = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${format}`;
    const filePath = path.join(TEMP_AUDIO_DIR, fileName);
    await fsp.writeFile(filePath, buffer);

    await recordApiDebugLog({
      functionName: 'generateTtsFile',
      requestUrl,
      requestBody: payload,
      responseHeaders: response.headers || null,
      responseBody: {
        status: response.status,
        statusText: response.statusText,
        size: buffer.length,
        maxNewTokens,
        format,
      },
    });

    logger.notice('TTS audio generated', {
      category: 'admin_tts',
      metadata: {
        fileName,
        size: buffer.length,
        status: response.status,
        referenceId: referenceId || null,
        maxNewTokens,
        format,
      },
    });

    return fileName;
  } catch (error) {
    await recordApiDebugLog({
      functionName: 'generateTtsFile',
      requestUrl,
      requestBody: payload,
      responseHeaders: error?.response?.headers || null,
      responseBody: error?.response?.data || error?.message || 'Unknown error',
    });

    logger.error('TTS request failed', {
      category: 'admin_tts',
      metadata: {
        apiBase: TTS_API_BASE,
        referenceId: referenceId || null,
        status: error?.response?.status,
        message: error?.message,
        format,
      },
    });
    throw error;
  }
}

function createJobId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function scheduleJobCleanup(jobId) {
  setTimeout(() => {
    ttsJobs.delete(jobId);
  }, TTS_JOB_RETENTION_MS);
}

function startTtsJob({ text, referenceId, maxNewTokens, format, user }) {
  const id = createJobId();
  const job = {
    id,
    status: 'queued',
    form: { text, referenceId, maxNewTokens, format },
    result: null,
    error: null,
    createdAt: Date.now(),
    user,
  };
  ttsJobs.set(id, job);
  scheduleJobCleanup(id);

  setImmediate(async () => {
    job.status = 'processing';
    logger.debug('TTS job started', {
      category: 'admin_tts',
      metadata: { jobId: id, referenceId: referenceId || null, maxNewTokens, format, user },
    });
    try {
      const fileName = await generateTtsFile(text, referenceId, maxNewTokens, format);
      job.result = {
        fileName,
        fileUrl: `/temp/${fileName}`,
        referenceId: referenceId || null,
        maxNewTokens,
        format,
      };
      job.status = 'completed';
      logger.notice('TTS job completed', {
        category: 'admin_tts',
        metadata: {
          jobId: id,
          fileName,
          referenceId: referenceId || null,
          maxNewTokens,
          format,
        },
      });
    } catch (err) {
      job.status = 'failed';
      job.error = err?.message || 'Failed to generate audio.';
      logger.error('TTS job failed', {
        category: 'admin_tts',
        metadata: {
          jobId: id,
          referenceId: referenceId || null,
          maxNewTokens,
          format,
          error: err?.message,
        },
      });
    }
  });

  return job;
}

exports.tts_test_page = (req, res) => {
  const jobId = req.query?.jobId;
  let job = null;
  let result = null;
  let error = null;
  let info = null;

  if (jobId) {
    job = ttsJobs.get(jobId) || null;
    if (!job) {
      error = 'Requested job was not found. It may have expired.';
    } else if (job.status === 'failed') {
      error = job.error || 'Job failed.';
    } else if (job.status === 'completed') {
      result = job.result;
    } else {
      info = 'Job is in progress. This page will update automatically.';
    }
  }

  const form = job?.form || { text: '', referenceId: '', maxNewTokens: MAX_NEW_TOKENS_DEFAULT, format: 'wav' };
  const recommendedMax = estimateMaxNewTokens(form.text);

  return renderTtsTestPage(res, {
    form,
    result,
    error,
    job,
    info,
    recommendedMax,
  });
};

exports.tts_test_generate = async (req, res) => {
  const text = (req.body.text || '').trim();
  const referenceId = (req.body.reference_id || '').trim();
  const maxNewTokens = normalizeMaxNewTokens(req.body.max_new_tokens, text);
  const recommendedMax = estimateMaxNewTokens(text);
  const format = normalizeFormat(req.body.format);
  const form = { text, referenceId, maxNewTokens, format };

  logger.debug('Admin TTS form submitted', {
    category: 'admin_tts',
    metadata: {
      user: req.user?.name || 'unknown',
      textLength: text.length,
      referenceId: referenceId || null,
      maxNewTokens,
      format,
    },
  });

  if (!text) {
    res.status(400);
    return renderTtsTestPage(res, { form, error: 'Please enter some text to synthesize.', recommendedMax });
  }

  try {
    const job = startTtsJob({
      text,
      referenceId,
      maxNewTokens,
      format,
      user: req.user?.name || 'unknown',
    });
    const info = 'Job queued. The page will update once audio is ready.';
    return renderTtsTestPage(res, {
      form,
      result: null,
      job,
      info,
      recommendedMax,
    });
  } catch (error) {
    const status = error?.response?.status || 502;
    let message = 'Unable to generate audio. Please try again.';

    if (error?.response) {
      const detail = typeof error.response.data === 'string' ? error.response.data.slice(0, 200) : '';
      message = `TTS API returned ${error.response.status}. ${detail}`;
    } else if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
      message = `Unable to reach the TTS API at ${TTS_API_BASE}.`;
    }

    logger.error('Failed to generate TTS audio', {
      category: 'admin_tts',
      metadata: {
        error: error?.message,
        status: error?.response?.status,
        apiBase: TTS_API_BASE,
      },
    });
    res.status(status);
    return renderTtsTestPage(res, { form, error: message, recommendedMax });
  }
};

exports.tts_test_status = (req, res) => {
  const jobId = req.params?.id;
  const job = jobId ? ttsJobs.get(jobId) : null;

  if (!job) {
    return res.status(404).json({ status: 'not_found' });
  }

  return res.json({
    status: job.status,
    result: job.result,
    error: job.error,
  });
};
