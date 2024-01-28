const fs = require('fs');
const path = require('path');

// Function to ensure that a directory exists
function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Directory created: ${dirPath}`);
  } else {
    console.log(`Directory already exists: ${dirPath}`);
  }
}

// Function to ensure that a file exists with given content
function ensureFileExists(filePath, defaultContent) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent);
    console.log(`File created: ${filePath}`);
  } else {
    console.log(`File already exists: ${filePath}`);
  }
}

// The directories to ensure exist
const dirsToCheck = ['tmp_data', 'cache'];

dirsToCheck.forEach(dir => ensureDirExists(dir));

// Files and their default content to ensure exist
const filesToCheck = [
  { name: "chat3vdb.json", content: "[]" },
  { name: "default_models.json", content: "{}" },
  { name: "embedding.json", content: "[]" }
];

filesToCheck.forEach(file => ensureFileExists(path.join('cache', file.name), file.content));

// Check for the existence of the .env file
if (!fs.existsSync('.env')) {
  console.warn('Warning: .env file does not exist. Some configurations might be missing.');
}
