const this_conversation = JSON.parse(document.getElementById("this_conversation").innerText);
const chats = JSON.parse(document.getElementById("chats").innerText);
const new_conversation_id = parseInt(document.getElementById("new_conversation_id").innerText);
const model = document.getElementById("model");
const chat_templates = JSON.parse(document.getElementById("chat_templates").innerText);

let current_head_index = -1;

/* DATABASE STRUCTURE
  ConversationID: { type: Number, required: true },
  StartMessageID: { type: String, required: true, max: 100 },
  PreviousMessageID: { type: String, required: true, max: 100 },
  ContentText: { type: String, required: true },
  HTMLText: ContentText converted to HTML
  ContentTokenCount: { type: Number, required: true },
  SystemPromptText: { type: String, required: true },
  UserOrAssistantFlag: { type: Boolean, required: true },
  UserID: { type: String, required: true, max: 100 },
  Title: { type: String, required: true, max: 255 },
  Images: { type: String, required: false, max: 255 },
  Sounds: { type: String, required: false, max: 255 },
  Timestamp: { type: Date, required: true },
*/

// Pre-process data [this_conversation]
this_conversation.sort((a,b) => {
  if (a.Timestamp < b.Timestamp) return -1;
  if (a.Timestamp > b.Timestamp) return 1;
  return 0
});
const id_to_index_map = {};
const refer_count = [];
const next_map = [];
this_conversation.forEach((d, i) => {
  id_to_index_map[d._id.toString()] = i;
  refer_count.push(0);
  next_map.push([]);
});
this_conversation.forEach((d, i) => {
  if (d.PreviousMessageID != "root") {
    // Count referenses to each node
    refer_count[id_to_index_map[d.PreviousMessageID]]++;

    // Create mapping to next node (including branching, for branching support)
    next_map[id_to_index_map[d.PreviousMessageID]].push(d._id.toString());
  }
});

// Pre-process data [chats]
chats.sort((a,b) => {
  if (a.last_timestamp > b.last_timestamp) return -1;
  if (a.last_timestamp < b.last_timestamp) return 1;
  return 0
});

const historymodal = document.getElementById('historyModal');

// Populate chat history and chat heads menus
function PopulateMenus() {
  // Fill in conversation history
  // history_list
  const history_list = document.getElementById("history_list");
  // a.dropdown-item(href="/chat3?id=0", title="text of last message") Cold
  chats.forEach((d, i) => {
    if (i < 20) {
      history_list.innerHTML += `<a href="/chat3?id=${d.ConversationID}" class="dropdown-item" title="${d.last_message.split("\"").join("'")}">${d.Title}</a>`;
    }
    historymodal.innerHTML += `<a href="/chat3?id=${d.ConversationID}" class="btn btn-secondary history-button" title="${d.last_message.split("\"").join("'")}">${d.Title}</a>`;
  });

  // Fill in conversation heads
  // #head_list
  const head_list = document.getElementById("head_list");
  // button.dropdown-item(title="head 1 message") Head 1
  refer_count.forEach((cnt, i) => {
    if (cnt === 0) {
      head_list.innerHTML += `<button class="dropdown-item" onclick="Populate(${i})" title="${this_conversation[i].ContentText.split("\"").join("'")}">Node ${i}</button>`;
    }
    //Populate(id_to_index_map[head]);
  });
  
  // Display initial chat thread
  Populate(this_conversation.length-1);
}

