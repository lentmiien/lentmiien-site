const mongoose = require('mongoose');

const Category_db = new mongoose.Schema({
  title: { type: String, required: true }, // Category name
  type: { type: String, required: true }, // Category type
});

module.exports = mongoose.model('category_db', Category_db);
