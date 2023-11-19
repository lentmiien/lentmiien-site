const this_conversation = JSON.parse(document.getElementById("this_conversation").innerText);
const chats = JSON.parse(document.getElementById("chats").innerText);
const new_conversation_id = parseInt(document.getElementById("new_conversation_id").innerText);
const model = document.getElementById("model");

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

// Populate chat history and chat heads menus
function PopulateMenus() {
  // Fill in conversation history
  // Fill in conversation heads
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
      chatmessages_element.innerHTML += `<div class="row"><div class="col-11"><div class="assistant">${thread[i].html}</div></div><div class="col-1 centered-container"><button class="btn btn-primary" onclick="ShowPopup('${thread[i]._id}')">...</button></div></div>`;
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
}

// Populate #tool_chatmessages
function PopulateTool(mid) {
  // Delete current conversation
  const chatmessages_element = document.getElementById("tool_chatmessages");
  chatmessages_element.innerHTML = "";

  const thread = [];
  for (let c = id_to_index_map[mid]; c != -1; c = this_conversation[c].PreviousMessageID === "root" ? -1 : id_to_index_map[this_conversation[c].PreviousMessageID]) {
    thread.push({
      _id: this_conversation[c]._id.toString(),
      text: this_conversation[c].ContentText,
      html: this_conversation[c].HTMLText,
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
      chatmessages_element.innerHTML += `<div class="row"><div class="col"><div class="user"><input type="checkbox" data-id="${thread[i]._id}" name="msg">${thread[i].html}</div></div></div>`;
    } else {
      // Chatbot message
      chatmessages_element.innerHTML += `<div class="row"><div class="col"><div class="assistant"><input type="checkbox" data-id="${thread[i]._id}" name="msg">${thread[i].html}</div></div></div>`;
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
}


//message_id
// Send a new inquery, appending to the selected node in the conversation
async function SendTool() {
  const index = id_to_index_map[document.getElementById("message_id").innerText];
  const id = (index >= 0 ? this_conversation[index].ConversationID : new_conversation_id);
  const context = document.getElementById("tool_input_context").value;
  const prompt = document.getElementById("tool_input").value;
  let root = (index >= 0 ? this_conversation[index].StartMessageID : "root");
  const head_id = document.getElementById("message_id").innerText;
  const title = tooltitle.value;
  const api_model = model.value;

  // Change root to first checked message
  const checkboxes = document.getElementsByName("msg");
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
}