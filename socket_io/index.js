const socketIO = require('socket.io');

const { UseraccountModel } = require('../database');

const registerChat5Handlers = require('./chat5/chat5handler');
const registerChat5_5Handlers = require('./chat5_5/chat5_5handler');

function roomForUser(userName) { return `user:${encodeURIComponent(String(userName))}`; }
function roomForConversation(conversationId) { return `conversation:${String(conversationId)}`; }

module.exports = (server, sessionMiddleware) => {
  const io = socketIO(server, {maxHttpBufferSize: 10 * 1024 * 1024});

  // Use the session middleware in Socket.io
  io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
  });

  // Middleware to check if user is authenticated
  io.use((socket, next) => {
    if (
      socket.request.session &&
      socket.request.session.passport &&
      socket.request.session.passport.user
    ) {
      return next();
    }
    return next(new Error('Unauthorized'));
  });

  // Handle connections
  io.on('connection', async (socket) => {
    const userId = socket.request.session.passport.user;
    const userName = (await UseraccountModel.findOne({ _id: userId })).name;

    // console.log(`${userName} connected: ${userId}`);

    socket.data.userName = userName;
    await socket.join(roomForUser(userName));

    await registerChat5Handlers({ io, socket, userName });
    await registerChat5_5Handlers({ io, socket, userName });

    socket.on('disconnect', () => {
      // console.log(`User disconnected: ${userId}`);
    });
  });

  io.userRoom = roomForUser;
  io.conversationRoom = roomForConversation;

  return io;
};
