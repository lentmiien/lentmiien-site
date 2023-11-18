const this_conversation = JSON.parse(document.getElementById("this_conversation").innerText);
const chats = JSON.parse(document.getElementById("chats").innerText);
const new_conversation_id = parseInt(document.getElementById("new_conversation_id").innerText);

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
  if (head_index < 0) return;// NEW conversation

  // Delete current conversation
  const chatmessages_element = document.getElementById("chatmessages");
  chatmessages_element.innerHTML = "";

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
      chatmessages_element.innerHTML += `<div class="row"><div class="col-11"><div class="assistant">${thread[i].html}</div></div><div class="col-1 centered-container"><button class="btn btn-primary">...</button></div></div>`;
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
