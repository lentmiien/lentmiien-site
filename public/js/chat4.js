const loadingPopup = document.getElementById("loadingPopup");

// Tabs
const settings_tab = document.getElementById("settings-tab");
const chat_tab = document.getElementById("chat-tab");
const templates_tab = document.getElementById("templates-tab");
const knowledge_tab = document.getElementById("knowledge-tab");
const rawchat_tab = document.getElementById("rawchat-tab");

const modal = document.getElementById('imageModal');
const modalImg = document.getElementById("fullSizeImage");

const knowledge_container = document.getElementById("knowledge_container");

const chattitle = document.getElementById("chattitle");
const title = document.getElementById("title");
const tooltitle = document.getElementById("tooltitle");
const category = document.getElementById("category");
const toolcategory = document.getElementById("toolcategory");
const tags = document.getElementById("tags");
const tooltags = document.getElementById("tooltags");
const context = document.getElementById("context");
const toolcontext = document.getElementById("toolcontext");
const userprompt = document.getElementById("prompt");
const image_quality = document.getElementById("image_quality");
const toolquality = document.getElementById("toolquality");
const image_size = document.getElementById("image_size");
const toolsize = document.getElementById("toolsize");
const sound_model = document.getElementById("sound_model");
const toolttsmodel = document.getElementById("toolttsmodel");
const sound_voice = document.getElementById("sound_voice");
const toolvoice = document.getElementById("toolvoice");

const chatform = document.getElementById("chatform");

// Nav action button
const actionBtn = document.getElementById("actionBtn");

// Update the values when popup is closed
function UpdateSettings() {
  // Chat
  chattitle.innerText = tooltitle.value;
  title.value = tooltitle.value;
  category.value = toolcategory.value;
  tags.value = tooltags.value;
  context.value = toolcontext.value;

  // Image
  image_quality.value = toolquality.value;
  image_size.value = toolsize.value;

  // TTS
  sound_model.value = toolttsmodel.value;
  sound_voice.value = toolvoice.value;

  chat_tab.click();
}

// Save conversation settings
async function SaveConversationSettings(id) {
  const data = {
    title: tooltitle.value,
    category: toolcategory.value,
    tags: tooltags.value,
    context: toolcontext.value,
  };

  // Call API
  await fetch(`/chat4/updateconversation/${id}`, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify(data), // body data type must match "Content-Type" header
  });

  // Update and close when done
  UpdateSettings();
}

// Show a popup for selecting prompt templates
function TemplatesPopup() {
  document.getElementById("templates-tab").click();
}

// Close popup
function CloseTemplatesPopup() {
  if (chat_tab) {
    chat_tab.click();
  } else {
    document.getElementById("newchat-tab").click();
  }
}

// Apply chat template
function SetChatTemplate(element) {
  userprompt.value = element.value;
  CloseTemplatesPopup();
}

// Apply context template
function SetContextTemplate(element) {
  context.value = element.value;
  if (toolcontext) {
    toolcontext.value = element.value;
  }
  CloseTemplatesPopup();
}

// Function to show the loading popup
function showLoadingPopup() {
  loadingPopup.style.display = 'block';
  document.body.classList.add('no-scroll'); // Prevent scrolling on the body
}

// Function to hide the loading popup
function hideLoadingPopup() {
  loadingPopup.style.display = 'none';
  document.body.classList.remove('no-scroll'); // Re-enable scrolling on the body
}

const image_form = document.getElementById("image_form");
const image_message_id = document.getElementById("image_message_id");
const image_prompt = document.getElementById("image_prompt");

function RunImageForm() {
  // Transfer prompt to image_prompt
  image_prompt.value = userprompt.value;
  // Select selected message, or latest if non selected, and set message id in image_message_id
  const start_messages = document.getElementsByName("start_message");
  image_message_id.value = start_messages[0].value;
  for (let i = 0; i < start_messages.length; i++) {
    if (start_messages[i].checked) {
      image_message_id.value = start_messages[i].value;
    }
  }
  // submit image_form
  showLoadingPopup();
  image_form.submit();
}

const sound_form = document.getElementById("sound_form");
const sound_message_id = document.getElementById("sound_message_id");
const sound_prompt = document.getElementById("sound_prompt");

function RunSoundForm() {
  // Transfer prompt to sound_prompt
  sound_prompt.value = userprompt.value;
  // Select selected message, or latest if non selected, and set message id in sound_message_id
  const start_messages = document.getElementsByName("start_message");
  sound_message_id.value = start_messages[0].value;
  for (let i = 0; i < start_messages.length; i++) {
    if (start_messages[i].checked) {
      sound_message_id.value = start_messages[i].value;
    }
  }
  // submit sound_form
  showLoadingPopup();
  sound_form.submit();
}

