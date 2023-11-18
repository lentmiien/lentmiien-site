const this_conversation = JSON.parse(document.getElementById("this_conversation"));
const chats = JSON.parse(document.getElementById("chats"));
const new_conversation_id = parseInt(document.getElementById("new_conversation_id"));

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
this_conversation.forEach((d, i) => {
  id_to_index_map[d._id.toString()] = i;
  refer_count.push(0);
});
this_conversation.forEach((d, i) => {
  if (d.PreviousMessageID != "root") {
    refer_count[id_to_index_map[d.PreviousMessageID]]++;
  }
});
// Pre-process data [chats]
chats.sort((a,b) => {
  if (a.last_timestamp > b.last_timestamp) return -1;
  if (a.last_timestamp < b.last_timestamp) return 1;
  return 0
});

// Populate chat history and chat heads menus
function PopulateMenus() {}

// Populate #chatmessages
function Populate(head_index) {
  /* USER message
  .row 
    .col-1.centered-container
      button.btn.btn-primary 1/2 <- hide this button if 1/1
    .col-11
      p.user My 3 year son brin...
  */
  /* ASSISTANT message
  .row 
    .col-11
      p.assistant It's quite common for toddlers atte...
    .col-1.centered-container
      button.btn.btn-primary ...
  */
}

function ScrollToBottomOfConversation() {
  const scroll_elements = document.getElementsByClassName("scroll-end");
  for (let i = 0; i < scroll_elements.length; i++) {
    scroll_elements[i].scrollTo(0, scroll_elements[i].scrollHeight);
  }
}