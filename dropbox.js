const logger = require('./utils/logger');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDropboxClient } = require('./dropboxClient');

const localFolder = path.join(__dirname, 'public', 'img');

// Function to list local files
function listLocalFiles() {
  return fs.promises.readdir(localFolder);
}

// Function to list Dropbox files
async function listDropboxFiles(dbx) {
  const entries = [];
  let response = await dbx.filesListFolder({ path: '' });
  entries.push(...response.result.entries.map(entry => entry.name));

  while (response.result.has_more) {
    response = await dbx.filesListFolderContinue({ cursor: response.result.cursor });
    entries.push(...response.result.entries.map(entry => entry.name));
  }

  return entries;
}

// Upload files to Dropbox
async function uploadFile(dbx, filePath, dropboxPath) {
  const content = fs.readFileSync(filePath);
  await dbx.filesUpload({ path: dropboxPath, contents: content, mode: { ".tag": "overwrite" } });
  logger.notice(`Uploaded: ${filePath} to ${dropboxPath}`);
}

// Main function for backup process
async function backup() {
  try {
    const dbx = await getDropboxClient();
    const localFiles = await listLocalFiles();
    const dropboxFiles = await listDropboxFiles(dbx);

    for (const file of localFiles) {
      if (!dropboxFiles.includes(file)) {
        const fullPath = path.join(localFolder, file);
        await uploadFile(dbx, fullPath, `/${file}`);
      }
    }

    logger.notice('Backup completed successfully.');
  } catch (error) {
    logger.error('Error during backup:', error);
  }
}

// Download file from Dropbox
async function downloadFile(dbx, dropboxPath, localPath) {
  const response = await dbx.filesDownload({ path: dropboxPath });
  fs.writeFileSync(localPath, response.result.fileBinary, 'binary');
  logger.notice(`Downloaded: ${dropboxPath} to ${localPath}`);
}

// Main function for setup process
async function setup() {
  try {
    // Ensure local folder exists
    if (!fs.existsSync(localFolder)) {
      fs.mkdirSync(localFolder, { recursive: true });
    }

    const dbx = await getDropboxClient();
    const localFiles = await listLocalFiles();
    const dropboxFiles = await listDropboxFiles(dbx);

    for (const file of dropboxFiles) {
      if (!localFiles.includes(file)) {
        const dropboxPath = `/${file}`;
        const localPath = path.join(localFolder, file);
        await downloadFile(dbx, dropboxPath, localPath);
      }
    }

    logger.notice('Setup completed successfully.');
  } catch (error) {
    logger.error('Error during setup:', error);
  }
}

module.exports = { backup, setup };

