require('dotenv').config();

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Function to ensure that a directory exists
function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Directory created: ${dirPath}`);
  }
}

// Function to ensure that a file exists with given content
function ensureFileExists(filePath, defaultContent) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent);
    console.log(`File created: ${filePath}`);
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

const folderPath = 'public/img';
convertPngToJpgInFolder(folderPath);

// Delete log files
const logPath = '/home/lentmiien/.pm2/logs/';
function deleteLogFile(filename) {
  const filePath = path.join(logPath, filename);

  // Validate that the file exists and is within the log directory
  if (!fs.existsSync(filePath)) {
    console.log(`File '${filePath}' not found!`)
    return;
  }

  // Ensure that the path is a file and not a directory
  if (!fs.statSync(filePath).isFile()) {
    console.log(`'${filePath}' is not a file!`)
    return;
  }

  // Delete the file
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    console.log(`Error deleting '${filePath}'`)
    return;
  }
}
deleteLogFile("app-error.log");
deleteLogFile("app-out.log");

// Fetch OpenAI usage
const {fetchUsageSummaryLastDay} = require('./usage');

// Delete "test" data from chat database
const mongoose = require("mongoose");
const Chat4Model = require('./models/chat4');
const Conversation4Model = require('./models/conversation4');
const OpenAIUsage = require('./models/openai_usage');
const mongoDB_url = process.env.MONGOOSE_URL;
async function ClearTestDataFromDB() {
  await mongoose.connect(mongoDB_url);

  await Chat4Model.deleteMany({ category: "Test" });//Test
  await Conversation4Model.deleteMany({ category: "Test" });//Test

  const summary = await fetchUsageSummaryLastDay();
  console.log(summary);
  await new OpenAIUsage(summary).save();

  await mongoose.disconnect();
}
ClearTestDataFromDB();

// Gmail check
const fs2 = require('fs').promises;
const readline = require('readline');
const {google} = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = 'token.json';

async function main() {
  try {
    const content = await fs2.readFile('credentials.json');
    const auth = await authorize(JSON.parse(content));
    await checkEmails(auth);
  } catch (err) {
    console.error('Error:', err);
  }
}

async function authorize(credentials) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  try {
    const token = await fs2.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  } catch (err) {
    return getNewToken(oAuth2Client);
  }
}

function getNewToken(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      oAuth2Client.getToken(code, async (err, token) => {
        if (err) return reject('Error retrieving access token');
        oAuth2Client.setCredentials(token);
        try {
          await fs2.writeFile(TOKEN_PATH, JSON.stringify(token));
          console.log('Token stored to', TOKEN_PATH);
          resolve(oAuth2Client);
        } catch (err) {
          reject('Error storing token');
        }
      });
    });
  });
}

async function checkEmails(auth) {
  const gmail = google.gmail({version: 'v1', auth});
  
  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread subject:"【三菱ＵＦＪ‐ＶＩＳＡデビット】ご利用のお知らせ"'
    });

    const messages = res.data.messages;
    if (messages && messages.length) {
      console.log(`Found ${messages.length} messages to process.`);
      
      // Fetch all email contents first
      const emailContents = await Promise.all(messages.map(async (message) => {
        const res = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'  // Request full message data
        });
        // Extract body content
        const body = res.data.payload.parts[0].body.data;
        // Extract received date
        const receivedDate = new Date(parseInt(res.data.internalDate));

        return {msg: Buffer.from(body, 'base64').toString('utf-8'), date: receivedDate};
      }));

      // Process emails in the background
      processEmailsInBackground(emailContents);
    } else {
      console.log('No messages found.');
    }
  } catch (err) {
    console.error('The API returned an error:', err);
  }
}

function processEmailsInBackground(emailContents) {
  console.log('Starting background processing of emails...');
  
  (async function processEmails() {
    for (const content of emailContents) {
      await verifyEmailContent(content);
    }
    console.log('Finished processing all emails.');
  })();
}

async function verifyEmailContent(content) {
  console.log('Verifying email content...');
  
  try {
    // Simulate sending data to AI model and saving to 'to verify' database
    const extractedData = await sendToAIModel(content);
    await saveToVerifyDatabase(extractedData);
    console.log('Email content processed and saved for verification.');
  } catch (err) {
    console.error('Error processing email content:', err);
  }
}

async function sendToAIModel(content) {
  // Simulate sending data to AI model
  console.log('Sending data to AI model...');
  await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate delay
  return { extractedData: content };
}

async function saveToVerifyDatabase(data) {
  // Simulate saving to 'to verify' database
  console.log('Saving to verify database...');
  await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate delay
  console.log('Data saved:', data);
}

// Run the main function when the app starts
// main().catch(console.error);
