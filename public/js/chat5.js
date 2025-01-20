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
const loadingPopup = document.getElementById("loadingPopup");
const clist = document.getElementById("clist");
const cllist = document.getElementById("cllist");
const tlist = document.getElementById("tlist");
const tllist = document.getElementById("tllist");
const context_templates = document.getElementById("context_templates");
const text_templates = document.getElementById("text_templates");

const MAX_FILE_SIZE = 10 * 1024 * 1024;

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
  console.log(data.conversation);
  console.log(data.messages);
  model.value = data.conversation.default_model && data.conversation.default_model.length > 0 ? data.conversation.default_model : "gpt-4o-mini";
  contextInput.value = data.conversation.context_prompt;
  categoryInput.value = data.conversation.category;
  tagsInput.value = data.conversation.tags.join(",");
  title.innerText = data.conversation.title;
  // Populate conversation from database
  data.messages.forEach(m => {
    addDeleteCheckbox(m._id.toString());
    addMessageToChat(m._id.toString(), 'User', m.prompt, m.images.map(d => d.filename));
    addMessageToChat(m._id.toString(), 'Assistant', m.response, [], m.sound);
  });
  attachCopyListeners();
});

function CloseLoad() {
  load.style.display = "none";
}

////////////////////////
//----- Settings -----//

socket.on('setCategories', categories => {
  categories.forEach(c => {
    const option = document.createElement("option");
    option.value = c;
    option.innerText = c;
    clist.append(option);

    const option2 = document.createElement("option");
    option2.value = c;
    option2.innerText = c;
    cllist.append(option2);
  });
});

socket.on('setTags', tags => {
  tags.forEach(c => {
    const option = document.createElement("option");
    option.value = c;
    option.innerText = c;
    tlist.append(option);

    const option2 = document.createElement("option");
    option2.value = c;
    option2.innerText = c;
    tllist.append(option2);
  });
});

socket.on('setTemplates', templates => {
  templates.forEach(t => {
    /*
Title: { type: String, required: true, max: 100 },
Type: { type: String, required: true, max: 100 },
Category: { type: String, required: true, max: 100 },
TemplateText: { type: String, required: true },
    */
    if (t.Type === "context") {
      const option = document.createElement("option");
      option.value = t.TemplateText;
      option.innerText = t.Title;
      option.title = t.TemplateText;
      context_templates.append(option);
    }
    if (t.Type === "chat") {
      const option = document.createElement("option");
      option.value = t.TemplateText;
      option.innerText = t.Title;
      option.title = t.TemplateText;
      text_templates.append(option);
    }
  });
});

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

function ToggleDuplicate(e) {
  socket.emit('toggleDuplicate', e.checked);
}

function ProcessDeleteCheckbox(e) {
  socket.emit('toggleDeleteMessage', {id: e.value, state: e.checked});
}

function DeleteOneMessageFromConversation(id) {
  socket.emit('deleteOneMessage', id);
}

socket.on('deleteMessagesFromUI', msg_ids => {
  console.log("Deleting messages: ", msg_ids);
  msg_ids.forEach(id => {
    const elements = document.getElementsByClassName(id);
    for (let i = elements.length-1; i >= 0; i--) {
      messagesList.removeChild(elements[i]);
    }
  });
});

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

  // Show loading screen until getting a response
  showLoadingPopup();
  
  // Send the message to the server
  socket.emit('userMessage', msg);
});

socket.on('batchPending', function (message) {
  addMessageToChat('batch', 'User', message);
  addMessageToChat('batch', 'Assistant', `### **Batch pending**
[View](/chat4/batch_status)`);

  // Clear file upload
  statusDiv.textContent = "";

  // Generate a title if empty
  // if (title.innerText.length === 0) {
  //   socket.emit('createTitle');
  // }

  // Attach copy functionality to code blocks
  attachCopyListeners();
});

socket.on('aiResponse', function (message) {
  addDeleteCheckbox(message._id.toString());
  addMessageToChat(message._id.toString(), 'User', message.prompt, message.images.map(d => d.filename));
  addMessageToChat(message._id.toString(), 'Assistant', message.response, [], message.sound);

  // Clear file upload
  statusDiv.textContent = "";

  // Generate a title if empty
  if (title.innerText.length === 0) {
    socket.emit('createTitle');
  }

  // Attach copy functionality to code blocks
  attachCopyListeners();

  // Clear the input field
  editor.reset();

  // Done, close loading screen
  hideLoadingPopup();
});

/////////////////////////////
//----- Handle errors -----//
socket.on('error', function (errorMessage) {
  alert(errorMessage);
});

////////////////////////////////
//----- Helper functions -----//

// Message delete checkbox
function addDeleteCheckbox(message_id) {
  const item = document.createElement('li');
  item.classList.add(message_id);

  item.innerHTML = `<input type="checkbox" value="${message_id}" onchange="ProcessDeleteCheckbox(this)"> Delete message below/Create new conversation without message below<button class="btn btn-danger float-end" onclick="DeleteOneMessageFromConversation('${message_id}')">Delete</button>`;

  messagesList.appendChild(item);

  return item;
}

// Function to add a message to the chat
function addMessageToChat(message_id, sender, messageContent, images = null, audio = null) {
  const item = document.createElement('li');
  item.classList.add(sender.toLowerCase());
  item.classList.add(message_id);

  // Set initial content (converted from Markdown to HTML)
  item.innerHTML = `<strong>${sender}:</strong><br>${marked.parse(messageContent)}${audio && audio.length > 0 ? '<br><audio controls><source src="/mp3/' + audio + '" type="audio/mpeg"></audio>' : ''}${images && images.length > 0 ? '<br><img src="/img/' + images.join('"><img src="/img/') + '">' : ''}`;

  messagesList.appendChild(item);
  // window.scrollTo(0, document.body.scrollHeight);

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

// Function to show the loading popup
function showLoadingPopup() {
  loadingPopup.style.display = 'block';
}

// Function to hide the loading popup
function hideLoadingPopup() {
  loadingPopup.style.display = 'none';
}

function SetCategory(e) {
  categoryInput.value = e.value;
}

function SetLoadCategory(e) {
  load_category.value = e.value;
  UpdateLoad();
}

function SetTag(e) {
  if (tagsInput.value.length === 0) {
    tagsInput.value = e.value
  } else {
    const tags = tagsInput.value.split(", ").join(",").split(",");
    if (tags.indexOf(e.value) >= 0) {
      tagsInput.value = tags.filter(t => t != e.value).join(",");
    } else {
      tags.push(e.value);
      tagsInput.value = tags.join(",");
    }
  }
}

function SetLoadTag(e) {
  load_tags.value = e.value;
  UpdateLoad();
}

function SetContext(e) {
  contextInput.value = e.value;
}

function SetText(e) {
  editor.setMarkdown(e.value);
}
