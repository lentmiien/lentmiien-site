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
const prompt = document.getElementById("prompt");
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
  prompt.value = element.value;
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

function showLoadingPopup() {
  loadingPopup.style.display = 'block';
  document.body.classList.add('no-scroll'); // Prevent scrolling on the body
}

const image_form = document.getElementById("image_form");
const image_message_id = document.getElementById("image_message_id");
const image_prompt = document.getElementById("image_prompt");

function RunImageForm() {
  // Transfer prompt to image_prompt
  image_prompt.value = prompt.value;
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
  sound_prompt.value = prompt.value;
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
setActionButton("Prompt", sendPrompt);

function sendPrompt() {
  showLoadingPopup();
  chatform.submit();
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
