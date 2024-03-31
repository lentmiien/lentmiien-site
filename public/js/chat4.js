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

// Show popup for editing conversation details (title, category, tags, context, ...)
function SettingsPopup() {
  settingspopup.style.display = "block";
}

// Update the values when popup is closed
function CloseSettingsPopup() {
  chattitle.innerText = tooltitle.value;
  title.value = tooltitle.value;
  category.value = toolcategory.value;
  tags.value = tooltags.value;
  context.value = toolcontext.value;

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