// Populate #chatmessages
function Populate(head_index) {
  // Delete current conversation
  const chatmessages_element = document.getElementById("chatmessages");
  chatmessages_element.innerHTML = "";

  if (head_index < 0) {
    // NEW conversation, show title and context input
    const title = document.createElement("input");
    title.id = "new_title";
    title.classList.add("form-control");
    title.placeholder = "Enter a title:"
    title.title = "Conversation title";
    const label = document.createElement("label");
    label.for = "new_context";
    label.innerText = "Context";
    const ta = document.createElement("textarea");
    ta.id = "new_context";
    ta.classList.add("form-control");
    ta.value = "You are a helpful assistant.";
    
    chatmessages_element.append(title, label, ta);

    return;
  }

  current_head_index = head_index;

  const thread = [];
  for (let c = head_index; c != -1; c = this_conversation[c].PreviousMessageID === "root" ? -1 : id_to_index_map[this_conversation[c].PreviousMessageID]) {
    thread.push({
      _id: this_conversation[c]._id.toString(),
      text: this_conversation[c].ContentText,
      html: this_conversation[c].HTMLText,
      img: this_conversation[c].Images,
      mp3: this_conversation[c].Sounds,
      user: this_conversation[c].UserOrAssistantFlag,
      prev_id: this_conversation[c].PreviousMessageID,
      prev_count: this_conversation[c].PreviousMessageID === "root" ? 1 : refer_count[id_to_index_map[this_conversation[c].PreviousMessageID]],
      prev_next: this_conversation[c].PreviousMessageID === "root" ? [this_conversation[c]._id.toString()] : next_map[id_to_index_map[this_conversation[c].PreviousMessageID]],
    });
  }

  // Render output
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].user) {
      // User message
      chatmessages_element.innerHTML += `<div class="row"><div class="col-1 centered-container">${thread[i].prev_count > 1 ? '<button class="btn btn-primary" onclick="ChangeBranch(\'' + thread[i].prev_id + '\', ' + ((thread[i].prev_next.indexOf(thread[i]._id) + 1) % thread[i].prev_count) + ')" title="' + this_conversation[id_to_index_map[next_map[id_to_index_map[thread[i].prev_id]][((thread[i].prev_next.indexOf(thread[i]._id) + 1) % thread[i].prev_count)]]].ContentText.split('"').join("'") + '">' + (thread[i].prev_next.indexOf(thread[i]._id) + 1) + '/' + thread[i].prev_count + '</button>' : ''}</div><div class="col-11"><div class="user">${thread[i].html}</div></div></div>`;
    } else {
      // Chatbot message
      let attachments = "";
      if (thread[i].img.length > 0 || thread[i].mp3.length > 0) {
        attachments += "<hr>";
        if (thread[i].img.length > 0) {
          attachments += `<img class="thumbnail" src="${thread[i].img}" alt="DALL-E-3 generated image" onclick="showModalPopup(this)" style="height:100px;">`;
        }
        if (thread[i].mp3.length > 0) {
          attachments += `<audio controls><source src="${thread[i].mp3}" type="audio/mpeg"></audio>`;
        }
        //img(src=`${ig_file}`, alt="DALL-E-3 generated image", style="width:100%;")
        //audio.form-control(controls)
        //  source(src=`${tts_file}`, type="audio/mpeg")
      }
      chatmessages_element.innerHTML += `<div class="row"><div class="col-11"><div class="assistant">${thread[i].html}${attachments}</div></div><div class="col-1 centered-container"><button class="btn btn-primary" onclick="ShowPopup('${thread[i]._id}')">...</button></div></div>`;
    }
  }

  // After displaying, scroll to bottom
  ScrollToBottomOfConversation();
}

function ScrollToBottomOfConversation() {
  const scroll_elements = document.getElementsByClassName("scroll-end");
  for (let i = 0; i < scroll_elements.length; i++) {
    scroll_elements[i].scrollTo(0, scroll_elements[i].scrollHeight);
  }
}

PopulateMenus();

// Control functions
function ChangeBranch(_id, branch) {
  // Find head
  let head;
  for (head = next_map[id_to_index_map[_id]][branch]; next_map[id_to_index_map[head]].length > 0; head = next_map[id_to_index_map[head]][0]) {}
  // Update chat messages displayed
  console.log(_id, branch, head, id_to_index_map[head]);
  Populate(id_to_index_map[head]);
}

// Popup
const btn = document.getElementById("openPopupBtn");
const popup = document.getElementById("popup");
const span = document.getElementById("closePopupBtn");
const conversation_id = document.getElementById("conversation_id");
const message_id = document.getElementById("message_id");
const tool_chatmessages = document.getElementById("tool_chatmessages");
const tooltitle = document.getElementById("tooltitle");
const tool_input_context = document.getElementById("tool_input_context");
const tool_input = document.getElementById("tool_input");
const modal = document.getElementById('imageModal');
const templatemodal = document.getElementById('templateModal');
const modalImg = document.getElementById("fullSizeImage");

