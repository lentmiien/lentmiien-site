// Create a socket connection
const socket = io();

// Create an AudioContext
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Elements
const messagesList = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
// const messageInput = document.getElementById('message');
const model = document.getElementById('model');
const title = document.getElementById('title');
const settings = document.getElementById('settings');
const settingsForm = document.getElementById('settings-form');
const contextInput = document.getElementById('context');
const categoryInput = document.getElementById('category');
const tagsInput = document.getElementById('tags');
const load = document.getElementById('load');

// Setup markdown editor
const editor = new toastui.Editor({
  el: document.querySelector('#message'),
  height: '500px',
  initialEditType: 'wysiwyg',
  previewStyle: 'vertical'
});

// Variables to keep track of the assistant's response
let assistantMessageElement = null;

// Handle form submission for sending messages
messageForm.addEventListener('submit', function (e) {
  e.preventDefault(); // Prevent page reload
  const msg = editor.getMarkdown();
  if (msg === '') return;
  
  // Display user's message in the chat
  addMessageToChat('You', msg);

  // Send the message to the server
  socket.emit('userMessage', msg);

  // Clear the input field
  // messageInput.value = '';
  editor.reset();

  // Disable the input field until the assistant's response is complete
  // messageInput.disabled = true;
  // messageInput.placeholder = 'Waiting for assistant response...';

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
  // messageInput.disabled = false;
  // messageInput.placeholder = 'Type your message here...';

  // Reset assistant message element
  assistantMessageElement = null;

  // Generate a title if empty
  if (title.innerText.length === 0) {
    socket.emit('createTitle');
  }

  // Attach copy functionality to code blocks
  attachCopyListeners();
});

socket.on('setTitle', title_text => {
  title.innerText = title_text;
});

