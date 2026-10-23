const socketIO = require('socket.io');

const { RoleModel, UseraccountModel } = require('../database');
const logger = require('../utils/logger');
const { isDatabaseReady } = require('../middleware/databaseReadiness');
const { authorizeSocketSession } = require('../utils/socketAuthorization');
const { scheduleSessionExpiry } = require('../utils/sessionExpiry');

const registerChat5Handlers = require('./chat5/chat5handler');
const registerChat5_5Handlers = require('./chat5_5/chat5_5handler');
const registerChat5_6Handlers = require('./chat5_6/chat5_6handler');

function roomForUser(userName) { return `user:${encodeURIComponent(String(userName))}`; }
function roomForConversation(conversationId) { return `conversation:${String(conversationId)}`; }
let lastRevalidationWarning = -Infinity;

module.exports = (server, sessionMiddleware, { databaseReady = isDatabaseReady } = {}) => {
  const io = socketIO(server, {maxHttpBufferSize: 10 * 1024 * 1024});

  io.use((_socket, next) => {
    if (!databaseReady()) {
      return next(new Error('Service temporarily unavailable'));
    }
    return next();
  });

  // Use the session middleware in Socket.io
  io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
  });

  // Revalidate the session principal against the database. Chat handlers are registered
  // separately below so authenticated notification sockets remain available to other roles.
  io.use(async (socket, next) => {
    try {
      const session = socket.request.session;
      const authorization = await authorizeSocketSession(session, {
        userModel: UseraccountModel,
        roleModel: RoleModel,
      });
      if (!authorization.ok) {
        return next(new Error(authorization.reason));
      }

      socket.data.userName = authorization.userName;
      socket.data.principal = authorization.principal;
      socket.data.sessionExpiresAt = authorization.sessionExpiresAt;
      socket.data.canUseChat5 = authorization.permissionGranted;
      return next();
    } catch (error) {
      logger.warning('Unable to authorize Socket.IO connection', {
        category: 'socket-auth',
        metadata: { error: error.message },
      });
      return next(new Error('Unauthorized'));
    }
  });

  // Handle connections
  io.on('connection', async (socket) => {
    let checking = false;
    const verifySession = async () => {
      const session = socket.request.session;
      if (typeof session?.reload !== 'function') throw new Error('Unauthorized');
      await new Promise((resolve, reject) => session.reload(error => error ? reject(error) : resolve()));
      let result;
      try {
        result = await authorizeSocketSession(socket.request.session, { userModel: UseraccountModel, roleModel: RoleModel, permission: null });
      } catch (error) {
        if (Date.now() - lastRevalidationWarning > 60000) {
          lastRevalidationWarning = Date.now();
          logger.warning('Socket session revalidation failed; check database availability', { category: 'socket-auth' });
        }
        throw error;
      }
      if (!result.ok || result.userName !== socket.data.userName) throw new Error('Unauthorized');
    };
    socket.use(async (_packet, next) => {
      try { await verifySession(); next(); }
      catch (_) { socket.disconnect(true); next(new Error('Unauthorized')); }
    });
    const verificationTimer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try { await verifySession(); } catch (_) { socket.disconnect(true); }
      finally { checking = false; }
    }, 30000);
    verificationTimer.unref?.();
    socket.on('disconnect', () => clearInterval(verificationTimer));
    socket.use(require('../middleware/chat5PrivateAccess').socketGuard(socket));
    const userName = socket.data.userName;
    const principal = socket.data.principal;
    let cancelExpiry = null;

    socket.on('disconnect', () => {
      cancelExpiry?.();
    });

    try {
      cancelExpiry = scheduleSessionExpiry(
        socket.data.sessionExpiresAt,
        () => socket.disconnect(true)
      );
      if (!socket.connected) {
        cancelExpiry?.();
        return;
      }

      await socket.join(roomForUser(userName));
      if (socket.data.canUseChat5) {
        await registerChat5Handlers({ io, socket, userName, principal });
        await registerChat5_5Handlers({ io, socket, userName, principal });
        await registerChat5_6Handlers({ io, socket, userName, principal });
      }

      socket.emit('welcome');
    } catch (error) {
      cancelExpiry?.();
      socket.disconnect(true);
      logger.error('Failed to initialize Socket.IO connection', {
        category: 'socket-initialization',
        metadata: { error: error.message },
      });
    }
  });

  require('./commons').installCommons(server, sessionMiddleware);

  io.userRoom = roomForUser;
  io.conversationRoom = roomForConversation;
  require('../utils/chat5RoomDelivery').install(io);

  return io;
};