function ShowPopup(mid) {
  // Fill in data
  message_id.innerText = mid;
  // tool_chatmessages
  PopulateTool(mid);
  // tooltitle
  tooltitle.value = this_conversation[id_to_index_map[mid]].Title;
  // tool_input_context
  tool_input_context.value = this_conversation[id_to_index_map[mid]].SystemPromptText;

  // Show popup
  popup.style.display = "block";
}

function ClosePopup() {
  popup.style.display = "none";
}

window.onclick = function(event) {
  if (event.target == popup) {
    popup.style.display = "none";
  }
  if (event.target == modal) {
    modal.style.display = "none";
  }
  if (event.target == templatemodal) {
    templatemodal.style.display = "none";
  }
}

function showModalPopup(img) {
  // Get the image and insert it inside the modal
  modalImg.src = img.src;
  
  // Show the modal
  modal.style.display = "block";
}
function showTModalPopup() {
  // Set checkboxes for knowledge entries
  const checkboxes = document.getElementsByName("knowledge");
  const new_context = document.getElementById("new_context");
  const tool_input_context = document.getElementById("tool_input_context");
  let context_text = tool_input_context.value;
  if (new_context) {
    context_text = new_context.value;
  }
  for (let i = 0; i < checkboxes.length; i++) {
    if (context_text.indexOf(checkboxes[i].dataset.id) >= 0) {
      checkboxes[i].checked = true;
    } else {
      checkboxes[i].checked = false;
    }
  }

  // Show the modal
  templatemodal.style.display = "block";
}
function showHModalPopup() {
  // Show the modal
  historymodal.style.display = "block";
}

function ClickKnowledgeCheckbox(element) {
  // Add or remove from context textbox
  const new_context = document.getElementById("new_context");
  const tool_input_context = document.getElementById("tool_input_context");
  let context_text = tool_input_context.value;
  if (new_context) {
    context_text = new_context.value;
  }

  if (element.checked && context_text.indexOf(element.dataset.id) === -1) {
    // Add -> '|title;id;templateId|'
    context_text += `|${element.dataset.name};${element.dataset.id};${element.dataset.templateid}|`;
  }
  if (!element.checked && context_text.indexOf(element.dataset.id) >= 0) {
    // Remove -> '|title;id;templateId|'
    const parts = context_text.split("|");
    const new_parts = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].indexOf(element.dataset.id) >= 0) {
        i++;
      } else {
        new_parts.push(parts[i]);
      }
    }
    context_text = new_parts.join("|");
  }

  if (new_context) {
    new_context.value = context_text;
  } else {
    tool_input_context.value = context_text;
  }
}

// Function to close the popup
function closeModalPopup() {
  modal.style.display = "none";
}
function closeTModalPopup() {
  templatemodal.style.display = "none";
}
function closeHModalPopup() {
  historymodal.style.display = "none";
}

function processTModal(element) {
  chat_templates.forEach(d => {
    if (element.value === d._id) {
      if (d.Type === "context") {
        //tool_input_context
        document.getElementById("tool_input_context").value = d.TemplateText;
        const nc = document.getElementById("new_context");
        if (nc) {
          nc.value = d.TemplateText;
        }
      } else {
        //tool_input
        document.getElementById("tool_input").value = d.TemplateText;
        //input
        document.getElementById("input").value = d.TemplateText;
      }
    }
  });
  closeTModalPopup();
}

