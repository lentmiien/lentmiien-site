const mongoose = require('mongoose');

const ingredientSchema = new mongoose.Schema({
  ingredient_label: {
    type: String,
    required: true,
    trim: true,
    max: 200,
  },
  amount: {
    type: Number,
    min: 0,
  },
  amount_unit: {
    type: String,
    trim: true,
    max: 40,
  },
  amount_in_gram: {
    type: Number,
    min: 0,
  },
}, { _id: false });

const nutritionSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true,
    max: 100,
  },
  amount: {
    type: String,
    required: true,
    enum: ['high', 'medium', 'low'],
  },
}, { _id: false });

const textDetailSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true,
    max: 200,
  },
  details: {
    type: String,
    required: true,
    trim: true,
    max: 5000,
  },
}, { _id: false });

const cookbookRecipeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    max: 200,
  },
  originConversationId: {
    type: String,
    default: '',
    max: 100,
  },
  originType: {
    type: String,
    enum: ['chat4', 'chat5'],
    default: 'chat4',
  },
  tags: {
    type: [String],
    default: [],
  },
  images: {
    type: [String],
    default: [],
  },
  originKnowledgeId: {
    type: String,
    default: null,
    max: 100,
  },
  ingredients: {
    type: [ingredientSchema],
    default: [],
  },
  portions: {
    type: Number,
    min: 0,
  },
  calories: {
    type: Number,
    min: 0,
  },
  nutrition: {
    type: [nutritionSchema],
    default: [],
  },
  instructions: {
    type: [textDetailSchema],
    default: [],
  },
  suggestions: {
    type: [textDetailSchema],
    default: [],
  },
  rating: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
  },
  food_category: {
    type: String,
    default: '',
    trim: true,
    max: 100,
  },
  cooking_category: {
    type: String,
    default: '',
    trim: true,
    max: 100,
  },
  cooking_time: {
    type: Number,
    min: 0,
  },
  user_id: {
    type: String,
    required: true,
    max: 100,
  },
}, {
  timestamps: {
    createdAt: 'createdDate',
    updatedAt: 'updatedDate',
  },
});

cookbookRecipeSchema.index({ user_id: 1, updatedDate: -1 });
cookbookRecipeSchema.index({ user_id: 1, originKnowledgeId: 1 });
cookbookRecipeSchema.index({ user_id: 1, food_category: 1 });
cookbookRecipeSchema.index({ user_id: 1, cooking_category: 1 });

module.exports = mongoose.model('cookbook_recipe', cookbookRecipeSchema);
