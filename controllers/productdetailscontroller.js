const OpenAI = require('openai');
const { zodResponseFormat } = require('openai/helpers/zod');
const { z } = require('zod');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CustomsDetails = z.object({
  material: z.string(),
  size: z.string(),
  usage: z.string(),
  additional_notes: z.string(),
});

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

const toSafeString = (value) => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const processProductData = async (dataRows = [], { responseStyle = 'markdown' } = {}) => {
  if (!Array.isArray(dataRows)) {
    throw new Error('Product data must be an array');
  }

  const context = 'You are a helpful assistant, on customs clearance topics.\n\nYour task is to provide customs clearance details for the product details provided, this is the JSON template you should use for the output:\n\n**Response template:**\n\n```json\n{\n  material: "Details about the material of the product",\n  size: "Any sizedetails about the product",\n  usage: "Typical usage of the product",\n  additional_notes: "Other notes about the product, useful for customs clearance",\n}\n```';
  
  const output = [];
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!Array.isArray(row) || row.length < 6) {
      throw new Error(`Invalid product entry at index ${i}: expected an array with at least 6 columns`);
    }

    const product_code = toSafeString(row[0]);
    const name = toSafeString(row[1]);
    const details = toSafeString(row[2]);
    const content = toSafeString(row[3]);
    const description = toSafeString(row[4]);
    const price = row[5];

    if (!product_code || !name) {
      throw new Error(`Invalid product entry at index ${i}: product_code and name are required`);
    }

    const existing = await ProductDetails.find({product_code});
    if (existing.length === 0) {
      const all_details = [];
      if (details.length > 0) {
        all_details.push(`- ${details.split('\n').join('\n- ')}`);
      }
      if (content.length > 0) {
        all_details.push(`Content:\n- ${content.split(']\n').join('] ').split('\n').join('\n- ')}`);
      }
      if (description.length > 0) {
        all_details.push(description);
      }
      const prompt = `Please help me summarize the details of the item below.
The summary is to be used for customs clearance, so material and usage is particularly important, and all texts must be in English.

---

(${product_code})

**Name:** 

${name}

**Price:**

${price} JPY

**Details:**

${all_details.join("\n\n")}

---
`;
      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: context },
          { role: "user", content: [
            { type: 'text', text: prompt }
          ]},
        ],
        response_format: zodResponseFormat(CustomsDetails, "customs_details"),
      });
      const customs_details = JSON.parse(response.choices[0].message.content);
      
      // Save to database
      const newProduct = new ProductDetails({
        product_code,
        name,
        details: details.length === 0 ? name : details,
        content,
        description,
        price,
        ai_description: JSON.stringify(customs_details),
        created: new Date(),
        material: customs_details.material,
        size: customs_details.size,
        usage: customs_details.usage,
        additional_notes: customs_details.additional_notes,
      });
      await newProduct.save();
      if (responseStyle === 'json') {
        output.push({
          product_code,
          name,
          price,
          material: customs_details.material,
          size: customs_details.size,
          usage: customs_details.usage,
          additional_notes: customs_details.additional_notes,
        });
      } else {
        output.push({
          product_code,
          ai_description: `---

- **Name:** ${name}
- **Material:** ${customs_details.material}
- **Size:** ${customs_details.size}
- **Usage:** ${customs_details.usage}
- **Additional Notes:** ${customs_details.additional_notes}
- **Price:** ${price} JPY

---`,
        });
      }
    } else {
      const existingRecord = existing[0];
      if (responseStyle === 'json') {
        if (existingRecord.material) {
          output.push({
            product_code: existingRecord.product_code,
            name,
            price: existingRecord.price ?? price,
            material: existingRecord.material,
            size: existingRecord.size,
            usage: existingRecord.usage,
            additional_notes: existingRecord.additional_notes,
          });
        } else {
          output.push({
            product_code: existingRecord.product_code,
            name,
            price: existingRecord.price ?? price,
            material: null,
            size: null,
            usage: null,
            additional_notes: null,
            ai_description: existingRecord.ai_description,
          });
        }
      } else {
        if (existingRecord.material) {
          output.push({
            product_code: existingRecord.product_code,
            ai_description: `---
            
            - **Name:** ${name}
            - **Material:** ${existingRecord.material}
            - **Size:** ${existingRecord.size}
            - **Usage:** ${existingRecord.usage}
            - **Additional Notes:** ${existingRecord.additional_notes}
            - **Price:** ${price} JPY
            
            ---`,
          });
        } else {
          output.push({
            product_code: existingRecord.product_code,
            ai_description: existingRecord.ai_description,
          });
        }
      }
    }
  }
  return output;
};

exports.processProductData = processProductData;

exports.product = async (req, res) => {
  const cutoff = new Date(Date.now() - (1000*60*60*24*7));
  const products = (await ProductDetails.find()).filter(d => d.created && d.created > cutoff);
  res.render('products', {products});
};

exports.upload_product_data = async (req, res) => {
  if (!req.body || !Array.isArray(req.body.data)) {
    return res.status(400).json({ status: 'error', message: 'Invalid payload: expected a `data` array' });
  }

  try {
    const output = await processProductData(req.body.data);
    res.json(output);
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};

exports.update_product = async (req, res) => {
  const product = await ProductDetails.findById(req.body.id);
  product.ai_description = req.body.content;
  await product.save();

  res.json({status:"OK"});
}

exports.delete_product = async (req, res) => {
  await ProductDetails.findByIdAndDelete(req.body.id);
  res.json({status:"OK"});
}