function showModalPopup(img) {
  // Get the image and insert it inside the modal
  modalImg.src = img.src;
  
  // Show the modal
  modal.style.display = "block";
}
function closeModalPopup() {
  modal.style.display = "none";
}

function knowledgeCheck(element) {
  if (element.checked) {
    const col = document.createElement("div");
    col.id = element.dataset.id;
    col.classList.add("col");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.value = element.dataset.id;
    input.name = "knowledge";
    input.dataset.id = element.dataset.id;
    input.dataset.title = element.dataset.title;
    input.setAttribute("onclick", "knowledgeCheck(this)")
    const span = document.createElement("span");
    span.innerText = ` ${element.dataset.title} `;
    const select = document.createElement("select");
    select.name = `knowledge_${element.dataset.id}`;
    const option1 = document.createElement("option");
    option1.innerText = "Context";
    option1.value = "context";
    const option2 = document.createElement("option");
    option2.innerText = "Reference";
    option2.value = "reference";
    const option3 = document.createElement("option");
    option3.innerText = "Example";
    option3.value = "example";
    select.append(option1, option2, option3);
    col.append(input, span, select);

    knowledge_container.append(col);
  } else {
    const existing_element = document.getElementById(element.dataset.id);
    if (existing_element) {
      existing_element.remove();
    }
    const select_element = document.getElementById(`id_${element.dataset.id}`);
    if (select_element) {
      select_element.checked = false;
    }
  }
}

// Set action button
let currentEvent = null;
function setActionButton(text, func) {
  actionBtn.innerText = text;
  actionBtn.style.cursor = "pointer";
  actionBtn.disabled = false;
  if (currentEvent) {
    actionBtn.removeEventListener("click", currentEvent)
  }
  actionBtn.addEventListener("click", func);
  currentEvent = func;
}
setActionButton("History/New", Chat4Top);

function Chat4Top() {
  open("/chat4", "_self");
}

// Auto-complete helper functions
function setCategory(id, value) {
  const categoryInput = document.getElementById(id);
  categoryInput.value = value;
  // Close dropdown manually if needed
}

function setTag(id, value) {
  const tagsInput = document.getElementById(id);
  const currentTags = tagsInput.value.split(',').map(tag => tag.trim());
  if (!currentTags.includes(value)) {
    tagsInput.value = currentTags.filter(tag => tag).concat(value).join(',');
  }
  // Close dropdown manually if needed
}

function FilterCategory(element) {
  const category_containers = document.getElementsByClassName("category_container");
  for (let i = 0; i < category_containers.length; i++) {
    category_containers[i].style.display = element.value === "" ? "block" : "none";
  }
  if (element.value.length > 0) {
    document.getElementById(`${element.value}_container`).style.display = "block";
  }
}

function FilterTag(element) {
  //.tag_container(data-tags=`|${c.tags.join('|')}|`)
  const tag_containers = document.getElementsByClassName("tag_container");
  for (let i = 0; i < tag_containers.length; i++) {
    tag_containers[i].style.display = element.value === "" || tag_containers[i].dataset.tags.indexOf(`|${element.value}|`) >= 0 ? "block" : "none";
  }
}

function AppendMessageFilter() {
  if (document.getElementById("message_category")) {
    const message_category = document.getElementById("message_category").value;
    const message_tag = document.getElementById("message_tag").value;
    const messages = document.getElementsByClassName("append_message_container");
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].dataset.category === message_category && messages[i].dataset.tags.indexOf(message_tag) >= 0) {
        messages[i].style.display = "block";
      } else {
        messages[i].style.display = "none";
      }
    }
  }
}
AppendMessageFilter();

function ToggleMessageAppendRemove(element) {
  // #append_message_ids
  const append_message_ids = document.getElementById("append_message_ids");
  if (element.checked) {
    const values = append_message_ids.value.length > 0 ? append_message_ids.value.split(",") : [];
    values.push(element.dataset.id);
    append_message_ids.value = values.join(",");
  } else {
    const values = append_message_ids.value.length > 0 ? append_message_ids.value.split(",") : [];
    const updated_values = values.filter(d => d != element.dataset.id);
    append_message_ids.value = updated_values.join(",");
  }
  // #append_messages_content
  const append_messages_content = document.getElementById("append_messages_content");
  if (element.checked) {
    const container = document.createElement('div');
    container.id = element.dataset.id;
    container.classList.add("append_message_container2");
    const assistant = document.createElement('div');
    assistant.classList.add("assistant");
    assistant.innerHTML = element.dataset.response_html;
    const user = document.createElement('div');
    user.classList.add("user");
    user.innerHTML = element.dataset.prompt_html;
    container.append(assistant, user);
    append_messages_content.prepend(container);
  } else {
    document.getElementById(element.dataset.id).remove();
  }
}

