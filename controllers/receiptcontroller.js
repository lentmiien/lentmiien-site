const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const fs = require('fs');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BusinessInfo = z.object({
  name: z.string(),
  address: z.string(),
});
const ReciptDetails = z.object({
  date: z.string(),
  time: z.string(),
  total_amount: z.number(),
  payment_method: z.enum(["credit card", "cash"]),
  business_info: BusinessInfo,
});

const MessageService = require('../services/messageService');
const ConversationService = require('../services/conversationService');
const KnowledgeService = require('../services/knowledgeService');
const { Chat4Model, Conversation4Model, Chat4KnowledgeModel, FileMetaModel, Receipt } = require('../database');

// Instantiate the services
const messageService = new MessageService(Chat4Model, FileMetaModel);
const knowledgeService = new KnowledgeService(Chat4KnowledgeModel);
const conversationService = new ConversationService(Conversation4Model, messageService, knowledgeService);

const normalizeLayoutTexts = (input, count) => {
  if (!count) return [];
  const values = Array.isArray(input) ? input : (input ? [input] : []);
  const normalized = [];
  for (let i = 0; i < count; i++) {
    const rawValue = typeof values[i] === 'string' ? values[i] : '';
    normalized.push(rawValue);
  }
  return normalized;
};

const formatReceiptForJson = (receipt) => ({
  id: receipt._id,
  date: receipt.date,
  amount: receipt.amount,
  method: receipt.method,
  business_name: receipt.business_name,
  business_address: receipt.business_address,
  layout_text: receipt.layout_text,
  file: receipt.file,
});

exports.receipt = async (req, res) => {
  const start = new Date(Date.now() - (1000*60*60*24*30));
  const receipts = await Receipt.find({date: { $gte: start }}).sort('-date');
  res.render('receipt', {receipts});
};

exports.upload_receipt = async (req, res) => {
  // Context and Prompt
  const context = `You are about to use OpenAI's vision model to process receipts, primarily in Japanese. Your task is to accurately extract specific pieces of information from each receipt and present them in a consistent JSON format. The information you need to extract includes:\n\n1. Date of the purchase.\n2. Time of the purchase.\n3. Total purchase amount.\n4. Payment method (e.g., credit card, cash).\n5. Information identifying the business where the purchase was made (e.g., business name, address).\n\nPlease ensure that the output JSON format remains consistent across different receipts.\n\nHere is the JSON template you should use for the output:\n\n{\n  "date": "YYYY-MM-DD",\n  "time": "HH:MM",\n  "total_amount": "X,XXX.XX",\n  "payment_method": "credit card/cash",\n  "business_info": {\n    "name": "Business Name",\n    "address": "Business Address"\n  }\n}`;
  const prompt = `Please extract the following details from the receipt provided:\n1. Date of the purchase.\n2. Time of the purchase.\n3. Total purchase amount.\n4. Payment method (e.g., credit card, cash).\n5. Information identifying the business where the purchase was made (e.g., business name, address).\n\nAssume most receipts will be in Japanese. The output should be structured in the given JSON format.\n\nExample JSON output:\n\n{\n  "date": "YYYY-MM-DD",\n  "time": "HH:MM",\n  "total_amount": "X,XXX.XX",\n  "payment_method": "credit card/cash",\n  "business_info": {\n    "name": "Business Name",\n    "address": "Business Address"\n  }\n}\n\nMake sure to follow this template strictly for consistent results.`;

  const added_array = [];
  const raw_data = [];
  const layoutTexts = normalizeLayoutTexts(req.body.layout_texts, req.files?.length || 0);

  if (!req.files || !req.files.length) {
    if (req.accepts(['html', 'json']) === 'json') {
      return res.status(400).json({ error: 'Please upload at least one receipt image.' });
    }
    return res.status(400).render('receipt', { receipts: added_array, raw_data, error: 'Please upload at least one receipt image.' });
  }

  for (let i = 0; i < req.files.length; i++) {
    const layout_text = (layoutTexts[i] || '').trim();
    const { new_filename, b64_img } = await conversationService.loadProcessNewImageToBase64(req.files[i].destination + req.files[i].filename);
    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: context },
        { role: "user", content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${b64_img}`,
              detail: 'high'
            }
          },
          { type: 'text', text: prompt },
          ...(layout_text ? [{ type: 'text', text: `OCR layout text:\n${layout_text}` }] : []),
        ]},
      ],
      response_format: zodResponseFormat(ReciptDetails, "recipt_details"),
    });
    const recipt_details = JSON.parse(response.choices[0].message.content);

    const newReceipt = new Receipt({
      date: new Date(recipt_details.date),
      amount: recipt_details.total_amount,
      method: recipt_details.payment_method,
      business_name: recipt_details.business_info.name,
      business_address: recipt_details.business_info.address,
      layout_text,
      file: new_filename,
    });
    await newReceipt.save();

    raw_data.push({
      date: recipt_details.date,
      time: recipt_details.time,
      total_amount: recipt_details.total_amount,
      payment_method: recipt_details.payment_method,
      business_info: {
        name: recipt_details.business_info.name,
        address: recipt_details.business_info.address,
      },
      layout_text,
    });
    added_array.push(newReceipt);
  }

  if (req.accepts(['html', 'json']) === 'json') {
    return res.json({ receipts: added_array.map(formatReceiptForJson), raw_data });
  }

  res.render('receipt', {receipts: added_array, raw_data });
};

exports.view_receipt = async (req, res) => {
  const receipt = await Receipt.findById(req.params.id);
  res.render("upload_receipt", {receipt});
}

exports.correct_receipt = async (req, res) => {
  const receipt = await Receipt.findById(req.params.id);

  receipt.date = new Date(req.body.date);
  receipt.amount = parseInt(req.body.amount);
  receipt.method = req.body.method;
  receipt.business_name = req.body.business_name;
  receipt.business_address = req.body.business_address;
  receipt.layout_text = typeof req.body.layout_text === 'string' ? req.body.layout_text : '';
  await receipt.save();

  res.redirect('/receipt');
}

exports.delete_receipt = async (req, res) => {
  await Receipt.findByIdAndDelete(req.params.id);
  res.redirect('/receipt');
}

function ParseData(text) {
  if (text.indexOf("```") >= 0) {
    // Sometimes, the relevant content comes in a markdown code block
    let data = [];
    let rows = text.split('\n');
    let inJSON = false;
    for (let i = 0; i < rows.length; i++) {
      if (inJSON && rows[i].indexOf("```") >= 0) break;
      if (inJSON) data.push(rows[i]);
      if (rows[i].indexOf("```") >= 0) inJSON = true;
    }
    return JSON.parse(data.join("\n"));
  } else {
    // Other times, only the relevant data comes
    return JSON.parse(text);
  }
}
