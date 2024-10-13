const socketIO = require('socket.io');
const OpenAI = require('openai');
const { WebSocket } = require('ws');

const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";

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

    // Voice mode handle
    socket.ws = null;

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

    // Connect to voice mode
    socket.on('connectVoiceMode', async () => {
      socket.ws = new WebSocket(url, {
        headers: {
          "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      socket.ws.on("open", function open() {
        console.log("Connected to server.");
        socket.ws.send(JSON.stringify({
          type: "response.create",
          response: {
            modalities: ["text"],
            instructions: "Please assist the user.",
          }
        }));
      });
      
      socket.ws.on("message", function incoming(message) {
        console.log(JSON.parse(message.toString()));
        socket.emit('voiceResponse', message.toString());
      });
    });

    socket.on('audioData', async (data) => {
      // const audioBuffer = await decodeAudio(data);
      // const channelData = audioBuffer.getChannelData(0);
      // const base64Chunk = base64EncodeAudio(channelData);
      socket.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: data,// base64Chunk
      }));
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${userId}`);
    });
  });
};

// Converts Float32Array of audio data to PCM16 ArrayBuffer
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

// Converts a Float32Array to base64-encoded PCM16 data
function base64EncodeAudio(float32Array) {
  const arrayBuffer = floatTo16BitPCM(float32Array);
  let binary = '';
  let bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000; // 32KB chunk size
  for (let i = 0; i < bytes.length; i += chunkSize) {
    let chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}
