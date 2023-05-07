const chatGPT = require('../utils/ChatGPT');
const utils = require('../utils/utils');

const { ChatModel, DocumentModel, TextnodeModel } = require('../database');

async function QueryChatGPT(messages, title, username) {
  const data_count = await ChatModel.find();
  const id = data_count.length + 1;

  // Prepare and send request to ChatGPT
  const entries_to_save = [];
  const ts_1 = Date.now() - 2000;
  const ts_2 = ts_1 + 1000;

  // System
  entries_to_save.push({
    title: `DOC [${title}]`,
    username,
    role: messages[0].role,
    content: messages[0].content,
    created: new Date(ts_1),
    tokens: 0,
    threadid: id,
  });
  
  // User
  entries_to_save.push({
    title: `DOC [${title}]`,
    username,
    role: messages[1].role,
    content: messages[1].content,
    created: new Date(ts_2),
    tokens: 0,
    threadid: id,
  });

  // Connect to ChatGPT and get response, then add to entries_to_save
  const response = await chatGPT(messages);
  if (response) {
    entries_to_save.push({
      title: `DOC [${title}]`,
      username,
      role: 'assistant',
      content: response.choices[0].message.content,
      created: new Date(),
      tokens: response.usage.total_tokens,
      threadid: id,
    });
    // Save to database
    ChatModel.collection.insertMany(entries_to_save);

    // Return response
    return response.choices[0].message.content;
  } else {
    console.log('Failed to get a response from ChatGPT.');

    // Return error
    return 'Failed to get a response from ChatGPT.';
  }
}

exports.index = (req, res) => {
  // Display a list of documents and a form for starting a new document
  DocumentModel.find().then(data => {
    res.render("doc_index", {data});
  });
};

const aitypes = {
  'report': 'You are a helpful assistant, skilled at writing reports.',
  'project': 'You are a helpful assistant, and excelent project planner.',
  'meeting': 'You are a helpful assistant, skilled at outlining and planning meetings.',
  'schedule': 'You are a helpful assistant, and excelent schedule planner.',
};

exports.create_document = (req, res) => {
  // Generate the document and save to database
  const title = req.body.title;
  const aitype = req.body.aitype;
  const topic = req.body.topic;
  const entry_to_save = new DocumentModel({
    title: title,
    username: req.user.name,
    ai_type: aitypes[aitype],
    document_type: topic,
    start_date: new Date(),
    end_date: new Date(),
  });

  // Save to database
  entry_to_save.save().then((saved_data) => {
    setTimeout(() => res.redirect(`/gptdocument/document?id=${saved_data._id}`), 100);
  });
};

exports.document = (req, res) => {
  // Display document details and the document tree, and various action inputs
  const id = req.query.id;
  DocumentModel.findById(id).then(doc => {
    TextnodeModel.find({document_id: id}).then(text => {
      res.render("document", {doc, text});
    });
  });
};

exports.branch = (req, res) => {
  const document_id = req.query.document_id;
  const parent_node_id = req.query.parent_node_id;
  const parent_node_index = parseInt(req.query.parent_node_index);
  DocumentModel.findById(document_id).then(doc => {
    if (parent_node_id != "text") {
      TextnodeModel.findById(parent_node_id).then(text => {
        // Render edit page for user
        res.render("text_edit", {
          document_id,
          parent_node_id,
          parent_node_index,
          additional_context: text.additional_context,
          title: text.title,
          ai_type: doc.ai_type,
          document_type: doc.document_type,
          prompt: JSON.parse(text.text)[parent_node_index],
          text: "Output has not yet been generated...",
        });
      });
    } else {
      // Render edit page for user
      res.render("text_edit", {
        document_id,
        parent_node_id,
        parent_node_index,
        additional_context: "",
        title: doc.title,
        ai_type: doc.ai_type,
        document_type: doc.document_type,
        prompt: "",
        text: "Output has not yet been generated...",
      });
    }
  });
};

