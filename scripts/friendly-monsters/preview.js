#!/usr/bin/env node
'use strict';
// Local-only public-static preview. Never imports app.js or initializes a DB.
const express = require('express');
const path = require('path');
const app = express();
const root = path.resolve(__dirname, '../..');
app.use('/css', express.static(path.join(root, 'public/css')));
app.use('/games/friendly-monsters', express.static(path.join(root, 'games/friendly-monsters')));
app.get('/games', (req, res) => res.type('html').send('<a href="/games/friendly-monsters/">Friendly Monsters preview</a>'));
const server = app.listen(8097, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:8097/games/friendly-monsters/'));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
