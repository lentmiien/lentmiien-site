const mongoose = require('mongoose');
// Fixed, versioned slots. The built-in unique _id index is the entire GET access path.
const schema = new mongoose.Schema({
  _id: String,
  order: { type: String, required: true },
  signature: String,
  data: { type: mongoose.Schema.Types.Mixed, required: true },
}, { minimize: false, versionKey: false });
module.exports = mongoose.model('disaster_local_summary', schema, 'disaster_local_summaries');
