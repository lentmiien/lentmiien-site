const mongoose = require('mongoose');

const Typecategory = new mongoose.Schema({
  category_name: { type: String, required: true, max: 100 } // Category name
});

module.exports = mongoose.model('typecategory', Typecategory);
