const mongoose = require('mongoose');

const Textnode = new mongoose.Schema({
  document_id: { type: String, required: true },
  parent_node_id: { type: String, required: false },
  parent_node_index: { type: Number, required: true },
  additional_context: { type: String, required: false },
  title: { type: String, required: true, max: 100 },
  text: { type: String, required: true },
  status: { type: String, required: false },
  remaining_status: { type: String, required: false },
  updated_date: { type: Date, required: true },
});

module.exports = mongoose.model('textnode', Textnode);
