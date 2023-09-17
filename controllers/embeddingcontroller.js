const fs = require('fs');
const path = require('path');

const { chatGPT, embedding } = require('../utils/ChatGPT');
const utils = require('../utils/utils');

// Require necessary database models
const { ChatModel, Chat2Model, OpenaichatModel, EmbeddingModel } = require('../database');

const db = {
  ChatModel,
  Chat2Model,
  OpenaichatModel,
};

let cached_embeddings = require('../cache/embedding.json');
let cache_ts = new Date(0);
let is_updating = false;

async function CacheEmbeddings() {
  cached_embeddings = await EmbeddingModel.find();
  cache_ts = new Date();

  // Convert the object to a JSON string
  const jsonString = JSON.stringify(cached_embeddings);

  // Construct the output path relative to this script's location
  const outputPath = path.join(__dirname, '../cache/embedding.json');

  // Save the JSON string to a file
  fs.writeFile(outputPath, jsonString, (err) => {
    if (err) {
        console.error('Error writing file:', err);
    } else {
        console.log('File saved successfully!');
    }
  });
}

exports.index = (req, res) => {
  res.render('embeddings_status', {count: cached_embeddings.length, time: cache_ts});
}

exports.update = async (req, res) => {
  res.render('embedding_wait', {is_updating});
  if (is_updating) return;

  is_updating = true;
  await CacheEmbeddings(); // Need to start by caching the current embeddings, in case there are newer data in database, so that no duplicates are saved

  const database_id_lookup = [];
  for (let i = 0; i < cached_embeddings.length; i++) {
    database_id_lookup.push(cached_embeddings[i].database_id);
  }

  const chat = await ChatModel.find({role: 'assistant'});
  const chat2 = await Chat2Model.find({role: 'assistant'});
  const openaichat = await OpenaichatModel.find({role: 'assistant'});
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

exports.query = async (req, res) => {
  if (cached_embeddings && cached_embeddings.length > 0) {
    // Generate embedding for query
    const response = await embedding(req.body.query, "text-embedding-ada-002");
    
    // Find 10 most similar embeddings in embedding database
    const texts = await findSimilarTexts(response.data[0].embedding);

    // Fetch the chat conversations for the results in previous step
    const chat_texts = [];
    for (let i = 0; i < texts.length; i++) {
      const entry = await db[texts[i].database].find({_id: texts[i].database_id});
      chat_texts.push(entry[0]);
    }
    const conversations = [];
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].database == "OpenaichatModel") {
        const entries = await db[texts[i].database].find({thread_id: chat_texts[i].thread_id});
        conversations.push(entries);
      } else {
        const entries = await db[texts[i].database].find({threadid: chat_texts[i].threadid});
        conversations.push(entries);
      }
    }

    // Send the 10 most similar texts together with query to ChatGPT (only use the 10 texts, NOT the chat conversations)
    const id = (await Chat2Model.count()) + 1;
    const messages = [];
    const entries_to_save = [];
    let token_counter = 0;
    const ts = Date.now();
    for (let i = 0; i < chat_texts.length; i++) {
      messages.push({
        role: 'system',
        content: chat_texts[i].content,
      });
      entries_to_save.push({
        title: req.body.title,
        username: req.user.name,
        role: 'system',
        model: i == 0 ? "text-embedding-ada-002" : req.body.model,
        content: chat_texts[i].content,
        created: new Date(ts + i),
        tokens: i == 0 ? response.usage.total_tokens : 0,
        threadid: id,
      });
      token_counter += texts[i].tokens;
    }
    token_counter += utils.estimateTokens(req.body.query);
    // Select model based on token count
    let selected_model = req.body.model;
    if (selected_model == "gpt-3.5-turbo" && token_counter > 3000) {
      selected_model = "gpt-3.5-turbo-16k";
    }
    if (selected_model == "gpt-3.5-turbo-16k" && token_counter > 15000) {
      selected_model = "gpt-4-32k";
    }
    if (selected_model == "gpt-4" && token_counter > 7000) {
      selected_model = "gpt-4-32k";
    }
    // Add query message
    messages.push({
      role: 'user',
      content: req.body.query,
    });
    entries_to_save.push({
      title: req.body.title,
      username: req.user.name,
      role: 'user',
      model: selected_model,
      content: req.body.query,
      created: new Date(ts + 10),
      tokens: 0,
      threadid: id,
    });
    // Connect to ChatGPT and get response, then add to entries_to_save
    const gpt_response = await chatGPT(messages, selected_model);
    if (gpt_response) {
      const user_index = entries_to_save.length - 1;
      console.log(`Approximated tokens: ${token_counter}; Actual tokens: ${response.usage.prompt_tokens}; Error: ${token_counter - response.usage.prompt_tokens}`)
      entries_to_save[user_index].tokens = gpt_response.usage.prompt_tokens;
      entries_to_save.push({
        title: req.body.title,
        username: req.user.name,
        role: 'assistant',
        model: selected_model,
        content: gpt_response.choices[0].message.content,
        created: new Date(ts + 11),
        tokens: gpt_response.usage.completion_tokens,
        threadid: id,
      });
      // Save to database
      Chat2Model.collection.insertMany(entries_to_save);

      // Return the ChatGPT response and the chat conversations to the user
      res.render("embedding_query", {query: req.body.query, answer: gpt_response.choices[0].message.content, refs: chat_texts, conversations});
    } else {
      console.log('Failed to get a response from ChatGPT.');
      res.redirect(`/embedding`);
    }
  } else {
    res.redirect('/embedding');
  }
};

exports.find = async (req, res) => {
  if (cached_embeddings && cached_embeddings.length > 0) {
    // Generate embedding for query
    const response = await embedding(req.body.find, "text-embedding-ada-002");
    
    // Find 10 most similar embeddings in embedding database
    const texts = await findSimilarTexts(response.data[0].embedding);

    // Fetch the chat conversations for the results in previous step
    const chat_texts = [];
    for (let i = 0; i < texts.length; i++) {
      const entry = await db[texts[i].database].find({_id: texts[i].database_id});
      chat_texts.push(entry[0]);
    }
    const conversations = [];
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].database == "OpenaichatModel") {
        const entries = await db[texts[i].database].find({thread_id: chat_texts[i].thread_id});
        conversations.push(entries);
      } else {
        const entries = await db[texts[i].database].find({threadid: chat_texts[i].threadid});
        conversations.push(entries);
      }
    }

    res.render("embedding_find", {query: req.body.find, refs: chat_texts, conversations});
  } else {
    res.redirect('/embedding');
  }
};

function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

async function findSimilarTexts(queryEmbedding) {
  const similarities = cached_embeddings.map(e => ({
    database: e.database,
    database_id: e.database_id,
    similarity: cosineSimilarity(queryEmbedding, e.embedding),
    tokens: e.tokens,
  }));

  return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
}
