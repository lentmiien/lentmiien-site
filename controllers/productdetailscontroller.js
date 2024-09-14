const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const KnowledgeService = require('../services/knowledgeService');
const BatchService = require('../services/batchService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, FileMetaModel, BatchPromptModel, BatchRequestModel, ProductDetails } = require('../database');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);
const batchService = new BatchService(BatchPromptModel, BatchRequestModel, messageService, conversationService);

exports.product = async (req, res) => {
  const products = await ProductDetails.find();
  res.render('products', {products});
};

exports.upload_product_data = async (req, res) => {}

exports.update_product = async (req, res) => {}

// exports.receipt = async (req, res) => {
//   const receipts = await Receipt.find();
//   res.render('receipt', {receipts});
// };

// exports.upload_receipt = async (req, res) => {
//   const user_id = req.user.name;
//   let use_conversation_id = "new";

//   // Context and Prompt
//   const context = `You are about to use OpenAI's vision model to process receipts, primarily in Japanese. Your task is to accurately extract specific pieces of information from each receipt and present them in a consistent JSON format. The information you need to extract includes:\n\n1. Date of the purchase.\n2. Time of the purchase.\n3. Total purchase amount.\n4. Payment method (e.g., credit card, cash).\n5. Information identifying the business where the purchase was made (e.g., business name, address).\n\nPlease ensure that the output JSON format remains consistent across different receipts.\n\nHere is the JSON template you should use for the output:\n\n{\n  "date": "YYYY-MM-DD",\n  "time": "HH:MM",\n  "total_amount": "X,XXX.XX",\n  "payment_method": "credit card/cash",\n  "business_info": {\n    "name": "Business Name",\n    "address": "Business Address"\n  }\n}`;
//   const prompt = `Please extract the following details from the receipt provided:\n1. Date of the purchase.\n2. Time of the purchase.\n3. Total purchase amount.\n4. Payment method (e.g., credit card, cash).\n5. Information identifying the business where the purchase was made (e.g., business name, address).\n\nAssume most receipts will be in Japanese. The output should be structured in the given JSON format.\n\nExample JSON output:\n\n{\n  "date": "YYYY-MM-DD",\n  "time": "HH:MM",\n  "total_amount": "X,XXX.XX",\n  "payment_method": "credit card/cash",\n  "business_info": {\n    "name": "Business Name",\n    "address": "Business Address"\n  }\n}\n\nMake sure to follow this template strictly for consistent results.`;

//   // Post message to conversation
//   const image_paths = [];
//   for (let i = 0; i < req.files.length; i++) {
//     image_paths.push(req.files[i].destination + req.files[i].filename);
//   }
//   const conversation_id = await conversationService.postToConversation(user_id, use_conversation_id, image_paths, {title:"Receipt", category:"OCR", tags:"receipt", context, prompt}, "OpenAI_mini");

//   // Process result and save to Receipt database
//   const conversation = await conversationService.getConversationsById(conversation_id);
//   const messages = await messageService.getMessagesByIdArray(conversation.messages);
//   const data = ParseData(messages[0].response)

//   const newReceipt = new Receipt({
//     date: new Date(data.date),
//     amount: parseInt(data.total_amount.split(',').join('').split('.')[0]),
//     method: data.payment_method,
//     business_name: data.business_info.name,
//     business_address: data.business_info.address,
//     file: messages[0].images[0].filename,
//   });
//   await newReceipt.save();

//   // Add summary request to batch process
//   const title = `Receipt ${data.date}`;
//   await conversationService.updateConversation(conversation_id, {title, category:"OCR", tags:"receipt", context, prompt});
//   await batchService.addPromptToBatch(user_id, "@SUMMARY", conversation_id, [], {title}, "gpt-4o-mini");

//   res.render("upload_receipt", {receipt: newReceipt});
// };

// exports.view_receipt = async (req, res) => {
//   const receipt = await Receipt.findById(req.params.id);
//   res.render("upload_receipt", {receipt});
// }

// exports.correct_receipt = async (req, res) => {
//   const receipt = await Receipt.findById(req.params.id);

//   receipt.date = new Date(req.body.date);
//   receipt.amount = parseInt(req.body.amount);
//   receipt.method = req.body.method;
//   receipt.business_name = req.body.business_name;
//   receipt.business_address = req.body.business_address;
//   await receipt.save();

//   res.redirect('/receipt');
// }

// exports.delete_receipt = async (req, res) => {
//   await Receipt.findByIdAndDelete(req.params.id);
//   res.redirect('/receipt');
// }

// function ParseData(text) {
//   let data = [];
//   let rows = text.split('\n');
//   let inJSON = false;
//   for (let i = 0; i < rows.length; i++) {
//     if (inJSON && rows[i].indexOf("```") >= 0) break;
//     if (inJSON) data.push(rows[i]);
//     if (rows[i].indexOf("```") >= 0) inJSON = true;
//   }
//   return JSON.parse(data.join("\n"));
// }
