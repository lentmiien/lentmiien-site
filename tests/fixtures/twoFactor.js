// Synthetic, in-memory account storage for authentication integration tests.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const { Passport } = require('passport');
const { Strategy } = require('passport-local');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');
const { createTwoFactorService } = require('../../services/twoFactorService');
const { createTwoFactorRouter } = require('../../routes/twoFactor');
const { createUserSettingsRouter } = require('../../routes/userSettings');

const password = 'Synthetic password1!';
function valueAt(object, key) { return key.split('.').reduce((o, k) => o?.[k], object); }
function matches(record, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some(part => matches(record, part));
    const actual = valueAt(record, key);
    if (expected && typeof expected === 'object') return Object.entries(expected).every(([op, v]) => {
      if (op === '$lt') return actual < v;
      if (op === '$exists') return (actual !== undefined) === v;
      if (op === '$ne') return actual !== v;
      throw new Error('Unsupported fixture operator: ' + op);
    });
    return Array.isArray(actual) ? actual.includes(expected) : String(actual) === String(expected);
  });
}
function setAt(record, key, value) {
  const keys = key.split('.'); const last = keys.pop();
  const target = keys.reduce((o, k) => o[k] ||= {}, record);
  target[last] = structuredClone(value);
}
async function createFixture() {
  const records = ['admin', 'user', 'family', 'other'].map((role, i) => ({
    _id: String(i + 1).repeat(24), name: role, type_user: role,
    hash_password: bcrypt.hashSync(password, 4), email: role + '@example.invalid', password_changed_at: new Date(),
  }));
  const userModel = {
    findOne(filter) {
      const result = structuredClone(records.find(record => matches(record, filter)) || null);
      const promise = Promise.resolve(result); promise.select = () => promise; return promise;
    },
    async updateOne(filter, update) {
      const record = records.find(row => matches(row, filter));
      if (!record) return { modifiedCount: 0, matchedCount: 0 };
      for (const [key, value] of Object.entries(update.$set || {})) setAt(record, key, value);
      for (const [key, value] of Object.entries(update.$pull || {})) setAt(record, key, valueAt(record, key).filter(v => v !== value));
      return { modifiedCount: 1, matchedCount: 1 };
    },
  };
  const key = crypto.randomBytes(32).toString('base64');
  const service = createTwoFactorService({ userModel, key });
  const roleModel = { findOne: async () => null };
  const store = new session.MemoryStore();
  const app = express(); app.set('views', path.resolve('views')); app.set('view engine', 'pug');
  app.use('/css', express.static(path.resolve('public/css')));
  const source = fs.readFileSync('app.js', 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('const isAmiAmiUploadPath ='), source.indexOf('// Public hidden request counter endpoint')), {
    app, bodyParser: require('body-parser'), express, DEFAULT_BODY_LIMIT: '5mb',
  });
  app.use(session({ secret: 'synthetic-mfa-test-session-only', store, resave: false, saveUninitialized: false, cookie: { maxAge: 3600000 } }));
  const passport = new Passport();
  passport.use(new Strategy(async (username, supplied, done) => {
    const record = records.find(row => row.name === username);
    done(null, record && await bcrypt.compare(supplied, record.hash_password) ? structuredClone(record) : false);
  }));
  passport.serializeUser((user, done) => done(null, user._id));
  passport.deserializeUser((id, done) => done(null, structuredClone(records.find(row => row._id === id) || false)));
  app.use(passport.initialize()); app.use(passport.session());
  app.use(require('../../middleware/twoFactorGate'));
  app.use((req, res, next) => { Object.assign(res.locals, { loggedIn: req.isAuthenticated(), permissions: [], htmlPaths: [], bookmarks: [] }); next(); });
  const getLogin = fs.readFileSync('routes/index.js', 'utf8').split('\n').find(line => line.startsWith("router.get('/login',"));
  vm.runInNewContext(getLogin, { router: app, require: createRequire(path.resolve('routes/index.js')),
    controller: { login: (_req, res) => res.render('login', { loginError: '' }) } });
  const loginStart = source.indexOf("app.post(\n  '/login',");
  const realRequire = createRequire(path.resolve('app.js'));
  vm.runInNewContext(source.slice(loginStart, source.indexOf('// Helper: constant-time', loginStart)), {
    app, passport, express, loginLimiter: (_req, _res, next) => next(),
    require: name => name === './routes/twoFactor' ? { ...realRequire(name), passwordLogin: p => realRequire(name).passwordLogin(p, service) } : realRequire(name),
  });
  app.use('/two-factor', createTwoFactorRouter({ factorService: service, roleModel }));
  app.use('/settings', createUserSettingsRouter({ userModel, roleModel }));
  app.get('/mypage', (req, res) => req.isAuthenticated() ? res.send('Private account page') : res.sendStatus(401));
  app.post('/private', (req, res) => req.isAuthenticated() ? res.sendStatus(204) : res.sendStatus(401));
  return { app, records, userModel, service, store, key, passport };
}
module.exports = { createFixture, password };
