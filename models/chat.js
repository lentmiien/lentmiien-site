const mongoose = require('mongoose');

const Chat = new mongoose.Schema({
  title: { type: String, required: true, max: 100 },
  username: { type: String, required: true, max: 100 },
  role: { type: String, required: true, max: 100 },
  content: { type: String, required: true },
  created: { type: Date, required: true },
  tokens: { type: Number, required: true },
  threadid: { type: Number, required: true },
});

module.exports = mongoose.model('chat', Chat);
