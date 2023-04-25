// Require necessary database models
const { ChatModel } = require('../database');

exports.index = (req, res) => {
  // Load current database
  // Format data and render index page (chat list and chat window)
  res.render('chat', { usage: 0 });
};

exports.post = (req, res) => {
  // Load current database for given threadid
  // Receive a new chat message from post request
  // Put together API request and send to ChatGPT API
  // Save response to database
  // Reload index page (may need a small delay?)
  res.redirect(`/chat?id=${req.body.id}`);
};
