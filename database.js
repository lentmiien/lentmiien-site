const mongoose = require('mongoose');

// mongoose.set('useFindAndModify', false);

// Set up default mongoose connection
const mongoDB_url = process.env.MONGOOSE_URL;
// mongoose.connect(mongoDB_url, { useNewUrlParser: true, useUnifiedTopology: true });

mongoose.connect(mongoDB_url).then(() => {
  console.log('Database connected');
});

// Get the default connection
const db = mongoose.connection;

// Bind connection to error event (to get notification of connection errors)
db.on('error', console.error.bind(console, 'MongoDB connection error:'));

// User
const UseraccountModel = require('./models/useraccount');
const RoleModel = require('./models/role');
// Article
const ArticleModel = require('./models/article');
// ChatGPT
const ChatModel = require('./models/chat');
const Chat2Model = require('./models/chat2');
const Chat3Model = require('./models/chat3');
const Chat3TemplateModel = require('./models/chat3_template');
const Chat3KnowledgeTModel = require('./models/chat3_knowledge_t');
const Chat3KnowledgeModel = require('./models/chat3_knowledge');
const OpenaichatModel = require('./models/openai_chat');
const EmbeddingModel = require('./models/embedding');
const FileMetaModel = require('./models/file_meta');
const Chat4Model = require('./models/chat4');
const Conversation4Model = require('./models/conversation4');
const Chat4KnowledgeModel = require('./models/chat4_knowledge');
// GPT Document
const DocumentModel = require('./models/document');
const TextnodeModel = require('./models/textnode');
// Budget
// (OLD)
const AccountModel = require('./models/account');
const TransactionModel = require('./models/transaction');
const TypecategoryModel = require('./models/typecategory');
const TypetagModel = require('./models/typetag');
// (NEW)
const AccountDBModel = require('./models/account_db');
const CategoryDBModel = require('./models/category_db');
const TransactionDBModel = require('./models/transaction_db');
// OpenAI
const OpenaicalllogDBModel = require('./models/openaicalllog');
const OpenaimodelDBModel = require('./models/openaimodel');
// Cooking calendar
const CookingCalendarModel = require('./models/CookingCalendar');
const CookingRequestModel = require('./models/CookingRequest');
// Health log
const HealthEntry = require('./models/healthentry');
// Agents
const AgentModel = require('./models/agent');
// Batch
const BatchPromptModel = require('./models/batchprompt');
const BatchRequestModel = require('./models/batchrequest');
// El
const LogModel = require('./models/log');

// Export models
module.exports = {
  UseraccountModel,
  RoleModel,
  ArticleModel,
  ChatModel,
  Chat2Model,
  Chat3Model,
  Chat3TemplateModel,
  Chat3KnowledgeTModel,
  Chat3KnowledgeModel,
  OpenaichatModel,
  EmbeddingModel,
  FileMetaModel,
  Chat4Model,
  Conversation4Model,
  Chat4KnowledgeModel,
  DocumentModel,
  TextnodeModel,
  AccountModel,
  TransactionModel,
  TypecategoryModel,
  TypetagModel,
  AccountDBModel,
  CategoryDBModel,
  TransactionDBModel,
  OpenaicalllogDBModel,
  OpenaimodelDBModel,
  CookingCalendarModel,
  CookingRequestModel,
  HealthEntry,
  AgentModel,
  BatchPromptModel,
  BatchRequestModel,
  LogModel,
};