exports.generate_text_node = (req, res) => {
  // Edit and prepare text
  const document_id = req.body.document_id;
  const parent_node_id = req.body.parent_node_id;
  const parent_node_index = req.body.parent_node_index.length > 0 ? parseInt(req.body.parent_node_index) : 0;
  const additional_context = req.body.additional_context;
  const title = req.body.title;
  const ai_type = req.body.ai_type;
  const document_type = req.body.document_type;
  const prompt = req.body.prompt;
  let context = `${ai_type} ${document_type}`;
  if (additional_context.length > 0) {
    context += ` ${additional_context}`
  }

  ChatModel.find().then(async (data_count) => {
    const id = data_count.length + 1;

    // Prepare and send request to ChatGPT
    const messages = [];
    const entries_to_save = [];
    const ts_1 = Date.now() - 2000;
    const ts_2 = ts_1 + 1000;

    // If a new chat, start by adding system message
    messages.push({
      role: 'system',
      content: context,
    });
    entries_to_save.push({
      title: `DOC [${title}]`,
      username: req.user.name,
      role: 'system',
      content: context,
      created: new Date(ts_1),
      tokens: 0,
      threadid: id,
    });
    
    // Add new message
    messages.push({
      role: 'user',
      content: prompt,
    });
    entries_to_save.push({
      title: `DOC [${title}]`,
      username: req.user.name,
      role: 'user',
      content: prompt,
      created: new Date(ts_2),
      tokens: 0,
      threadid: id,
    });
    // Connect to ChatGPT and get response, then add to entries_to_save
    const response = await chatGPT(messages);
    if (response) {
      entries_to_save.push({
        title: `DOC [${title}]`,
        username: req.user.name,
        role: 'assistant',
        content: response.choices[0].message.content,
        created: new Date(),
        tokens: response.usage.total_tokens,
        threadid: id,
      });
      // Save to database
      ChatModel.collection.insertMany(entries_to_save);

      // Render edit page for user
      res.render("text_edit", {
        document_id,
        parent_node_id,
        parent_node_index,
        additional_context,
        title,
        ai_type,
        document_type,
        prompt,
        text: response.choices[0].message.content
      });
    } else {
      console.log('Failed to get a response from ChatGPT.');

      // Render edit page for user
      res.render("text_edit", {
        document_id,
        parent_node_id,
        parent_node_index,
        additional_context,
        title,
        ai_type,
        document_type,
        prompt,
        text: 'Failed to get a response from ChatGPT.'
      });
    }
  });
};

exports.save_text_node = (req, res) => {
  // console.log(req.body);

  // Save text node
  const document_id = req.body.document_id;
  const parent_node_id = req.body.parent_node_id;
  const parent_node_index = req.body.parent_node_index.length > 0 ? parseInt(req.body.parent_node_index) : 0;
  const additional_context = req.body.additional_context;
  const title = req.body.title;
  const chunk_data_array = [];
  let not_done = true;
  let last_index = -1;
  for (let i = 0; i < 999 && not_done; i++) {
    if (`chunk${i}` in req.body) {
      const chunk_data = req.body[`chunk${i}`];
      const chunk_id = req.body[`chunk${i}_id`];
      if (last_index == chunk_id) {
        chunk_data_array[chunk_data_array.length-1] += `\n${chunk_data}`;
      } else {
        chunk_data_array.push(chunk_data);
        last_index = chunk_id;
      }
    } else {
      not_done = false;
    }
  }

  // Generate the textnode and save to database
  const entry_to_save = new TextnodeModel({
    document_id,
    parent_node_id: parent_node_id.length == 0 ? "text" : parent_node_id,
    parent_node_index,
    additional_context,
    title,
    text: JSON.stringify(chunk_data_array),
    status: "",
    remaining_status: "",
    updated_date: new Date(),
  });

  // Save to database
  entry_to_save.save().then((saved_data) => {
    setTimeout(() => res.redirect(`/gptdocument/document?id=${document_id}`), 100);
  });
};

exports.view = (req, res) => {
  // Display full document without any input controlls (suitable for printing)
  const id = req.query.id;
  DocumentModel.findById(id).then(doc => {
    TextnodeModel.find({document_id: id}).then(async text => {
      res.render("view", {doc, text, lang: "lang" in req.query ? req.query.lang : "original"});
    });
  });
};

exports.translate = async (req, res) => {
  // Get a message array in body, just send to QueryChatGPT() and return response as JSON
  const resp = await QueryChatGPT(req.body.messages, "Translate", req.user.name);
  res.json({resp});
};

exports.update_progress = (req, res) => {
  // If the document is a project, then you can submit progress updates
};

exports.report = (req, res) => {
  // If the document is a project, then you can generate a report on the project
};

exports.specifications = (req, res) => {
  res.render("gptdocumentspecifications")
};

exports.deletedocument = (req, res) => {
  DocumentModel.findByIdAndRemove(req.query.id).then(() => {
    TextnodeModel.deleteMany({parent_node_id: req.query.id}).then(() => {
      setTimeout(() => res.redirect("/gptdocument"), 500);
    });
  });
};
