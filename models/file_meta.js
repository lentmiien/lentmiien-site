const mongoose = require('mongoose');

const File_meta = new mongoose.Schema({
  filename: { type: String, required: true, max: 100 },
  filetype: { type: String, required: true, max: 16 },
  path: { type: String, required: true },
  is_url: { type: Boolean, required: true },
  prompt: { type: String, required: true },
  created_date: { type: Date, required: true },
  other_meta_data: { type: String, required: true },
});

module.exports = mongoose.model('file_meta', File_meta);
