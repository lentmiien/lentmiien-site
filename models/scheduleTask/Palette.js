const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const paletteSchema = new Schema({
  key:       { type: String, required: true, unique: true }, // e.g. 'location.home' or 'purpose.work'
  bgColor:   { type: String, default: null },                // #AABBCC (HEX)
  border:    { type: String, default: null }                 // HEX
});

module.exports = model('Palette', paletteSchema);
