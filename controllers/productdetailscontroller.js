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

exports.product = async (req, res) => {
  const cutoff = new Date(Date.now() - (1000*60*60*24*7));
  const products = (await ProductDetails.find()).filter(d => d.created && d.created > cutoff);
  res.render('products', {products});
};

exports.upload_product_data = async (req, res) => {
  const user_id = req.user.name;
  let use_conversation_id = "new";
  const d = new Date();
  const dstr = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`

  // Context
  const context = 'You are a helpful assistant, on customs clearance topics.\n\nYour task is to provide customs clearance details for the product details provided, this is the JSON template you should use for the output:\n\n**Response template:**\n\n```json\n{\n  material: "Details about the material of the product",\n  size: "Any sizedetails about the product",\n  usage: "Typical usage of the product",\n  additional_notes: "Other notes about the product, useful for customs clearance",\n}\n```';
  
  const output = [];
  for (let i = 0; i < req.body.data.length; i++) {
    const existing = await ProductDetails.find({product_code: req.body.data[i][0]});
    if (existing.length === 0) {
      // Generate `ai_description`
      const all_details = [];
      if (req.body.data[i][2].length > 0) {
        all_details.push(`- ${req.body.data[i][2].split('\n').join('\n- ')}`);
      }
      if (req.body.data[i][3].length > 0) {
        all_details.push(`Content:\n- ${req.body.data[i][3].split(']\n').join('] ').split('\n').join('\n- ')}`);
      }
      if (req.body.data[i][4].length > 0) {
        all_details.push(req.body.data[i][4]);
      }
      // const title = `Product details ${dstr} [${i}]`;
      const prompt = `Please help me summarize the details of the item below.
The summary is to be used for customs clearance, so material and usage is particularly important, and all texts must be in English.

---

(${req.body.data[i][0]})

**Name:** 

${req.body.data[i][1]}

**Price:**

${req.body.data[i][5]} JPY

**Details:**

${all_details.join("\n\n")}

---
`;
      // const conversation_id = await conversationService.postToConversation(user_id, use_conversation_id, [], {title, category:"Product details", tags:"dhl,product_details", context, prompt}, "OpenAI_mini");
      // await batchService.addPromptToBatch(user_id, "@SUMMARY", conversation_id, [], {title}, "gpt-4.1-nano");
      // const conversation = await conversationService.getConversationsById(conversation_id);
      // const messages = await messageService.getMessagesByIdArray(conversation.messages);
      // const ai_description = messages[0].response;
      
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
        product_code: req.body.data[i][0],
        name: req.body.data[i][1],
        details: req.body.data[i][2].length === 0 ? req.body.data[i][1] : req.body.data[i][2],
        content: req.body.data[i][3],
        description: req.body.data[i][4],
        price: req.body.data[i][5],
        ai_description: JSON.stringify(customs_details),
        created: new Date(),
        material: customs_details.material,
        size: customs_details.size,
        usage: customs_details.usage,
        additional_notes: customs_details.additional_notes,
      });
      await newProduct.save();
      output.push({
        product_code: req.body.data[i][0],
        ai_description: `---

- **Name:** ${req.body.data[i][1]}
- **Material:** ${customs_details.material}
- **Size:** ${customs_details.size}
- **Usage:** ${customs_details.usage}
- **Additional Notes:** ${customs_details.additional_notes}
- **Price:** ${req.body.data[i][5]} JPY

---`,
      });
    } else {
      if (existing[0].material) {
        output.push({
          product_code: existing[0].product_code,
          ai_description: `---
          
          - **Name:** ${req.body.data[i][1]}
          - **Material:** ${existing[0].material}
          - **Size:** ${existing[0].size}
          - **Usage:** ${existing[0].usage}
          - **Additional Notes:** ${existing[0].additional_notes}
          - **Price:** ${req.body.data[i][5]} JPY
          
          ---`,
        });
      } else {
        output.push({
          product_code: existing[0].product_code,
          ai_description: existing[0].ai_description,
        });
      }
    }
  }
  res.json(output);
}

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
