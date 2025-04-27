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
const dulpicate = document.getElementById("dulpicate");
const conversation_id = document.getElementById("conversation_id");
const template_pop = document.getElementById("template_pop");
const template_title = document.getElementById("template_title");
const template_content = document.getElementById("template_content");
const template_type = document.getElementById("template_type");
const max = document.getElementById("max");
const image_model = document.getElementById("image_model");
const image_quality = document.getElementById("image_quality");
const image_size = document.getElementById("image_size");

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

  // Load last 50 updated conversations
  socket.emit('loadLast50Coversations');

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
  model.value = data.conversation.default_model && data.conversation.default_model.length > 0 ? data.conversation.default_model : "gpt-4o-mini";
  contextInput.value = data.conversation.context_prompt;
  categoryInput.value = data.conversation.category;
  tagsInput.value = data.conversation.tags.join(",");
  title.innerText = data.conversation.title;
  max.value = data.conversation.max_messages ? data.conversation.max_messages : 0;
  // Populate conversation from database
  data.messages.forEach(m => {
    addMessageToChat(m._id.toString(), 'User', m.prompt, m.images.map(d => d.filename));
    addMessageToChat(m._id.toString(), 'Assistant', m.response, [], m.sound);
    addDeleteCheckbox(m._id.toString());
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

socket.on('setID', id => {
  conversation_id.innerText = id;
});

function UpdateModel(e) {
  socket.emit('userSelectModel', e.value);
}

function ToggleDuplicate(e) {
  socket.emit('toggleDuplicate', e.checked);
}

function SetReasoning(e) {
  socket.emit('setReasoning', e.value);
}

function ProcessDeleteCheckbox(e) {
  socket.emit('toggleDeleteMessage', {id: e.value, state: e.checked});
}

function DeleteOneMessageFromConversation(id) {
  socket.emit('deleteOneMessage', id);
}

function EmailOneMessageFromConversation(id, e) {
  e.disabled = true;
  socket.emit('sendAsEmail', id);
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
  statusDiv.dataset.files = JSON.stringify(data.savedImages);
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

  // Check del_checkbox
  const delete_messages = [];
  const del_checkbox = document.getElementsByClassName("del_checkbox");
  for (let i = 0; i < del_checkbox.length; i++) {
    if (del_checkbox[i].checked) {
      delete_messages.push(del_checkbox[i].value);
    }
  }

  const low = document.getElementById("low");
  // const medium = document.getElementById("medium");
  const high = document.getElementById("high");
  let r = "medium";
  if (low.checked) r = "low";
  if (high.checked) r = "high";
  
  // Send the message to the server
  socket.emit('userMessage', {
    context: contextInput.value,
    msg,
    tags: tagsInput.value.length > 0 ? tagsInput.value : 'chat5',
    conversationTitle: title.innerText.length > 1 ? title.innerText : "Placeholder",
    category: categoryInput.value.length > 0 ? categoryInput.value : 'Chat5',
    duplicate: dulpicate.checked,
    reasoning: r,
    conversation_id: conversation_id.innerText,
    model: model.value,
    images: JSON.parse(statusDiv.dataset.files),
    delete_messages,
    max: parseInt(max.value),
  });
});

socket.on('batchPending', function (message) {
  addMessageToChat('batch', 'User', message);
  addMessageToChat('batch', 'Assistant', `### **Batch pending**
[View](/chat4/batch_status)`);

  // Clear file upload
  statusDiv.textContent = "";
  statusDiv.dataset.files = "[]";

  // Attach copy functionality to code blocks
  attachCopyListeners();

  // Clear the input field
  editor.reset();

  // Done, close loading screen
  hideLoadingPopup();
});

socket.on('aiResponse', function (message) {
  addMessageToChat(message._id.toString(), 'User', message.prompt, message.images.map(d => d.filename));
  addMessageToChat(message._id.toString(), 'Assistant', message.response, [], message.sound);
  addDeleteCheckbox(message._id.toString());

  // Clear file upload
  statusDiv.textContent = "";
  statusDiv.dataset.files = "[]";

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

//////////////////////////////
//----- Image generate -----//
function GenerateImage() {
  // Must have a conversation with at least 1 message
  const messages_li = document.getElementsByTagName('li');
  const msg = editor.getMarkdown();
  if (conversation_id.innerText.length === 0 || messages_li.length === 0 || msg.length === 0) {
    return alert("Must have a conversation with at least 1 message");
  }

  const params = {
    id: conversation_id.innerText,
    model: image_model.value,
    quality: image_quality.value,
    size: image_size.value,
    prompt: msg,
    images: JSON.parse(statusDiv.dataset.files),
  };

  // Show loading screen until getting a response
  showLoadingPopup();

  socket.emit('generateImage', params);
}

socket.on('imageDone', function (image_name) {
  // Append to last message (first element on page with class attribute "user")
  const messages_li = document.getElementsByClassName('user');
  messages_li[0].innerHTML += '<br><img src="/img/' + image_name + '">';

  // Clear file upload
  statusDiv.textContent = "";
  statusDiv.dataset.files = "[]";

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

  item.innerHTML = `<input class="del_checkbox" type="checkbox" value="${message_id}" onchange="ProcessDeleteCheckbox(this)"> Delete message below/Create new conversation without message below<button class="btn btn-danger float-end" onclick="DeleteOneMessageFromConversation('${message_id}')">Delete</button><button class="btn btn-warning float-end" onclick="EmailOneMessageFromConversation('${message_id}', this)">Email</button><a href="/chat5/edit_message/${message_id}" class="btn btn-primary float-end">Manual Edit</a><a href="/chat4/createknowledgefromchat/${conversation_id.innerText}" class="btn btn-primary float-end">Create knowledge</a>`;

  messagesList.prepend(item);

  return item;
}

// Function to add a message to the chat
function addMessageToChat(message_id, sender, messageContent, images = null, audio = null) {
  const item = document.createElement('li');
  item.classList.add(sender.toLowerCase());
  item.classList.add(message_id);

  // Set initial content (converted from Markdown to HTML)
  const sender_element = document.createElement("strong");
  sender_element.innerText = sender;
  const copy_raw_button = document.createElement("button");
  copy_raw_button.innerText = "Copy RAW";
  copy_raw_button.dataset.raw = messageContent;
  copy_raw_button.setAttribute("onclick", "CopyRAW(this)");
  copy_raw_button.classList.add("btn", "btn-link");

  item.append(sender_element, copy_raw_button);
  item.innerHTML += `<br>${marked.parse(messageContent)}${audio && audio.length > 0 ? '<br><audio controls><source src="/mp3/' + audio + '" type="audio/mpeg"></audio>' : ''}${images && images.length > 0 ? '<br><img src="/img/' + images.join('"><img src="/img/') + '">' : ''}`;

  messagesList.prepend(item);
  // window.scrollTo(0, document.body.scrollHeight);

  return item;
}

function CopyRAW(e) {
  navigator.clipboard.writeText(e.dataset.raw);
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

function OpenTemplate() {
  settings.style.display = "none";
  template_pop.style.display = 'block';
}

function SaveTemplate() {
  socket.emit('SaveTemplate', {
    Title: template_title.value,
    Type: template_type.value,
    Category: categoryInput.value,
    TemplateText: template_content.value,
  });

  if (template_type.value === "context") {
    const option = document.createElement("option");
    option.value = template_content.value;
    option.innerText = template_title.value;
    option.title = template_content.value;
    context_templates.append(option);
  }
  if (template_type.value === "chat") {
    const option = document.createElement("option");
    option.value = template_content.value;
    option.innerText = template_title.value;
    option.title = template_content.value;
    text_templates.append(option);
  }

  CloseTemplate();
}

function CloseTemplate() {
  template_pop.style.display = 'none';
}
