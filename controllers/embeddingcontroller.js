const { embedding } = require('../utils/ChatGPT');

// Require necessary database models
const { ChatModel, Chat2Model, OpenaichatModel, EmbeddingModel } = require('../database');

exports.index = async (req, res) => {
  res.render('embedding_wait');

  const embeddings = await EmbeddingModel.find();
  const database_id_lookup = [];
  for (let i = 0; i < embeddings.length; i++) {
    database_id_lookup.push(embeddings[i].database_id);
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

      await sleep(20);
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

      await sleep(20);
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

      await sleep(20);
    }
  }

  console.log(`Saving ${embeddings_to_save.length} embeddings!`);
  
  // Save to database
  if (embeddings_to_save.length > 0) {
    EmbeddingModel.collection.insertMany(embeddings_to_save);
  }
};

/*
  database: { type: String, required: true },
  database_id: { type: String, required: true },
  embedding: { type: [Number], required: true },
  tokens: { type: Number, required: true },
*/

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
