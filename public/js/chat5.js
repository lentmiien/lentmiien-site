// Create a socket connection
const socket = io();

// Elements
const messagesList = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message');

// Variables to keep track of the assistant's response
let assistantMessageElement = null;

// Handle form submission for sending messages
messageForm.addEventListener('submit', function (e) {
  e.preventDefault(); // Prevent page reload
  const msg = messageInput.value.trim();
  if (msg === '') return;
  
  // Display user's message in the chat
  addMessageToChat('You', msg);

  // Send the message to the server
  socket.emit('userMessage', msg);

  // Clear the input field
  messageInput.value = '';

  // Disable the input field until the assistant's response is complete
  messageInput.disabled = true;
  messageInput.placeholder = 'Waiting for assistant response...';

  // Prepare a new message element for the assistant's response
  assistantMessageElement = addMessageToChat('Assistant', '');
});

// Handle incoming chunks from the server
socket.on('aiResponseChunk', function (chunk) {
  if (assistantMessageElement) {
    // Append the new chunk to the existing content
    assistantMessageElement.dataset.content += chunk;

    // Update the HTML content by converting Markdown to HTML
    assistantMessageElement.innerHTML = `<strong>Assistant:</strong><br>${marked.parse(assistantMessageElement.dataset.content)}`;
  }
});

// Handle end of assistant's response
socket.on('aiResponseEnd', function () {
  // Re-enable the input field
  messageInput.disabled = false;
  messageInput.placeholder = 'Type your message here...';

  // Reset assistant message element
  assistantMessageElement = null;
});

// Handle errors
socket.on('error', function (errorMessage) {
  alert(errorMessage);

  // Re-enable the input field in case of error
  messageInput.disabled = false;
  messageInput.placeholder = 'Type your message here...';
});

// Function to add a message to the chat
function addMessageToChat(sender, messageContent) {
  const item = document.createElement('li');

  // Use a data attribute to store the content (for incremental updates)
  item.dataset.content = messageContent;

  // Set initial content (converted from Markdown to HTML)
  item.innerHTML = `<strong>${sender}:</strong><br>${marked.parse(messageContent)}`;

  messagesList.appendChild(item);
  window.scrollTo(0, document.body.scrollHeight);

  return item;
}