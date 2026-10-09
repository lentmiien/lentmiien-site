/* Local synthetic-data harness. Never mounted by app.js; no .env, DB, jobs or providers. */
const express = require('express');
const http = require('http');
const session = require('express-session');
const { Server } = require('socket.io');
const path = require('path');
const { createCommonsRouter } = require('../routes/commons');
const { registerCommons, createCommonsTransport } = require('../socket_io/commons');
const { CommonsRoom } = require('../services/commons/room');
const { CommonsNpc } = require('../services/commons/npc');
const { PLAY, TALK } = require('../utils/commonsAuthorizationPolicy');
async function createPreview({ port = 0, provider = null, maxOnline = 10, v12 = false } = {}) {
  const app = express(), server = http.createServer(app);
  const store = new session.MemoryStore();
  const sessionMiddleware = session({ secret: 'commons-synthetic-preview-not-a-production-secret', store, resave: false, saveUninitialized: false, cookie: { maxAge: 3600000 } });
  const users = new Map(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(24, '0'), { _id: String(i + 1).padStart(24, '0'), name: `Preview ${i + 1}`, type_user: i ? 'user' : 'admin' }]));
  if (v12) users.get('2'.padStart(24, '0')).type_user = 'family';
  const revoked = new Set();
  const grants = new Map([...users.values()].map(user => [user.name, [PLAY, TALK, ...(v12 ? ['scheduletask', 'emergencystock'] : [])]]));
  const roleModel = { findOne: async filter => revoked.has(filter.name) ? null : filter.type === 'user' ? { permissions: grants.get(filter.name) || [] } : null };
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
  const room = new CommonsRoom({ repository, maxOnline });
  app.set('views', path.resolve(__dirname, '../views')); app.set('view engine', 'pug');
  app.use('/__preview/login', express.json({ limit: '1kb' })); app.use(sessionMiddleware);
  app.post('/__preview/login', (req, res) => {
    const id = String(req.body.resident || 1).padStart(24, '0');
    if (!users.has(id)) return res.sendStatus(400);
    req.session.passport = { user: id }; return res.json({ ok: true });
  });
  app.use((req, _res, next) => { req.user = users.get(req.session.passport?.user); req.isAuthenticated = () => Boolean(req.user); next(); });
  app.use('/css', express.static(path.resolve(__dirname, '../public/css')));
  app.use('/commons', express.static(path.resolve(__dirname, '../public/commons'), { index: false, redirect: false }));
  const config = { enabled: true, origins: [], maxOnline, npcEnabled: Boolean(provider), checkpointMs: 5000, leaseMs: 20000 };
  const privateAccess = require('../services/commons/privateAccess').createPrivateAccess();
  const fixtures = v12 ? require('../tests/fixtures/commonsV12').fixture({ roleModel }) : null;
  app.use('/commons', createCommonsRouter({ roleModel, userModel, configReader: () => config, privateOptions: { access: privateAccess, ...(fixtures || {}) } }));
  // Exercise two actual transport servers on one HTTP server, as production does.
  // The default server is transport-only here; production chat authorization has separate tests.
  const siteIo = new Server(server);
  const io = createCommonsTransport(server, config);
  const registration = registerCommons(io, sessionMiddleware, { room, npc: new CommonsNpc({ provider }), config, userModel, roleModel, privateAccess });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`; config.origins.push(url);
  return { url, room, store, revoked, grants, users, fixtures, privateAccess, io, siteIo, failSaves: value => { failSaves = value; },
    stop: async () => { registration.stop(); await new Promise(resolve => io.close(resolve)); await new Promise(resolve => siteIo.close(resolve)); },
  };
}
if (require.main === module) createPreview({ port: Number(process.env.COMMONS_PREVIEW_PORT || 8089) }).then(({ url }) => {
  process.stdout.write(`Synthetic Commons preview: ${url}/commons\nPOST /__preview/login with JSON {"resident":1} before visiting. No real account, database or provider is used.\n`);
});
module.exports = { createPreview };
