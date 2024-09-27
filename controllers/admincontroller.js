const { UseraccountModel, RoleModel } = require('../database');

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
      "openai",
      "embedding",
      "gptdocument",
      "accounting",
      "cooking",
      "health",
      "box",
      "quicknote",
      "emergencystock",
      "receipt",
      "product",
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

// Updated getPM2LogFiles function to filter out subfolders
function getPM2LogFiles() {
    const logPath = '/home/pi/.pm2/logs/';
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
    const filePath = path.join('/home/pi/.pm2/logs/', filename);
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return data;
    } catch (err) {
        throw new Error(`Error reading file: ${err.message}`);
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
    const file_data = getLogFileContent(req.params.file);
    res.render("log_file", { file_data, file: req.params.file });
  } catch (error) {
    res.status(500).render('error_page', {error: `Error reading log file: ${error.message}`});
  }
};
