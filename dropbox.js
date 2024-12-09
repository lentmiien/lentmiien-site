const fs = require('fs');
const path = require('path');
const { Dropbox } = require('dropbox');
const dbx = new Dropbox({ accessToken: process.env.DROPBOX_API_KEY });

const localFolder = './public/img';

// Function to list local files
function listLocalFiles() {
  return fs.promises.readdir(localFolder);
}

// Function to list Dropbox files
async function listDropboxFiles(folderPath) {
  const entries = [];
  let response = await dbx.filesListFolder({path: ''});
  entries.push(...response.result.entries.map(entry => entry.name));
  
  while (response.result.has_more) {
    response = await dbx.filesListFolderContinue({ cursor: response.result.cursor });
    entries.push(...response.result.entries.map(entry => entry.name));
  }
  
  return entries;
}

// Upload files to Dropbox
async function uploadFile(filePath, dropboxPath) {
  const content = fs.readFileSync(filePath);
  await dbx.filesUpload({ path: dropboxPath, contents: content, mode: { ".tag": "overwrite" } });
  console.log(`Uploaded: ${filePath} to ${dropboxPath}`);
}

// Main function for backup process
async function backup() {
  try {
    const localFiles = await listLocalFiles();
    const dropboxFiles = await listDropboxFiles('');
    
    for (const file of localFiles) {
      if (!dropboxFiles.includes(file)) {
        await uploadFile(path.join(localFolder, file), `/${file}`);
      }
    }
  } catch (error) {
    console.error('Error during backup:', error);
  }
}

// Download file from Dropbox
async function downloadFile(dropboxPath, localPath) {
  const response = await dbx.filesDownload({ path: dropboxPath });
  fs.writeFileSync(localPath, response.result.fileBinary);
  console.log(`Downloaded: ${dropboxPath} to ${localPath}`);
}

// Main function for setup process
async function setup() {
  try {
    const localFiles = await listLocalFiles();
    const dropboxFiles = await listDropboxFiles('');
    
    for (const file of dropboxFiles) {
      if (!localFiles.includes(file)) {
        await downloadFile(`/${file}`, path.join(localFolder, file));
      }
    }
  } catch (error) {
    console.error('Error during setup:', error);
  }
}

module.exports = { backup, setup };