function UpdatePreview(element) {
  const selectedOption = element.options[element.selectedIndex];
  const content = selectedOption.getAttribute('data-content');
  document.getElementById("log_preview").innerHTML = content;
}

async function AppendToHealthEntry() {
  showLoadingPopup();

  const id = document.getElementById("log_id").value;
  const date = document.getElementById("log_date").value;

  // Call API
  const response = await fetch("/health/health-entries/diary", {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify({id, date}), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);
  alert(status.message);
  hideLoadingPopup();
}

async function AI_Prompt() {
  showLoadingPopup();

  // Takes the current conversation and the user prompt
  // Send data to API, that asks for OpenAI's API to refine the prompt
  // The returned prompt is replaces the user prompt (User can adjust prompt if needed before sending message as usual)
  const history = document.getElementsByClassName("raw-chat-content");
  const prompt_val = userprompt.value;
  const category_val = category.value;
  const messages = [];
  messages.push({
    role: 'system',
    content: [
      { type: 'text', text: "You are a helpful assistant. Looking at our conversation, you are to assist the user to formulate their response to the last massage, with the details provided by the user." },
    ]
  });
  for (let i = history.length - 1; i >= 0; i--) {
    if (i%2 === 0) {
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: history[i].innerHTML },
        ]
      });
    } else {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: history[i].innerHTML },
        ]
      });
    }
  }
  if (prompt_val.length > 0) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `Please help me formulate a response to the last message. The information that I need to provide are as following:\n\n---\n\n${prompt_val}\n\n---\n` },
      ]
    });
  } else {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: `Please help me formulate a response to the last message, to expand and explore related topics.` },
      ]
    });
  }

  // Call API
  const response = await fetch("/chat4/prompt_assist", {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify({messages, category: category_val}), // body data type must match "Content-Type" header
  });
  const data = await response.json();
  console.log(data);
  userprompt.value = data.response;
  hideLoadingPopup();
}

async function AI_Suggest() {
  showLoadingPopup();

  // Takes the current conversation, but reverse user <-> assistant
  // Send data to API, that asks for OpenAI's API to respond
  // The returned prompt is inserted in the user prompt (User can adjust prompt if needed before sending message as usual)
  const history = document.getElementsByClassName("raw-chat-content");
  const context_val = context.value;
  const category_val = category.value;
  const messages = [];
  messages.push({
    role: 'system',
    content: [
      { type: 'text', text: context_val },
    ]
  });
  for (let i = history.length - 1; i >= 0; i--) {
    if (i%2 === 1) {
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: history[i].innerHTML },
        ]
      });
    } else {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: history[i].innerHTML },
        ]
      });
    }
  }

  // Call API
  const response = await fetch("/chat4/prompt_assist", {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify({messages, category: category_val}), // body data type must match "Content-Type" header
  });
  const data = await response.json();
  console.log(data);
  userprompt.value = data.response;
  hideLoadingPopup();
}

async function Agent(agent_select, task) {
  showLoadingPopup();

  const conversation_id = document.getElementById("k_conversation_id").value;
  const agent_id = document.getElementById(agent_select).value;
  const history = document.getElementsByClassName("raw-chat-content");
  const context_val = context.value;
  const category_val = category.value;
  const messages = [];
  messages.push({
    role: 'system',
    content: [
      { type: 'text', text: context_val },
    ]
  });
  for (let i = history.length - 1; i >= 0; i--) {
    if (i%2 === 1) {
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: history[i].innerHTML },
        ]
      });
    } else {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: history[i].innerHTML },
        ]
      });
    }
  }

  if (task === "ask") {
    if (userprompt.value.length === 0) {
      return alert("User prompt required");
    }
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userprompt.value },
      ]
    });
  }

  // Call API
  const response = await fetch(`/chat4/${task}_agent`, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify({conversation_id, ca_agent_id: agent_id, messages, category: category_val}), // body data type must match "Content-Type" header
  });
  const data = await response.json();
  console.log(data);
  userprompt.value = data.response;

  if (task === "ask") {
    open(`/chat4/chat/${conversation_id}`, "_self");
  } else {
    hideLoadingPopup();
  }
}

function Batch() {
  chatform.action = chatform.action.split('post').join('batch_prompt');
  chatform.submit();
}
