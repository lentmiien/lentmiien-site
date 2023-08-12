const { embedding } = require('../utils/ChatGPT');

// Require necessary database models
// const { ChatModel } = require('../database');

exports.index = async (req, res) => {
  const text = "Hello world!";
  const response = await embedding(text, "text-embedding-ada-002");
  res.render("embedding_test", {text, response});
};
