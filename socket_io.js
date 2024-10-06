const socketIO = require('socket.io');

module.exports = (server, sessionMiddleware) => {
  const io = socketIO(server);

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

  io.on('connection', (socket) => {
    const userId = socket.request.session.passport.user;
    console.log(`User connected: ${userId}`);

    // Define your socket event handlers here
    socket.on('chat message', (msg) => {
      console.log(`Message from ${userId}: ${msg}`);
      // Broadcast the message to all connected clients
      io.emit('chat message', { userId, msg });
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId}`);
    });
  });
};