// Loopback-only test host. Production never imports this module.
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const session = require('express-session');
const { Server } = require('socket.io');
const { createEmberwakeRouter } = require('../../../routes/emberwake');
const { installEmberwake } = require('../../../socket_io/emberwake');
const { verificationReceipt } = require('../../../utils/twoFactorSession');
const { Room } = require('../../../services/emberwake/room');
const root = path.resolve(__dirname, '../../..');

async function fixture(repository) {
  const users = {};
  for (const [i, name] of ['alice', 'bob', 'admin', 'guest'].entries())
    users[name] = {
      _id: (i + 1).toString().padStart(24, '0'),
      name,
      type_user: name === 'admin' ? 'admin' : name === 'guest' ? 'fixture-no-grants' : 'user',
      two_factor: { enabled: name === 'admin', version: 'synthetic' },
      hash_password: 'synthetic-fixture'
    };
  const room = new Room({ repository });
  const app = express(),
    server = http.createServer(app),
    store = new session.MemoryStore(),
    secret = crypto.randomUUID();
  const userModel = { findOne: async ({ _id }) => Object.values(users).find(u => u._id === _id) };
  const roleModel = { findOne: async () => null };
  const sessions = session({
    secret: crypto.randomUUID(),
    store,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000, httpOnly: true, sameSite: 'strict' }
  });
  app.set('views', path.join(root, 'views'));
  app.set('view engine', 'pug');
  app.use(sessions);
  app.post('/_fixture/session/:name', (req, res) => {
    const user = users[req.params.name];
    if (!user || req.get('x-test-key') !== secret) return res.sendStatus(403);
    req.session.passport = { user: user._id };
    req.session.twoFactor = verificationReceipt(user);
    res.sendStatus(204);
  });
  app.use(async (req, res, next) => {
    req.user = await userModel.findOne({ _id: req.session.passport?.user });
    req.isAuthenticated = () => !!req.user;
    next();
  });
  app.use('/js', express.static(path.join(root, 'public/js')));
  app.use('/css', express.static(path.join(root, 'public/css')));
  app.use('/emberwake-online', createEmberwakeRouter({ room, roleModel }));
  const siteIO = new Server(server);
  siteIO.use((_s, next) => next(new Error('Fixture has no chat')));
  // Match the production coexistence of the default client script and dedicated game engine.
  const allowed = new Set(),
    io = installEmberwake(server, sessions, { room, roleModel, userModel, ready: () => true, allowed });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  allowed.add(origin);
  return {
    room,
    origin,
    secret,
    users,
    store,
    async close() {
      await room.shutdown();
      await new Promise(r => io.close(r));
      await new Promise(r => siteIO.close(r));
      server.closeAllConnections();
    }
  };
}
module.exports = { fixture };
