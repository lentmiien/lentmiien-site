require('dotenv').config();

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const logger = require('./utils/logger');

// Function to ensure that a directory exists
function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.notice(`Directory created: ${dirPath}`);
  }
}

// Function to ensure that a file exists with given content
function ensureFileExists(filePath, defaultContent) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent);
    logger.notice(`File created: ${filePath}`);
  }
}

// The directories to ensure exist
const dirsToCheck = ['tmp_data', 'cache', 'public/temp', 'public/video', 'github-repos', 'logs'];

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
  logger.warning('Warning: .env file does not exist. Some configurations might be missing.');
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
        } catch {
          // JPG does not exist, convert PNG to JPG
          logger.notice(`Converting ${file} to JPG...`);
          const pngPath = path.join(folderPath, file);
          const pngBuffer = await fs.promises.readFile(pngPath);
          const jpgBuffer = await sharp(pngBuffer).jpeg({ quality: 70 }).toBuffer();
          await fs.promises.writeFile(jpgPath, jpgBuffer);
          logger.notice(`Successfully converted ${file} to JPG.`);
        }
      }
    }
    logger.notice("Conversion process completed.");
  } catch (err) {
    logger.error('An error occurred:', err);
  }
}

const folderPath = 'public/img';
convertPngToJpgInFolder(folderPath);

// Delete log files
const LOG_RETENTION_DAYS = 7;
const LOCAL_LOG_DIR = path.join(__dirname, 'logs');

async function pruneOldLogs(directory, retentionDays) {
  try {
    await fs.promises.mkdir(directory, { recursive: true });
    const entries = await fs.promises.readdir(directory);
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    await Promise.all(entries.map(async (entry) => {
      const filePath = path.join(directory, entry);
      try {
        const stats = await fs.promises.stat(filePath);
        if (!stats.isFile()) {
          return;
        }
        if (!entry.toLowerCase().endsWith('.log')) {
          return;
        }
        if ((now - stats.mtimeMs) > retentionMs) {
          await fs.promises.unlink(filePath);
          logger.notice(`Removed old log file: ${filePath}`);
        }
      } catch (err) {
        logger.warning(`Unable to inspect log file: ${filePath}`, err);
      }
    }));
  } catch (err) {
    logger.error('Failed to prune local log files:', err);
  }
}

pruneOldLogs(LOCAL_LOG_DIR, LOG_RETENTION_DAYS);

// Fetch OpenAI usage
const {fetchUsageSummaryForPeriod} = require('./usage');

// Delete "test" data from chat database
const mongoose = require("mongoose");
const Chat4Model = require('./models/chat4');
const Conversation4Model = require('./models/conversation4');
const batchprompt = require('./models/batchprompt');
const embedding = require('./models/embedding');
const openaicalllog = require('./models/openaicalllog');
const OpenAIUsage = require('./models/openai_usage');
const SoraVideo = require('./models/sora_video');
const ApiDebugLog = require('./models/api_debug_log');
const mongoDB_url = process.env.MONGOOSE_URL;
async function ClearTestDataFromDB() {
  await mongoose.connect(mongoDB_url);

  // Delete test data
  await Chat4Model.deleteMany({ category: "Test" });//Test
  await Conversation4Model.deleteMany({ category: "Test" });//Test

  // Get and save OpenAI usage data from last 30 days
  let currentMs = Date.now() - (1000*60*60*24*30);
  for (let i = 0; i < 31; i++) {
    const now = new Date(currentMs);
    const ed = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const sd = new Date(ed.getTime() - (1000*60*60*24));
    const d_str = `${sd.getFullYear()}-${sd.getMonth() > 8 ? (sd.getMonth()+1) : '0' + (sd.getMonth()+1)}-${sd.getDate() > 9 ? sd.getDate() : '0' + sd.getDate()}`;
    const exists = await OpenAIUsage.find({entry_date: d_str});
    if (exists.length === 0) {
      // Only get and save new entries
      const summary = await fetchUsageSummaryForPeriod(sd, ed);
      await new OpenAIUsage(summary).save();
      logger.notice("Data saved:", JSON.stringify(summary, null, 2));
    }
    currentMs += 1000*60*60*24;
  }

  // Delete old data
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  await batchprompt.deleteMany({ timestamp: { $lt: oneMonthAgo } });
  await embedding.deleteMany({});
  await openaicalllog.deleteMany({});
  const fiveDaysAgo = new Date(Date.now() - (5 * 24 * 60 * 60 * 1000));
  const { deletedCount: removedApiDebugEntries = 0 } = await ApiDebugLog.deleteMany({ createdAt: { $lt: fiveDaysAgo } });
  if (removedApiDebugEntries > 0) {
    logger.notice(`Deleted ${removedApiDebugEntries} API debug log entries older than 5 days.`);
  }

  // Delete low-rated Sora videos and remove files
  const lowRatedVideos = await SoraVideo.find({ rating: 1, filename: { $nin: ['', null] } }).lean();
  if (lowRatedVideos.length > 0) {
    const videoDir = path.join(__dirname, 'public', 'video');
    for (const video of lowRatedVideos) {
      const videoPath = path.join(videoDir, video.filename);
      try {
        await fs.promises.unlink(videoPath);
        logger.notice(`Removed low-rated video file: ${videoPath}`);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warning(`Unable to remove video file: ${videoPath}`, err);
        }
      }
    }
    await SoraVideo.deleteMany({ _id: { $in: lowRatedVideos.map((video) => video._id) } });
    logger.notice(`Deleted ${lowRatedVideos.length} low-rated Sora videos from database.`);
  }

  await mongoose.disconnect();
}
ClearTestDataFromDB();

// Backup data, and download missing data
const { backup, setup } = require('./dropbox');
backup();
setup();
