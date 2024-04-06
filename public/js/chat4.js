const settingspopup = document.getElementById("settingspopup");
const templatespopup = document.getElementById("templatespopup");

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

// Show popup for editing conversation details (title, category, tags, context, ...)
function SettingsPopup() {
  settingspopup.style.display = "block";
}

// Update the values when popup is closed
function CloseSettingsPopup() {
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

  settingspopup.style.display = "none";
}

// Show a popup for selecting prompt templates
function TemplatesPopup() {
  templatespopup.style.display = "block";
}

// Close popup
function CloseTemplatesPopup() {
  templatespopup.style.display = "none";
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
  image_form.submit()
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
  sound_form.submit()
}