// Populate #tool_chatmessages
function PopulateTool(mid) {
  // Delete current conversation
  const chatmessages_element = document.getElementById("tool_chatmessages");
  chatmessages_element.innerHTML = "";

  const start_id = this_conversation[id_to_index_map[mid]].StartMessageID;

  const thread = [];
  for (let c = id_to_index_map[mid]; c != -1; c = this_conversation[c].PreviousMessageID === "root" ? -1 : id_to_index_map[this_conversation[c].PreviousMessageID]) {
    thread.push(this_conversation[c]._id.toString());
    // thread.push({
    //   _id: this_conversation[c]._id.toString(),
    //   text: this_conversation[c].ContentText,
    //   html: this_conversation[c].HTMLText,
    //   img: this_conversation[c].Images,
    //   mp3: this_conversation[c].Sounds,
    //   user: this_conversation[c].UserOrAssistantFlag,
    //   prev_id: this_conversation[c].PreviousMessageID,
    //   prev_count: this_conversation[c].PreviousMessageID === "root" ? 1 : refer_count[id_to_index_map[this_conversation[c].PreviousMessageID]],
    //   prev_next: this_conversation[c].PreviousMessageID === "root" ? [this_conversation[c]._id.toString()] : next_map[id_to_index_map[this_conversation[c].PreviousMessageID]],
    // });
  }

  // Render output
  for (let i = 0; i < this_conversation.length; i++) {
    let conv_msg = true;
    if (thread.indexOf(this_conversation[i]._id.toString()) === -1) {
      conv_msg = false;
    }
    if (this_conversation[i].UserOrAssistantFlag) {
      // User message
      chatmessages_element.innerHTML += `<div class="row"><div class="col"><div class="${conv_msg ? "user" : "system-small"}"><input class="${conv_msg ? "" : "hidden"}" type="radio" data-id="${this_conversation[i]._id.toString()}" name="start"${this_conversation[i]._id.toString() === start_id ? " checked" : ""}><input type="checkbox" data-id="${this_conversation[i]._id.toString()}" name="msg">${this_conversation[i].HTMLText}</div></div></div>`;
    } else {
      // Chatbot message
      let attachments = "";
      if (this_conversation[i].Images.length > 0 || this_conversation[i].Sounds.length > 0) {
        attachments += "<hr>";
        if (this_conversation[i].Images.length > 0) {
          attachments += `<img class="thumbnail" src="${this_conversation[i].Images}" alt="DALL-E-3 generated image" onclick="showModalPopup(this)" style="height:100px;">`;
        }
        if (this_conversation[i].Sounds.length > 0) {
          attachments += `<audio controls><source src="${this_conversation[i].Sounds}" type="audio/mpeg"></audio>`;
        }
      }
      chatmessages_element.innerHTML += `<div class="row"><div class="col"><div class="${conv_msg ? "assistant" : "system-small"}"><input class="${conv_msg ? "" : "hidden"}" type="radio" data-id="${this_conversation[i]._id.toString()}" name="start"${this_conversation[i]._id.toString() === start_id ? " checked" : ""}><input type="checkbox" data-id="${this_conversation[i]._id.toString()}" name="msg">${this_conversation[i].HTMLText}${attachments}</div></div></div>`;
    }
  }

  // After displaying, scroll to bottom
  setTimeout(ScrollToBottomOfConversationTool, 200);
}

function ScrollToBottomOfConversationTool() {
  const scroll_elements = document.getElementsByClassName("tool-scroll-end");
  for (let i = 0; i < scroll_elements.length; i++) {
    scroll_elements[i].scrollTo(0, scroll_elements[i].scrollHeight);
  }

  const popupContent = document.getElementsByClassName("popup-content")[0];
  popupContent.scrollTo(0, popupContent.scrollHeight);
}

// API functions

