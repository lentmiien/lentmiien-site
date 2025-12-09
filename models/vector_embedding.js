const mongoose = require('mongoose');

const { Schema } = mongoose;

const SourceMetadataSchema = new Schema({
  collectionName: { type: String, required: true },
  documentId: { type: String, required: true },
  contentType: { type: String, required: true },
  parentCollection: { type: String, default: null },
  parentId: { type: String, default: null },
}, { _id: false });

const ChunkMetadataSchema = new Schema({
  textIndex: { type: Number, default: 0 },
  chunkIndex: { type: Number, default: 0 },
  startToken: { type: Number, default: 0 },
  endToken: { type: Number, default: 0 },
}, { _id: false });

const VectorEmbeddingSchema = new Schema({
  source: { type: SourceMetadataSchema, required: true },
  chunk: { type: ChunkMetadataSchema, required: true },
  previewText: { type: String, default: '' },
  embedding: { type: [Number], required: true },
  dim: { type: Number, required: true },
  model: { type: String, default: null },
  textLength: { type: Number, default: 0 },
}, {
  timestamps: true,
  versionKey: false,
});

VectorEmbeddingSchema.index({
  'source.collectionName': 1,
  'source.documentId': 1,
  'source.contentType': 1,
  'source.parentCollection': 1,
  'source.parentId': 1,
});

VectorEmbeddingSchema.index({ dim: 1 });

module.exports = mongoose.model('vector_embedding', VectorEmbeddingSchema);