// Handle errors
socket.on('error', function (errorMessage) {
  alert(errorMessage);

  // Re-enable the input field in case of error
  // messageInput.disabled = false;
  // messageInput.placeholder = 'Type your message here...';
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

function UpdateModel(e) {
  socket.emit('userSelectModel', e.value);
}

// Voice Mode
let g_stream = null;
function StartVoiceMode(e) {
  (async () => {
    // Load the AudioWorkletProcessor module
    await audioContext.audioWorklet.addModule('processor.js');
  
    // Get access to the user's microphone
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        e.disabled = true;
        socket.emit('connectVoiceMode');
        g_stream = stream;
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

const transcript = document.getElementById("transcript");
const voice_out = document.getElementById("voice_out");

let once = true;
socket.on('voiceResponse', function (content) {
  const data = JSON.parse(content);
  voice_out.innerHTML += '\n\n---\n\n' + JSON.stringify(data, null, 2);
  if (once) {
    once = false;
    startProcessing(g_stream);
  }
  if (data.type === "response.audio_transcript.done") {
    const appendMessage = document.createElement("div");
    appendMessage.classList.add("assistant");
    appendMessage.innerHTML = `<h4>Assistant:</h4><p>${data.transcript}</p>`;
    transcript.append(appendMessage);
  }
  if (data.type === "conversation.item.input_audio_transcription.completed") {
    const appendMessage = document.createElement("div");
    appendMessage.classList.add("user");
    appendMessage.innerHTML = `<h4>User:</h4><p>${data.transcript}</p>`;
    transcript.append(appendMessage);
  }
});

let nextPlaybackTime = audioContext.currentTime;

socket.on('audioData', base64Data => {
  // Decode base64 to ArrayBuffer
  const arrayBuffer = base64ToArrayBuffer(base64Data);

  // Convert ArrayBuffer to Int16Array
  const int16Data = new Int16Array(arrayBuffer);

  // Convert Int16Array to Float32Array (normalize to range [-1, 1])
  const float32Data = new Float32Array(int16Data.length);
  for (let i = 0; i < int16Data.length; i++) {
    float32Data[i] = int16Data[i] / 0x8000;
  }

  // Resample from 24kHz to the AudioContext's sample rate
  const resampledData = resampleAudioData(float32Data, 24000, audioContext.sampleRate);

  // Create an AudioBuffer
  const audioBuffer = audioContext.createBuffer(1, resampledData.length, audioContext.sampleRate);
  audioBuffer.getChannelData(0).set(resampledData);

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);

  // Schedule playback to avoid gaps/overlaps
  if (nextPlaybackTime < audioContext.currentTime) {
    nextPlaybackTime = audioContext.currentTime;
  }

  source.start(nextPlaybackTime);
  nextPlaybackTime += audioBuffer.duration;
});

// Convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for(let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Resample audio data from inputSampleRate to outputSampleRate
function resampleAudioData(audioData, inputSampleRate, outputSampleRate) {
  const sampleRateRatio = outputSampleRate / inputSampleRate;
  const newLength = Math.round(audioData.length * sampleRateRatio);
  const resampledData = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < newLength) {
    const index = offsetResult / sampleRateRatio;
    const i0 = Math.floor(index);
    const i1 = Math.min(Math.ceil(index), audioData.length - 1);
    const weight = index - i0;
    resampledData[offsetResult++] = audioData[i0] * (1 - weight) + audioData[i1] * weight;
  }

  return resampledData;
}

// Function to attach copy listeners to all <code> elements
function attachCopyListeners() {
  // Select all <code> elements in the document
  const codeBlocks = document.querySelectorAll('code');

  codeBlocks.forEach(code => {
    // Check if the copy listener has already been added
    if (!code.dataset.copyListener) {
      // Add click event listener to copy the text content
      code.addEventListener('click', () => {
        // Use the Clipboard API to copy text
        navigator.clipboard.writeText(code.textContent)
          .then(() => {
            // Add a CSS class to trigger the flash effect
            code.classList.add('copied');

            // Remove the class after 500ms to reset the style
            setTimeout(() => {
              code.classList.remove('copied');
            }, 500);
          })
          .catch(err => {
            console.error('Failed to copy text: ', err);
            // Optionally, provide error feedback to the user here
          });
      });

      // Mark the <code> element as having the copy listener
      code.dataset.copyListener = 'true';
    }
  });
}

/***********************************
 * 
 * Settings
 * 
 */

function OpenSettings() {
  settings.style.display = "block";
}

// Handle form submission for sending settings
settingsForm.addEventListener('submit', function (e) {
  e.preventDefault(); // Prevent page reload

  // TODO: fetch settings ans emit to server
  socket.emit('userUpdateSettings', {
    context: contextInput.value,
    category: categoryInput.value,
    tags: tagsInput.value,
  });

  settings.style.display = "none";
});

/********************************
 * 
 *  Load
 * 
 */

const load_category = document.getElementById('load_category');
const load_tags = document.getElementById('load_tags');
const load_keyword = document.getElementById('load_keyword');
const loadlist = document.getElementById('loadlist');

function OpenLoad() {
  load_category.value = "";
  load_tags.value = "";
  load_keyword.value = "";

  // Emit a load event (no query parameters, so show last 20 entries)
  socket.emit('loadConversations', {category: load_category.value, tags: load_tags.value, keyword: load_keyword.value});

  load.style.display = "block";
}

function UpdateLoad() {
  // When query parameter has been updated
  // Emit a load event (use query parameters to show last 20 entries)
  socket.emit('loadConversations', {category: load_category.value, tags: load_tags.value, keyword: load_keyword.value});
}

socket.on('displayConversations', conversation_array => {
  loadlist.innerHTML = "";
  conversation_array.forEach(c => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.innerText = c.title;
    button.title = c.description;
    button.classList.add("btn", "btn-primary");
    button.addEventListener("click", () => LoadConversation(c._id.toString()));
    li.append(button);
    loadlist.append(li);
  });
});

function LoadConversation(id) {
  socket.emit('fetchConversation', id);
  CloseLoad();
}

socket.on('displayConversationContent', data => {
  // Clear conversation window
  messagesList.innerHTML = '';
  // Set default model and settings
  model.value = data.conversation.default_model;
  contextInput.value = data.conversation.context_prompt;
  categoryInput.value = data.conversation.category;
  tagsInput.value = data.conversation.tags.join(",");
  title.innerText = data.conversation.title;
  // Populate conversation from database
  data.messages.forEach(m => {
    addMessageToChat('User', m.prompt);
    addMessageToChat('Assistant', m.response);
  });
});

function CloseLoad() {
  load.style.display = "none";
}
