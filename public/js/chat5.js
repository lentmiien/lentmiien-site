// Create a socket connection
const socket = io();

// Create an AudioContext
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Elements
const messagesList = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message');

// Variables to keep track of the assistant's response
let assistantMessageElement = null;

// Handle form submission for sending messages
messageForm.addEventListener('submit', function (e) {
  e.preventDefault(); // Prevent page reload
  const msg = messageInput.value.trim();
  if (msg === '') return;
  
  // Display user's message in the chat
  addMessageToChat('You', msg);

  // Send the message to the server
  socket.emit('userMessage', msg);

  // Clear the input field
  messageInput.value = '';

  // Disable the input field until the assistant's response is complete
  messageInput.disabled = true;
  messageInput.placeholder = 'Waiting for assistant response...';

  // Prepare a new message element for the assistant's response
  assistantMessageElement = addMessageToChat('Assistant', '');
});

// Handle incoming chunks from the server
socket.on('aiResponseChunk', function (chunk) {
  if (assistantMessageElement) {
    // Append the new chunk to the existing content
    assistantMessageElement.dataset.content += chunk;

    // Update the HTML content by converting Markdown to HTML
    assistantMessageElement.innerHTML = `<strong>Assistant:</strong><br>${marked.parse(assistantMessageElement.dataset.content)}`;
  }
});

// Handle end of assistant's response
socket.on('aiResponseEnd', function () {
  // Re-enable the input field
  messageInput.disabled = false;
  messageInput.placeholder = 'Type your message here...';

  // Reset assistant message element
  assistantMessageElement = null;
});

// Handle errors
socket.on('error', function (errorMessage) {
  alert(errorMessage);

  // Re-enable the input field in case of error
  messageInput.disabled = false;
  messageInput.placeholder = 'Type your message here...';
});

// Function to add a message to the chat
function addMessageToChat(sender, messageContent) {
  const item = document.createElement('li');

  // Use a data attribute to store the content (for incremental updates)
  item.dataset.content = messageContent;

  // Set initial content (converted from Markdown to HTML)
  item.innerHTML = `<strong>${sender}:</strong><br>${marked.parse(messageContent)}`;

  messagesList.appendChild(item);
  window.scrollTo(0, document.body.scrollHeight);

  return item;
}

// Voice Mode
function StartVoiceMode(e) {
  (async () => {
    // Load the AudioWorkletProcessor module
    await audioContext.audioWorklet.addModule('processor.js');
  
    // Get access to the user's microphone
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        e.disabled = true;
        socket.emit('connectVoiceMode');
        startProcessing(stream);
      })
      .catch(err => {
        console.error('Error accessing microphone:', err);
      });
  })();
}

function startProcessing(stream) {
  // Create a MediaStreamSource from the microphone input
  const source = audioContext.createMediaStreamSource(stream);

  // Create an AudioWorkletNode
  const processorNode = new AudioWorkletNode(audioContext, 'audio-processor');

  // Connect the source to the processor node
  source.connect(processorNode);

  // Handle audio data from the processor node
  processorNode.port.onmessage = event => {
    const audioData = event.data; // Float32Array of audio samples at 24kHz

    // Convert Float32Array to 16-bit PCM
    const int16Data = float32ToInt16(audioData);

    // Get the ArrayBuffer from Int16Array
    const arrayBuffer = int16Data.buffer;

    // Base64-encode the data
    const base64Data = arrayBufferToBase64(arrayBuffer);

    // Send base64-encoded data to the server via Socket.io
    socket.emit('audioData', base64Data);
  };
}

// Convert Float32Array to Int16Array (16-bit PCM)
function float32ToInt16(buffer) {
  let l = buffer.length;
  const int16Buffer = new Int16Array(l);
  while (l--) {
    const s = Math.max(-1, Math.min(1, buffer[l]));
    int16Buffer[l] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Buffer;
}

// Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB chunk size to avoid call stack issues
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const voice_out = document.getElementById("voice_out");

socket.on('voiceResponse', function (content) {
  voice_out.innerHTML += '\n\n---\n\n' + JSON.stringify(JSON.parse(content), null, 2);
});

socket.on('audioData', data => {
  // Create a Blob from the data
  const audioBlob = new Blob([data], { type: 'audio/webm; codecs=opus' });
  const audioUrl = URL.createObjectURL(audioBlob);
  
  // Create an audio element and play it
  const audio = new Audio(audioUrl);
  audio.play();
});
