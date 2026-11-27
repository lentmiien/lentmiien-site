'use strict';
const { Server } = require('socket.io');
const { hasCapabilities } = require('../utils/authorization');
const { authorizeSocketSession } = require('../utils/socketAuthorization');
const { configuredOrigins, normalizeOrigin, safeEqual } = require('../middleware/sessionCsrf');
const { PLAY, BUNDLES } = require('../services/emberwake/policy');
const { isDatabaseReady } = require('../middleware/databaseReadiness');
const logger = require('../utils/logger');

const REASONS = new Set([
  'MAINTENANCE',
  'WORLD_BUSY',
  'ROOM_FULL',
  'CREW_FULL',
  'SESSION_ENDED',
  'SAVE_UNAVAILABLE',
  'TAKEN_OVER',
  'SERVER_STOPPING',
  'INVALID_INPUT',
  'BUSY'
]);
function origins() {
  const configured = configuredOrigins(
    process.env.EMBERWAKE_ALLOWED_ORIGINS ||
      process.env.CSRF_ALLOWED_ORIGINS ||
      'https://my.lentmiien.com,https://home.lentmiien.com'
  );
  return new Set(configured);
}
function trusted(req, allowed) {
  const origin = req.headers.origin;
  return (
    typeof origin === 'string' &&
    allowed.has(origin) &&
    normalizeOrigin(origin) === origin &&
    new URL(origin).host === req.headers.host
  );
}
async function authorize(socket, deps) {
  const start = deps.now();
  if (!deps.ready() || !trusted(socket.request, deps.allowed) || !socket.request.session?.reload)
    throw Error('Denied');
  await new Promise((resolve, reject) =>
    socket.request.session.reload(err => (err ? reject(err) : resolve()))
  );
  const session = socket.request.session;
  if (
    !session ||
    !safeEqual(session.csrfToken, socket.handshake.auth?.csrf) ||
    !/^[a-f\d]{24}$/i.test(session.passport?.user || '')
  )
    throw Error('Denied');
  const auth = await authorizeSocketSession(session, {
    userModel: deps.userModel,
    permission: null,
    now: start
  });
  if (
    !auth.ok ||
    (socket.data.user && auth.principal._id !== socket.data.user) ||
    !(await hasCapabilities(auth.principal, [PLAY], {
      roleModel: deps.roleModel,
      roleCapabilityBundles: BUNDLES
    }))
  )
    throw Error('Denied');
  const validUntil = Math.min(start + 12000, auth.sessionExpiresAt);
  if (validUntil <= deps.now()) throw Error('Denied');
  return { user: auth.principal._id, validUntil };
}
function installEmberwake(server, sessionMiddleware, overrides = {}) {
  const deps = {
    allowed: origins(),
    userModel: require('../models/useraccount'),
    roleModel: require('../models/role'),
    room: require('../services/emberwake'),
    ready: isDatabaseReady,
    now: Date.now,
    ...overrides
  };
  const io = new Server(server, {
    path: '/emberwake-online/live',
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: 2048,
    perMessageDeflate: false,
    destroyUpgrade: false,
    allowRequest: (req, done) => done(null, deps.ready() && trusted(req, deps.allowed))
  });
  io.use((_socket, next) => next(new Error('SESSION_ENDED')));
  const ns = io.of('/voyage');
  let ticket = 0,
    admitting = 0,
    joining = 0,
    count = 0,
    windowStart = 0,
    lastWarn = 0;
  ns.use((socket, next) => {
    const now = deps.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    if (++count > 16 || admitting + joining >= 8) return next(new Error('BUSY'));
    socket.data.ticket = ++ticket;
    admitting++;
    sessionMiddleware(socket.request, socket.request.res || {}, error => {
      if (error) {
        admitting--;
        return next(new Error('SESSION_ENDED'));
      }
      authorize(socket, deps)
        .then(
          auth => {
            Object.assign(socket.data, auth);
            next();
          },
          err => {
            if (err.message !== 'Denied' && now - lastWarn > 60000) {
              lastWarn = now;
              logger.warning('Emberwake session verification unavailable', {
                category: 'emberwake.authorization',
                metadata: { errorName: err.name }
              });
            }
            next(new Error('SESSION_ENDED'));
          }
        )
        .finally(() => {
          admitting--;
        });
    });
  });
  ns.on('connection', async socket => {
    const { room } = deps,
      id = socket.data.user;
    let audit,
      checking = false,
      started = false,
      packets = 0,
      actions = 0,
      window = deps.now(),
      congested = 0;
    const connection = {
      ticket: socket.data.ticket,
      validUntil: socket.data.validUntil,
      alive: () => socket.connected,
      close: code => {
        if (socket.connected) {
          socket.emit('closed', code);
          socket.disconnect(true);
        }
      },
      send: frame => {
        // Reliable, ordered edits are never deliberately dropped. Disconnect a
        // stalled reader rather than retaining an unbounded edit backlog.
        if (!socket.conn.transport.writable) congested++;
        else congested = 0;
        if (congested > 15) return connection.close('BUSY');
        socket.emit('state', frame);
      }
    };
    socket.once('disconnect', () => {
      clearInterval(audit);
      room.leave(id, connection).catch(() => {});
    });
    joining++;
    try {
      const snapshot = await room.join(id, connection);
      if (!socket.connected) return;
      room.current(id, connection);
      socket.emit('joined', snapshot);
      started = true;
    } catch (err) {
      connection.close(REASONS.has(err.code) ? err.code : 'SAVE_UNAVAILABLE');
      return;
    } finally {
      joining--;
    }
    audit = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const auth = await authorize(socket, deps);
        if (socket.connected) connection.validUntil = auth.validUntil;
      } catch (error) {
        if (error.message !== 'Denied' && deps.now() - lastWarn > 60000) {
          lastWarn = deps.now();
          logger.warning('Emberwake could not refresh session authority', {
            category: 'emberwake.authorization',
            metadata: { errorName: error.name }
          });
        }
        connection.close('SESSION_ENDED');
      } finally {
        checking = false;
      }
    }, 6000);
    audit.unref?.();
    socket.use(([event], next) => {
      const now = deps.now();
      if (now - window >= 1000) {
        window = now;
        packets = 0;
        actions = 0;
      }
      if (
        !started ||
        !['input', 'act'].includes(event) ||
        ++packets > 65 ||
        (event === 'act' && ++actions > 16)
      )
        return connection.close('INVALID_INPUT');
      try {
        room.current(id, connection);
        next();
      } catch {
        connection.close('SESSION_ENDED');
      }
    });
    socket.on('input', p => {
      try {
        room.input(id, connection, p);
      } catch {
        connection.close('INVALID_INPUT');
      }
    });
    socket.on('act', (p, ack) => {
      if (typeof ack !== 'function') return connection.close('INVALID_INPUT');
      try {
        ack(room.action(id, connection, p));
      } catch (error) {
        if (!REASONS.has(error.code))
          logger.error('Emberwake action failed unexpectedly', {
            category: 'emberwake.simulation',
            metadata: { errorName: error.name }
          });
        connection.close(REASONS.has(error.code) ? error.code : 'SAVE_UNAVAILABLE');
      }
    });
  });
  return io;
}
module.exports = { installEmberwake, authorize, trusted, origins };
