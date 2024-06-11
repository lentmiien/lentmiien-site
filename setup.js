const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

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
const dirsToCheck = ['tmp_data', 'cache', 'public/temp'];

dirsToCheck.forEach(dir => ensureDirExists(dir));

// Files and their default content to ensure exist
const filesToCheck = [
  { name: "chat3vdb.json", content: "[]" },
  { name: "default_models.json", content: "{}" },
  { name: "embedding.json", content: "[]" }
];

filesToCheck.forEach(file => ensureFileExists(path.join('cache', file.name), file.content));

// Clear temporary folder
function clearDirectory(directory) {
  if (fs.existsSync(directory)) {
      fs.readdirSync(directory).forEach((file) => {
          const currentPath = path.join(directory, file);
          if (fs.lstatSync(currentPath).isDirectory()) {
              // Recurse if directory
              clearDirectory(currentPath);
              fs.rmdirSync(currentPath);
          } else {
              // Remove file
              fs.unlinkSync(currentPath);
          }
      });
  }
}
let TEMP_DIR = path.join(__dirname, 'tmp_data');
clearDirectory(TEMP_DIR);
TEMP_DIR = path.join(__dirname, 'public/temp');
clearDirectory(TEMP_DIR);

// Check for the existence of the .env file
if (!fs.existsSync('.env')) {
  console.warn('Warning: .env file does not exist. Some configurations might be missing.');
}

// Convert DALL-E images to JPG, if only PNG exist
async function convertPngToJpgInFolder(folderPath) {
  try {
    // Read all files in the folder
    const files = await fs.promises.readdir(folderPath);

    // Loop through each file in the directory
    for (const file of files) {
      const ext = path.extname(file);
      const baseName = path.basename(file, ext);

      if (ext.toLowerCase() === '.png') {
        // Check if JPG version exists
        const jpgPath = path.join(folderPath, baseName + '.jpg');
        try {
          // Try accessing the JPG file, throw error if it doesn't exist
          await fs.promises.access(jpgPath);
          console.log(`JPG version already exists for ${file}, skipping...`);
        } catch {
          // JPG does not exist, convert PNG to JPG
          console.log(`Converting ${file} to JPG...`);
          const pngPath = path.join(folderPath, file);
          const pngBuffer = await fs.promises.readFile(pngPath);
          const jpgBuffer = await sharp(pngBuffer).jpeg({ quality: 70 }).toBuffer();
          await fs.promises.writeFile(jpgPath, jpgBuffer);
          console.log(`Successfully converted ${file} to JPG.`);
        }
      }
    }
    console.log("Conversion process completed.");
  } catch (err) {
    console.error('An error occurred:', err);
  }
}

// Usage example
const folderPath = 'public/img';
convertPngToJpgInFolder(folderPath);
