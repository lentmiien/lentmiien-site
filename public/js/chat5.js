// Create a socket connection
const socket = io();

// Elements
const messagesList = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const model = document.getElementById('model');
const title = document.getElementById('title');
const settings = document.getElementById('settings');
const settingsForm = document.getElementById('settings-form');
const contextInput = document.getElementById('context');
const categoryInput = document.getElementById('category');
const tagsInput = document.getElementById('tags');
const load = document.getElementById('load');
const load_category = document.getElementById('load_category');
const load_tags = document.getElementById('load_tags');
const load_keyword = document.getElementById('load_keyword');
const loadlist = document.getElementById('loadlist');
const fileInput = document.getElementById('fileInput');
const statusDiv = document.getElementById('status');

const MAX_FILE_SIZE = 10 * 1024 * 1024;

let assistantMessageElement;// Point to current assistant message, while waiting for a response

// Setup markdown editor
const editor = new toastui.Editor({
  el: document.querySelector('#message'),
  height: '500px',
  initialEditType: 'wysiwyg',
  previewStyle: 'vertical'
});

/////////////////////////////////
//----- Load conversation -----//

function OpenLoad() {
  load_category.value = "";
  load_tags.value = "";
  load_keyword.value = "";
  load.style.display = "block";
}

function UpdateLoad() {
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
    addMessageToChat('User', m.prompt, m.images.map(d => d.filename));
    addMessageToChat('Assistant', m.response);
  });
  attachCopyListeners();
});

function CloseLoad() {
  load.style.display = "none";
}

////////////////////////
//----- Settings -----//

function OpenSettings() {
  settings.style.display = "block";
}

function GenerateTitle() {
  if (title.innerText.length === 0)  {
    alert("Please start a conversation first");
  } else {
    socket.emit('createTitle');
    settings.style.display = "none";
  }
}

// Handle form submission for sending settings
settingsForm.addEventListener('submit', function (e) {
  e.preventDefault(); // Prevent page reload

  // Get settings and emit to server
  socket.emit('userUpdateSettings', {
    context: contextInput.value,
    category: categoryInput.value,
    tags: tagsInput.value,
  });

  settings.style.display = "none";
});

socket.on('setTitle', title_text => {
  title.innerText = title_text;
});

function UpdateModel(e) {
  socket.emit('userSelectModel', e.value);
}

/////////////////////////////
//----- Upload images -----//

fileInput.addEventListener('change', () => {
  const files = fileInput.files;
  if (files.length === 0) return;

  statusDiv.textContent = 'Uploading...';

  for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > MAX_FILE_SIZE) {
        statusDiv.textContent += `\nError: ${file.name} exceeds the 10 MB limit.`;
        continue;
      }

      const reader = new FileReader();

      reader.onload = (event) => {
          const arrayBuffer = event.target.result;
          socket.emit('uploadImage', {
              name: file.name,
              buffer: arrayBuffer
          });
      };

      reader.onerror = () => {
          console.error('Error reading file:', file.name);
          statusDiv.textContent += `\nError reading ${file.name}`;
      };

      reader.readAsArrayBuffer(file);
  }
});

// Handle successful uploads
socket.on('uploadSuccess', (data) => {
  statusDiv.innerHTML = `Uploaded:<br>${data.savedImages.join('<br>')}`;
});

// Handle upload errors
socket.on('uploadError', (data) => {
  statusDiv.textContent += `\nError: ${data.message}`;
});

////////////////////
//----- Post -----//

// Handle form submission for sending messages
messageForm.addEventListener('submit', function (e) {
  e.preventDefault(); // Prevent page reload
  const msg = editor.getMarkdown();
  if (msg === '') return;
  
  // Send the message to the server
  socket.emit('userMessage', msg);

  // Clear the input field
  editor.reset();
});

socket.on('aiResponse', function (message) {
  addMessageToChat('User', message.prompt, message.images.map(d => d.filename));
  addMessageToChat('Assistant', message.response);

  // Clear file upload
  statusDiv.textContent = "";

  // Generate a title if empty
  if (title.innerText.length === 0) {
    socket.emit('createTitle');
  }

  // Attach copy functionality to code blocks
  attachCopyListeners();
});

/////////////////////////////
//----- Handle errors -----//
socket.on('error', function (errorMessage) {
  alert(errorMessage);
});

////////////////////////////////
//----- Helper functions -----//

// Function to add a message to the chat
function addMessageToChat(sender, messageContent, images = null, audio = null) {
  const item = document.createElement('li');
  item.classList.add(sender.toLowerCase());

  // Set initial content (converted from Markdown to HTML)
  item.innerHTML = `<strong>${sender}:</strong><br>${marked.parse(messageContent)}${audio ? '<br><audio controls><source scr="/mp3/' + audio + '" type="audio/mpeg"></audio>' : ''}${images && images.length > 0 ? '<br><img src="/img/' + images.join('"><img src="/img/') + '">' : ''}`;

  messagesList.appendChild(item);
  window.scrollTo(0, document.body.scrollHeight);

  return item;
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




///////////////////////////////////////////////////////////
///////////-------------- OLD ----------------/////////////



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






/***********************************
 * 
 * Settings
 * 
 */



/********************************
 * 
 *  Load
 * 
 */

