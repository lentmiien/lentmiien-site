const mongoose = require('mongoose');

const Typetag = new mongoose.Schema({
  tag_name: { type: String, required: true, max: 100 } // Tag name
});

module.exports = mongoose.model('typetag', Typetag);
