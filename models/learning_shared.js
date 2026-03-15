const mongoose = require('mongoose');

const { Schema } = mongoose;

const artSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ['builtin', 'emoji', 'image'],
      default: 'emoji',
    },
    value: {
      type: String,
      default: '',
      trim: true,
      maxlength: 512,
    },
  },
  {
    _id: false,
  }
);

const themeSchema = new Schema(
  {
    accentColor: { type: String, default: '', trim: true, maxlength: 32 },
    accentColorSoft: { type: String, default: '', trim: true, maxlength: 32 },
    backgroundStart: { type: String, default: '', trim: true, maxlength: 32 },
    backgroundEnd: { type: String, default: '', trim: true, maxlength: 32 },
    glowColor: { type: String, default: '', trim: true, maxlength: 48 },
    backgroundImageUrl: { type: String, default: '', trim: true, maxlength: 2048 },
    pattern: { type: String, default: '', trim: true, maxlength: 64 },
    iconArt: { type: artSchema, default: () => ({}) },
    mascotArt: { type: artSchema, default: () => ({}) },
    badgeArt: { type: artSchema, default: () => ({}) },
  },
  {
    _id: false,
  }
);

const rewardSchema = new Schema(
  {
    label: {
      type: String,
      default: '',
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 280,
    },
    stickerArt: {
      type: artSchema,
      default: () => ({}) },
  },
  {
    _id: false,
  }
);

module.exports = {
  artSchema,
  themeSchema,
  rewardSchema,
};
