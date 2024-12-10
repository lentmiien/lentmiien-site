require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { AuthorizationCode } = require('simple-oauth2');

const app = express();
const port = 3000;

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

const client = new AuthorizationCode(config);

const authorizationUri = client.authorizeURL({
  redirect_uri: process.env.DROPBOX_REDIRECT_URI,
  response_type: 'code',
  token_access_type: 'offline', // Request refresh token
});

function saveTokens(token) {
  const tokenPath = path.resolve('tokens.json');
  fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
  console.log('Tokens saved to tokens.json');
}

app.get('/auth', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('No code returned');
  }

  try {
    const accessToken = await client.getToken({
      code,
      redirect_uri: process.env.DROPBOX_REDIRECT_URI,
    });

    console.log('Access Token:', accessToken.token.access_token);
    console.log('Refresh Token:', accessToken.token.refresh_token);

    saveTokens(accessToken.token);

    res.send('Authorization successful! You can close this window.');
    process.exit(0);
  } catch (error) {
    console.error('Access Token Error', error.message);
    res.status(500).json('Authentication failed');
  }
});

app.listen(port, async () => {
  console.log(`Listening on port ${port}`);
  const open = await (await import('open')).default;
  console.log(authorizationUri);
  open(authorizationUri);
});
