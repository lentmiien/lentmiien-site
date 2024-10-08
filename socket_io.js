const socketIO = require('socket.io');
const OpenAI = require('openai');

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

  // Handle connections
  io.on('connection', (socket) => {
    const userId = socket.request.session.passport.user;

    // Initialize conversation history for this socket
    socket.conversationHistory = [];

    console.log(`User connected: ${userId}`);

    // Handle incoming messages from the client
    socket.on('userMessage', async (userMessage) => {
      // Add the user's message to the conversation history
      socket.conversationHistory.push({ role: 'user', content: userMessage });

      try {
        // Prepare input parameters for the OpenAI API
        const inputParameters = {
          model: 'gpt-4o-mini', // Replace with your desired model
          messages: socket.conversationHistory,
          stream: true,
        };

        // Call OpenAI API and stream the response
        const stream = await openai.chat.completions.create(inputParameters);

        // Send chunks to the client as they arrive
        let fullMessage = "";// To store the generated message
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            // Send each chunk to the client
            socket.emit('aiResponseChunk', content);
            fullMessage += content;
          }
        }

        // Once the stream is finished, signal the client
        socket.emit('aiResponseEnd');

        // Add the assistant's response to the conversation history
        const assistantResponse = fullMessage;
        socket.conversationHistory.push({ role: 'assistant', content: assistantResponse });
      } catch (error) {
        console.error('Error processing data:', error);
        socket.emit('error', 'An error occurred while processing your request.');
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId}`);
    });
  });
};