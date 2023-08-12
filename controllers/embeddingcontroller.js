const { chatGPT, embedding } = require('../utils/ChatGPT');

// Require necessary database models
const { ChatModel, Chat2Model, OpenaichatModel, EmbeddingModel } = require('../database');

let cached_embeddings = null;
let cache_ts = new Date(0);
let is_updating = false;

async function CacheEmbeddings() {
  cached_embeddings = await EmbeddingModel.find();
  cache_ts = new Date();
}

exports.index = (req, res) => {
  res.render('embeddings_status', {count: cached_embeddings ? cached_embeddings.length : 0, time: cache_ts});
}

exports.update = async (req, res) => {
  res.render('embedding_wait', {is_updating});
  if (is_updating) return;

  is_updating = true;

  await CacheEmbeddings();
  const database_id_lookup = [];
  for (let i = 0; i < cached_embeddings.length; i++) {
    database_id_lookup.push(cached_embeddings[i].database_id);
  }

  const chat = await ChatModel.find();
  const chat2 = await Chat2Model.find();
  const openaichat = await OpenaichatModel.find();
  const embeddings_to_save = [];

  // ChatModel
  for (let i = 0; i < chat.length; i++) {
    const id_str = chat[i]._id.toString();
    if (database_id_lookup.indexOf(id_str) == -1) {
      const text = chat[i].content;
      const response = await embedding(text, "text-embedding-ada-002");
      
      if (response) {
        embeddings_to_save.push({
          database: "ChatModel",
          database_id: id_str,
          embedding: response.data[0].embedding,
          tokens: response.usage.total_tokens,
        });
      }
    }
  }

  // Chat2Model
  for (let i = 0; i < chat2.length; i++) {
    const id_str = chat2[i]._id.toString();
    if (database_id_lookup.indexOf(id_str) == -1) {
      const text = chat2[i].content;
      const response = await embedding(text, "text-embedding-ada-002");
      
      if (response) {
        embeddings_to_save.push({
          database: "Chat2Model",
          database_id: id_str,
          embedding: response.data[0].embedding,
          tokens: response.usage.total_tokens,
        });
      }
    }
  }

  // OpenaichatModel
  for (let i = 0; i < openaichat.length; i++) {
    const id_str = openaichat[i]._id.toString();
    if (database_id_lookup.indexOf(id_str) == -1) {
      const text = openaichat[i].content;
      const response = await embedding(text, "text-embedding-ada-002");
      
      if (response) {
        embeddings_to_save.push({
          database: "OpenaichatModel",
          database_id: id_str,
          embedding: response.data[0].embedding,
          tokens: response.usage.total_tokens,
        });
      }
    }
  }
  
  // Save to database and recache embeddings
  if (embeddings_to_save.length > 0) {
    await EmbeddingModel.collection.insertMany(embeddings_to_save);
    await CacheEmbeddings();
  }

  is_updating = false;
};

exports.query = (req, res) => {
  // Generate embedding for query
  // Find 5 most similar embeddings in embedding database
  // Fetch the chat conversations for the results in previous step
  // Send the 5 most similar texts together with query to ChatGPT (only use the 5 texts, NOT the chat conversations)
  // Return the ChatGPT response and the chat conversations to the user
};
