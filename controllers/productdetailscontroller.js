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
  const context = `You are a helpful assistant, please use the following response template when responding:

**Response template:**

---

- **Name:** {full product name}
- **Material:** {material details}
- **Size:** {general size details}
- **Usage:** {typical usage of the item}
- **Additional Notes:** {additional details about item and additional parts, if available}
- **Price:** xxx JPY

---
`;
  
  const output = [];
  for (let i = 0; i < req.body.data.length; i++) {
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
    const title = `Product details ${dstr} [${i}]`;
    const prompt = `Please help me summarize the details of the item below.
The summary is to be used for customs clearance, so material and usage is the most important details.

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
    const conversation_id = await conversationService.postToConversation(user_id, use_conversation_id, [], {title, category:"Product details", tags:"dhl,product_details", context, prompt}, "OpenAI_mini");
    await batchService.addPromptToBatch(user_id, "@SUMMARY", conversation_id, [], {title}, "gpt-4o-mini");
    const conversation = await conversationService.getConversationsById(conversation_id);
    const messages = await messageService.getMessagesByIdArray(conversation.messages);
    const ai_description = messages[0].response;
    // Save to database
    const newProduct = new ProductDetails({
      product_code: req.body.data[i][0],
      name: req.body.data[i][1],
      details: req.body.data[i][2],
      content: req.body.data[i][3],
      description: req.body.data[i][4],
      price: req.body.data[i][5],
      ai_description,
      created: new Date(),
    });
    await newProduct.save();
    output.push(newProduct);
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
