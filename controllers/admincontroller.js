const { UseraccountModel, RoleModel, OpenAIUsage } = require('../database');

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

function redirectWithFeedback(res, status, message) {
  const normalizedStatus = FEEDBACK_STATUSES.has(status) ? status : 'info';
  const text = message ? String(message) : '';
  const location = `/admin/html-pages?status=${encodeURIComponent(normalizedStatus)}${text ? `&message=${encodeURIComponent(text)}` : ''}`;
  return res.redirect(location);
}

exports.html_pages = async (req, res) => {
  try {
    const files = await listHtmlFiles();
    const statusParam = String(req.query.status || '').toLowerCase();
    const tentativeStatus = FEEDBACK_STATUSES.has(statusParam) ? statusParam : null;
    const messageParam = tentativeStatus ? String(req.query.message || '') : '';
    const feedbackStatus = messageParam ? tentativeStatus : null;
    const feedbackMessage = messageParam || null;

    return res.render('admin_html_pages', {
      files,
      feedbackStatus,
      feedbackMessage,
    });
  } catch (error) {
    logger.error('Failed to load HTML content manager', { category: 'admin_html', metadata: { error: error.message } });
    res.status(500);
    return res.render('admin_html_pages', {
      files: [],
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
    return redirectWithFeedback(res, 'success', `Deleted ${sanitizedName}.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return redirectWithFeedback(res, 'error', `${sanitizedName} was not found.`);
    }

    logger.error('Failed to delete HTML file', { category: 'admin_html', metadata: { file: sanitizedName, error: error.message } });
    return redirectWithFeedback(res, 'error', `Failed to delete ${sanitizedName}: ${error.message}`);
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

