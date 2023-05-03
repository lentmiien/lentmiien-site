const chatGPT = require('../utils/ChatGPT');
const utils = require('../utils/utils');

const { DocumentModel, TextnodeModel } = require('../database');

exports.index = (req, res) => {
  // Display a list of documents and a form for starting a new document
  DocumentModel.find().then(data => {
    res.render("doc_index", data);
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
  const entry_to_save = {
    title: title,
    username: req.user.name,
    ai_type: aitypes[aitype],
    document_type: topic,
    start_date: new Date(),
    end_date: new Date(),
  };

  // Save to database
  DocumentModel.collection.insertOne(entry_to_save).then(data => {
    setTimeout(() => res.redirect(`/gptdocument/document?id=${data._id}`), 100);
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

exports.generate_text_node = (req, res) => {
  // Edit and prepare text
};

exports.finalize = (req, res) => {
  // Show a final version of the document, can optionally translate
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