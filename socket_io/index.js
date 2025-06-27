const socketIO = require('socket.io');

const { UseraccountModel } = require('../database');

const registerChat5Handlers = require('./chat5/chat5handler');

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

    await registerChat5Handlers({ socket, userName });

    socket.on('disconnect', () => {
      // console.log(`User disconnected: ${userId}`);
    });
  });
};
