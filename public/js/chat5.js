// Create a socket connection
const socket = io();

// Listen for messages from the server
socket.on('chat message', function(data) {
  const item = document.createElement('li');
  item.textContent = `${data.userId}: ${data.msg}`;
  document.getElementById('messages').appendChild(item);
  window.scrollTo(0, document.body.scrollHeight);
});

// Handle form submission for sending messages
document.getElementById('message-form').addEventListener('submit', function(e) {
  e.preventDefault(); // Prevent page reload
  const msgInput = document.getElementById('message');
  const msg = msgInput.value;
  socket.emit('chat message', msg); // Send the message to the server
  msgInput.value = ''; // Clear the input field
});