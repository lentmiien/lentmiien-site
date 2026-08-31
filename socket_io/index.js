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
    const userName = socket.data.userName;
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
        await registerChat5Handlers({ io, socket, userName });
        await registerChat5_5Handlers({ io, socket, userName });
        await registerChat5_6Handlers({ io, socket, userName });
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

  io.userRoom = roomForUser;
  io.conversationRoom = roomForConversation;

  return io;
};
