/* Local synthetic-data harness. Never mounted by app.js; no .env, DB, jobs or providers. */
const express = require('express');
const http = require('http');
const session = require('express-session');
const { Server } = require('socket.io');
const path = require('path');
const { createCommonsRouter } = require('../routes/commons');
const { registerCommons } = require('../socket_io/commons');
const { CommonsRoom } = require('../services/commons/room');
const { CommonsNpc } = require('../services/commons/npc');
const { PLAY, TALK } = require('../utils/commonsAuthorizationPolicy');
async function createPreview({ port = 0 } = {}) {
  const app = express(), server = http.createServer(app);
  const store = new session.MemoryStore();
  const sessionMiddleware = session({ secret: 'commons-synthetic-preview-not-a-production-secret', store, resave: false, saveUninitialized: false, cookie: { maxAge: 3600000 } });
  const users = new Map(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(24, '0'), { _id: String(i + 1).padStart(24, '0'), name: `Preview ${i + 1}`, type_user: i ? 'user' : 'admin' }]));
  const revoked = new Set();
  const roleModel = { findOne: async filter => revoked.has(filter.name) ? null : filter.type === 'user' ? { permissions: [PLAY, TALK] } : null };
  const userModel = { findOne: async query => revoked.has(users.get(String(query._id))?.name) ? null : users.get(String(query._id)) };
  let saved = { version: 1, revision: 0, players: [], blooms: 0 };
  let failSaves = false;
  const repository = {
    async acquire() { return structuredClone({ ...saved, leaseUntil: new Date(Date.now() + 20000) }); },
    async save(state) {
      if (failSaves) throw new Error('Synthetic save failure');
      saved = structuredClone({ ...state, revision: state.revision + 1, leaseUntil: new Date(Date.now() + 20000), savedAt: new Date() });
      return structuredClone(saved);
    },
  };
  const room = new CommonsRoom({ repository });
  app.set('views', path.resolve(__dirname, '../views')); app.set('view engine', 'pug');
  app.use(express.json({ limit: '1kb' })); app.use(sessionMiddleware);
  app.post('/__preview/login', (req, res) => {
    const id = String(req.body.resident || 1).padStart(24, '0');
    if (!users.has(id)) return res.sendStatus(400);
    req.session.passport = { user: id }; return res.json({ ok: true });
  });
  app.use((req, _res, next) => { req.user = users.get(req.session.passport?.user); req.isAuthenticated = () => Boolean(req.user); next(); });
  app.use('/css', express.static(path.resolve(__dirname, '../public/css')));
  app.use('/commons', express.static(path.resolve(__dirname, '../public/commons'), { index: false, redirect: false }));
  const config = { enabled: true, origins: [], maxOnline: 10, npcEnabled: false, checkpointMs: 5000, leaseMs: 20000 };
  app.use('/commons', createCommonsRouter({ roleModel, configReader: () => config }));
  const io = new Server(server, { path: '/commons/socket.io', maxHttpBufferSize: 4096, transports: ['websocket'] });
  app.get('/socket.io/socket.io.js', (_req, res) => res.sendFile(path.resolve(require.resolve('socket.io'), '../../client-dist/socket.io.js')));
  const registration = registerCommons(io, sessionMiddleware, { room, npc: new CommonsNpc(), config, userModel, roleModel });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`; config.origins.push(url);
  return { url, room, store, revoked, failSaves: value => { failSaves = value; },
    stop: async () => { registration.stop(); await new Promise(resolve => io.close(resolve)); },
  };
}
if (require.main === module) createPreview({ port: Number(process.env.COMMONS_PREVIEW_PORT || 8089) }).then(({ url }) => {
  process.stdout.write(`Synthetic Commons preview: ${url}/commons\nPOST /__preview/login with JSON {"resident":1} before visiting. No real account, database or provider is used.\n`);
});
module.exports = { createPreview };