// Send a new inquery, appending to the latest head in conversation
async function Send() {
  showLoadingPopup();

  const index = current_head_index;
  const id = (index >= 0 ? this_conversation[index].ConversationID : new_conversation_id);
  const context = (index >= 0 ? this_conversation[index].SystemPromptText : document.getElementById("new_context").value);
  const prompt = document.getElementById("input").value;
  const root = (index >= 0 ? this_conversation[index].StartMessageID : "root");
  const head_id = (index >= 0 ? this_conversation[index]._id.toString() : "root");
  const title = (index >= 0 ? this_conversation[index].Title : document.getElementById("new_title").value);
  const api_model = model.value;

  // Set up message array
  const messages = [];
  messages.push({
    role: "user",
    content: prompt,
  });
  for (let i = index; i >= 0; i = (this_conversation[i].PreviousMessageID === "root" || this_conversation[i]._id.toString() === root ? -1 : id_to_index_map[this_conversation[i].PreviousMessageID])) {
    messages.push({
      role: this_conversation[i].UserOrAssistantFlag ? "user" : "assistant",
      content: this_conversation[i].ContentText,
    });
  }
  messages.push({
    role: "system",
    content: context,
  });
  messages.reverse();

  // Call API
  const response = await fetch("/chat3/post", {
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
    body: JSON.stringify({id, messages, root, head_id, title, api_model}), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);
  if(status.status === "OK") {
    open(`/chat3?id=${id}`, "_self");
  } else {
    alert(status.msg);
    hideLoadingPopup();
  }
}

//message_id
// Send a new inquery, appending to the selected node in the conversation
async function SendTool() {
  showLoadingPopup();

  const index = id_to_index_map[document.getElementById("message_id").innerText];
  const id = (index >= 0 ? this_conversation[index].ConversationID : new_conversation_id);
  const context = document.getElementById("tool_input_context").value;
  const prompt = document.getElementById("tool_input").value;
  let root = (index >= 0 ? this_conversation[index].StartMessageID : "root");
  const head_id = document.getElementById("message_id").innerText;
  const title = tooltitle.value;
  const api_model = model.value;

  // Change root to first checked message
  const checkboxes = document.getElementsByName("start");
  for (let i = 0; i < checkboxes.length; i++) {
    if (checkboxes[i].checked) {
      root = checkboxes[i].dataset.id;
      break;
    }
  }

  // Set up message array
  const messages = [];
  messages.push({
    role: "user",
    content: prompt,
  });
  for (let i = index; i >= 0; i = (this_conversation[i].PreviousMessageID === "root" || this_conversation[i]._id.toString() === root ? -1 : id_to_index_map[this_conversation[i].PreviousMessageID])) {
    messages.push({
      role: this_conversation[i].UserOrAssistantFlag ? "user" : "assistant",
      content: this_conversation[i].ContentText,
    });
  }
  messages.push({
    role: "system",
    content: context,
  });
  messages.reverse();

  // Call API
  const response = await fetch("/chat3/post", {
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
    body: JSON.stringify({id, messages, root, head_id, title, api_model}), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);
  if(status.status === "OK") {
    open(`/chat3?id=${id}`, "_self");
  } else {
    alert(status.msg);
    hideLoadingPopup();
  }
}

//message_id
// Ask for a summary of selected nodes, then append to the open node in the conversation
async function SummaryTool(style) {
  showLoadingPopup();

  const index = id_to_index_map[document.getElementById("message_id").innerText];
  const id = (index >= 0 ? this_conversation[index].ConversationID : new_conversation_id);
  const context = document.getElementById("tool_input_context").value + " Your task is to summarize the content of the text provided by the user.";
  const root = (index >= 0 ? this_conversation[index].StartMessageID : "root");
  const head_id = document.getElementById("message_id").innerText;
  const title = tooltitle.value;
  const api_model = model.value;

  // Gather checked messages
  const ids_to_use = [];
  const texts_to_use = [];
  const checkboxes = document.getElementsByName("msg");
  for (let i = 0; i < checkboxes.length; i++) {
    if (checkboxes[i].checked) {
      ids_to_use.push(checkboxes[i].dataset.id);
      const this_index = id_to_index_map[checkboxes[i].dataset.id];
      texts_to_use.push(this_conversation[this_index].ContentText);
    }
  }

  let ttu = "---";
  texts_to_use.forEach((t, i) => {
    ttu += `\n\n**Begin Text ${i+1}:**\n\n${t}\n\n**End Text ${i+1}**\n\n---`;
  });

  let prompt;

  if (style === "summary") {
    prompt = `Hello,\n\nI have collected a series of detailed texts that address related topics, and I am in need of a comprehensive summary. The aim is to have an overarching synopsis that weaves together the main points and themes from all the texts into a single, unified narrative.\n\nAttached/enclosed/inserted below, you will find the full collection of texts:\n\n${ttu}\n\nGiven the complexity and depth of the provided materials, please synthesize the information and create a single, integrated summary. This summary should not treat the texts individually but should combine the critical insights, shared themes, and conclusions that emerge when considering all of the material collectively.\n\nYour help in distilling this information into a concise yet comprehensive summary is much appreciated. Thank you!`;
  } else if (style === "combine") {
    prompt = `Hello,\n\nI am looking to combine several distinct pieces of writing into one coherent, extended document. Each text covers a different topic, and the final document should be organized in such a way that it presents all the information in a clear, logical, and flowing narrative.\n\nAttached/enclosed/inserted below, you will find the series of texts that need to be rearranged and consolidated:\n\n${ttu}\n\nYour task is to rewrite and assimilate these texts into a single document. You may rearrange the content and rephrase sentences as necessary for readability and flow, provided the original meaning is preserved.\n\nTo ensure consistency and readability, please keep the following in mind as you construct the document:\n\n1. Identify common themes or connected ideas across the texts to create a smooth and logical transition from one section to another.\n2. Maintain the integrity of the facts, arguments, and essential points from the original texts while rewriting.\n3. Create headings and subheadings as required to organize the content effectively.\n4. Ensure that the tone and style are consistent throughout the document.\n5. Remove any redundant or repetitive information that occurs due to the merging of the texts.\n\nBy accomplishing this, you will create a comprehensive document that encapsulates all the important information from the initial texts in a well-structured and engaging format.\n\nI appreciate your effort and expertise in completing this task. Thank you!`;
  } else {
    // Catch all case
    prompt = `What are these texts about:\n\n${ttu}`;
  }

  const savePrompt = `Please give me a summary of the texts from messages: ${ids_to_use.join(", ")}`;
  const saveContext = document.getElementById("tool_input_context").value;

  // Set up message array
  const messages = [];
  messages.push({
    role: "user",
    content: prompt,
  });
  messages.push({
    role: "system",
    content: context,
  });
  messages.reverse();

  // Call API
  const response = await fetch("/chat3/post", {
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
    body: JSON.stringify({id, messages, root, head_id, title, api_model, savePrompt, saveContext}), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);
  if(status.status === "OK") {
    open(`/chat3?id=${id}`, "_self");
  } else {
    alert(status.msg);
    hideLoadingPopup();
  }
}

// Function to show the loading popup
function showLoadingPopup() {
  document.getElementById('loadingPopup').style.display = 'block';
  document.body.classList.add('no-scroll'); // Prevent scrolling on the body
}

// Function to hide the loading popup
function hideLoadingPopup() {
  document.getElementById('loadingPopup').style.display = 'none';
  document.body.classList.remove('no-scroll'); // Re-enable scrolling on the body
}

async function GenerateImage() {
  showLoadingPopup();

  const id = document.getElementById("message_id").innerText;
  const index = id_to_index_map[id];
  const conversation_id = (index >= 0 ? this_conversation[index].ConversationID : new_conversation_id);
  const prompt = document.getElementById("tool_input").value;
  const quality = document.getElementById("quality").value;
  const size = document.getElementById("size").value;

  // Call API
  const response = await fetch("/chat3/img", {
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
    body: JSON.stringify({id, prompt, quality, size}), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);
  if(status.status === "OK") {
    open(`/chat3?id=${conversation_id}`, "_self");
  } else {
    alert(status.msg);
    hideLoadingPopup();
  }
}

async function GenerateSound() {
  showLoadingPopup();

  const id = document.getElementById("message_id").innerText;
  const index = id_to_index_map[id];
  const conversation_id = (index >= 0 ? this_conversation[index].ConversationID : new_conversation_id);
  const prompt = document.getElementById("tool_input").value;
  const ttsmodel = document.getElementById("ttsmodel").value;
  const voice = document.getElementById("voice").value;

  // Call API
  const response = await fetch("/chat3/mp3", {
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
    body: JSON.stringify({id, prompt, model: ttsmodel, voice}), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);
  if(status.status === "OK") {
    open(`/chat3?id=${conversation_id}`, "_self");
  } else {
    alert(status.msg);
    hideLoadingPopup();
  }
}

function OpenKDB() {
  const id = document.getElementById("message_id").innerText;
  const index = id_to_index_map[id];
  const conversation_id = (index >= 0 ? this_conversation[index].ConversationID : new_conversation_id);

  open(`/chat3/manage_knowledge_add?id=${conversation_id}&msg_id=${id}`, "_self");
}
