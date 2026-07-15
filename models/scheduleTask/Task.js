const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const taskSchema = new Schema({
  userId:     { type: String, required: true, index: true },

  title:      { type: String, required: true, trim: true },
  description:{ type: String },

  type:       { 
    type: String, 
    required: true, 
    enum: ['presence', 'todo', 'tobuy'],
    index: true
  },

  // Only for presence
  location:   { type: String, default: null },
  purpose:    { type: String, default: null },

  start:      { type: Date, default: null }, // start of block, task earliest appear
  end:        { type: Date, default: null }, // end of block, or task's deadline

  done:       { type: Boolean, default: false },

  meta:       { type: Schema.Types.Mixed }
}, { timestamps: true });

/* ----------------------
 * HOOKS AND VALIDATION
 * ---------------------- */
taskSchema.pre('validate', function() {
  if (this.type === 'presence') {
    if (!this.location) throw new Error('Presence must have a location');
    if (!this.start || !this.end) throw new Error('Presence must have start and end');
    if (this.end <= this.start) throw new Error('Presence end must be after start');
  }
});

// Client-side, or service will check for overlap

module.exports = model('Task', taskSchema);
