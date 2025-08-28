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

const logPath = '/home/lentmiien/.pm2/logs/';

// Updated getPM2LogFiles function to filter out subfolders
function getPM2LogFiles() {
  try {
    const files = fs.readdirSync(logPath);
    const fileNames = files.filter(file => {
      const filePath = path.join(logPath, file);
      return fs.statSync(filePath).isFile();
    });
    return fileNames;
  } catch (err) {
    throw new Error(`Error reading directory: ${err.message}`);
  }
}

// Existing getLogFileContent function
function getLogFileContent(filename) {
  const filePath = path.join(logPath, filename);
  
  // Validate that the file exists and is within the log directory
  if (!fs.existsSync(filePath)) {
    throw new Error('File does not exist.');
  }

  // Ensure that the path is a file and not a directory
  if (!fs.statSync(filePath).isFile()) {
    throw new Error('Specified path is not a file.');
  }

  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return data;
  } catch (err) {
    throw new Error(`Error reading file: ${err.message}`);
  }
}

// Function to delete a specific log file
function deleteLogFile(filename) {
  const filePath = path.join(logPath, filename);

  // Validate that the file exists and is within the log directory
  if (!fs.existsSync(filePath)) {
    throw new Error('File does not exist.');
  }

  // Ensure that the path is a file and not a directory
  if (!fs.statSync(filePath).isFile()) {
    throw new Error('Specified path is not a file.');
  }

  // Delete the file
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    throw new Error(`Error deleting file: ${err.message}`);
  }
}

// Updated app_logs function with try...catch and error handling
exports.app_logs = (req, res) => {
  try {
    const files = getPM2LogFiles();
    res.render("app_logs", { files });
  } catch (error) {
    res.status(500).render('error_page', {error: `Error fetching log files: ${error.message}`});
  }
};

// Updated log_file function with try...catch and error handling
exports.log_file = (req, res) => {
  try {
    const filename = req.params.file;

    // Security: Validate the filename
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).render('error_page', {error: 'Invalid file name.'});
    }

    // Check if the file is in the list of PM2 log files
    const allowedFiles = getPM2LogFiles();
    if (!allowedFiles.includes(filename)) {
      return res.status(404).render('error_page', {error: 'File not found.'});
    }

    const file_data = getLogFileContent(filename);
    res.render("log_file", { file_data, file: filename });
  } catch (error) {
    res.status(500).render('error_page', {error: `Error reading log file: ${error.message}`});
  }
};

// Endpoint to delete a log file
exports.delete_log_file = (req, res) => {
  try {
    const filename = req.params.file;

    // Security: Validate the filename
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).render('error_page', {error: 'Invalid file name.'});
    }

    // Check if the file is in the list of PM2 log files
    const allowedFiles = getPM2LogFiles();
    if (!allowedFiles.includes(filename)) {
      return res.status(404).render('error_page', {error: 'File not found.'});
    }

    // Delete the log file
    deleteLogFile(filename);

    // Redirect back to the logs list with a success message
    res.redirect('/admin/app_logs');
  } catch (error) {
    res.status(500).render('error_page', {error: `Error deleting log file: ${error.message}`});
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
