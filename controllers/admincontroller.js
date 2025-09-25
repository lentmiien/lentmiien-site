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

const LOGS_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_LEVELS = ['debug', 'notice', 'warning', 'error'];
const MAX_LOG_ENTRIES = 1000;

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

exports.openai_usage = async (req, res) => {
  const data = await OpenAIUsage.find().sort({ entry_date: -1 }).exec();
  const monthly_summaries = {};
  for (const d of data) {
    const yyyymm = d.entry_date.slice(0, 7);
    monthly_summaries[yyyymm] = monthly_summaries[yyyymm] ? monthly_summaries[yyyymm] + d.cost : d.cost;
  }
  res.render("openai_usage", {data, monthly_summaries});
};

