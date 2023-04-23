const mongoose = require('mongoose');

const Article = new mongoose.Schema({
  title: { type: String, required: true, max: 100 },
  category: { type: String, required: true, max: 100 },
  content: { type: String, required: true },
  created: { type: Date, required: true },
  updated: { type: Date, required: true },
});

module.exports = mongoose.model('article', Article);
