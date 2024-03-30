const mongoose = require('mongoose');

const Chat4 = new mongoose.Schema({
  user_id: { type: String, required: true, max: 100 },
  category: { type: String, required: true, max: 100 },
  tags: [{ type: String, max: 100 }],
  prompt: { type: String, required: true },
  response: { type: String, required: true },
  images: [
    {
      filename: { type: String, required: true },
      use_flag: { type: String, required: true, enum: ['high quality', 'low quality', 'do not use'] },
    }
  ],
  sound: { type: String, required: false, max: 255 },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('chat4', Chat4);
