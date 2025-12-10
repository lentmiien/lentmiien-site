const mongoose = require('mongoose');
const BaseVectorEmbedding = require('./vector_embedding');

const VectorEmbeddingHighQualitySchema = BaseVectorEmbedding.schema.clone();

module.exports = mongoose.model(
  'vector_embedding_high_quality',
  VectorEmbeddingHighQualitySchema,
  'vector_embeddings_high_quality',
);
