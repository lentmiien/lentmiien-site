// dropboxClient.js
const logger = require('./utils/logger');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Dropbox } = require('dropbox');
const fetch = require('node-fetch'); // Required for Dropbox SDK in Node.js
const { AuthorizationCode } = require('simple-oauth2');

// OAuth2 Configuration
const config = {
  client: {
    id: process.env.DROPBOX_CLIENT_ID,
    secret: process.env.DROPBOX_CLIENT_SECRET,
  },
  auth: {
    tokenHost: 'https://www.dropbox.com',
    tokenPath: '/oauth2/token',
    authorizePath: '/oauth2/authorize',
  },
};

// Initialize OAuth2 Client
const client = new AuthorizationCode(config);

// Load Tokens
const tokenPath = path.join(__dirname, 'tokens.json');
let tokenData = {};
if (fs.existsSync(tokenPath)) {
  tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
} else {
  logger.error('tokens.json not found. Please run authorize.js first.');
  process.exit(1);
}

// Create Token Object
const accessToken = client.createToken(tokenData);

// Function to refresh token if expired
async function getValidAccessToken() {
  if (accessToken.expired()) {
    try {
      const refreshedToken = await accessToken.refresh();
      // Persist the original refresh_token from the old tokens data
      const updatedToken = {
        ...refreshedToken.token, // Spread the new token details (including access_token, expiry, etc.)
        refresh_token: tokenData.refresh_token, // Ensure we keep the original refresh_token
        scope: tokenData.scope, // Ensure we keep the original refresh_token
        uid: tokenData.uid, // Ensure we keep the original refresh_token
        account_id: tokenData.account_id, // Ensure we keep the original refresh_token
      };

      // Save the updated tokens back to the `tokens.json` file
      fs.writeFileSync(tokenPath, JSON.stringify(updatedToken, null, 2), 'utf8');
      logger.notice('Access token refreshed');
      return refreshedToken.token.access_token;
    } catch (error) {
      logger.error('Error refreshing access token:', error.message);
      process.exit(1);
    }
  }
  return accessToken.token.access_token;
}

// Initialize Dropbox Client
async function getDropboxClient() {
  const accessTokenValid = await getValidAccessToken();
  const dbx = new Dropbox({ accessToken: accessTokenValid, fetch });
  return dbx;
}

module.exports = { getDropboxClient };
