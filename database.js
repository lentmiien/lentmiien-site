const mongoose = require('mongoose');
const logger = require('./utils/logger');

// mongoose.set('useFindAndModify', false);

// Set up default mongoose connection
const mongoDB_url = process.env.MONGOOSE_URL;
// mongoose.connect(mongoDB_url, { useNewUrlParser: true, useUnifiedTopology: true });

mongoose.connect(mongoDB_url).then(() => {
  logger.notice('Database connected', { category: 'database' });
}).catch((err) => {
  logger.error('MongoDB connection error', { category: 'database', metadata: { error: err } });
});

// Get the default connection
const db = mongoose.connection;

// Bind connection to error event (to get notification of connection errors)
db.on('error', (err) => {
  logger.error('MongoDB connection error', { category: 'database', metadata: { error: err } });
});

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
const VectorEmbedding = require('./models/vector_embedding');
const VectorEmbeddingHighQuality = require('./models/vector_embedding_high_quality');
const FileMetaModel = require('./models/file_meta');
const Chat4Model = require('./models/chat4');
const Conversation4Model = require('./models/conversation4');
const Chat4KnowledgeModel = require('./models/chat4_knowledge');
const CookbookRecipeModel = require('./models/cookbook_recipe');
const Chat5Model = require('./models/chat5');
const Conversation5Model = require('./models/conversation5');
const Chat5TemplateModel = require('./models/chat5_template');
const ChatPersonalityModel = require('./models/chat_personality');
const ChatResponseTypeModel = require('./models/chat_response_type');
const PendingRequests = require('./models/pending_requests');
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
const CookingCalendarV2Model = require('./models/CookingCalendarV2');
// Health log
const HealthEntry = require('./models/healthentry');
const MyLifeLogEntry = require('./models/my_life_log_entry');
const MyLifeLogImportState = require('./models/my_life_log_import_state');
const MyLifeLogReminder = require('./models/my_life_log_reminder');
// Exchange rates
const ExchangeRate = require('./models/exchange_rate');
// Agents
const AgentModel = require('./models/agent');
const Agent5Model = require('./models/agent5');
const Agent5ConversationBehavior = require('./models/agent5_conversation_behavior');
// Batch
const BatchPromptModel = require('./models/batchprompt');
const BatchRequestModel = require('./models/batchrequest');
// Quick note
const LocationModel = require('./models/location');
const QuicknoteModel = require('./models/quicknote');
// Bookmarks
const BookmarkModel = require('./models/bookmark');
// Tapo energy readings
const TapoReading = require('./models/tapo_reading');
const TapoDailyConsumptionSnapshot = require('./models/tapo_daily_consumption_snapshot');
const TapoMonthlyConsumptionSnapshot = require('./models/tapo_monthly_consumption_snapshot');
// Emergency Stock
const ESCategory = require('./models/es_category');
const ESItem = require('./models/es_item');
// Receipt
const Receipt = require('./models/receipt');
const ReceiptMappingRule = require('./models/receipt_mapping_rule');
// Product Details
const ProductDetails = require('./models/product_details');
const AmiAmiItem = require('./models/amiami_item');
// OpenAI Usage
const OpenAIUsage = require('./models/openai_usage');
const OpenAISubscriptionPlan = require('./models/openai_subscription_plan');
// AI model cards
const AIModelCards = require('./models/ai_model_card');
// Gallery images
const Images = require('./models/image');
const GoodImage = require('./models/good_image');
const GptImageGeneration = require('./models/gpt_image_generation');
const LlmTool = require('./models/llm_tool');
// HTML page ratings
const HtmlPageRating = require('./models/html_page_rating');
// Music generation library
const MusicGeneration = require('./models/music_generation');
// Payroll
const Payroll = require('./models/Payroll');
// Schedule-Task
const Task = require('./models/scheduleTask/Task');
const Palette = require('./models/scheduleTask/Palette');
// ComfyUI prompts
const Prompt = require('./models/prompt');
// Sora videos
const SoraVideo = require('./models/sora_video');
// TRELLIS.2 image-to-3D jobs
const Trellis2Job = require('./models/trellis2_job');
// Image gen bulk
const BulkJob = require('./models/bulk_job');
const BulkTestPrompt = require('./models/bulk_test_prompt');
// Credit cards
const CreditCard = require('./models/credit_card');
const CreditCardMonthlyBalance = require('./models/credit_card_monthly_balance');
const CreditCardTransaction = require('./models/credit_card_transaction');
const AccountingBusinessMapping = require('./models/accounting_business_mapping');
const ExternalAsset = require('./models/external_asset');
// API debug logs
const ApiDebugLog = require('./models/api_debug_log');
// API records
const ApiRecordModel = require('./models/api_record');
const PerformanceSnapshot = require('./models/performance_snapshot');
const PerformanceRollup = require('./models/performance_rollup');
const PerformanceSlowRequest = require('./models/performance_slow_request');
// OCR jobs
const OcrJob = require('./models/ocr_job');
const OcrTtsJob = require('./models/ocr_tts_job');
const LocateAnythingJob = require('./models/locateanything_job');
// ASR jobs
const AsrJob = require('./models/asr_job');
// Audio workflow jobs
const AudioWorkflowJob = require('./models/audio_workflow_job');
const AudioWorkflowTrigger = require('./models/audio_workflow_trigger');
// Message inbox
const MessageInboxEntry = require('./models/message_inbox');
const MessageFilter = require('./models/message_filter');
// Learning tool
const LearningTopic = require('./models/learning_topic');
const LearningSubtopic = require('./models/learning_subtopic');
const LearningItem = require('./models/learning_item');
const LearningProgress = require('./models/learning_progress');
const LearningAttempt = require('./models/learning_attempt');
const LearningArtAsset = require('./models/learning_art_asset');
// AI cluster planner
const ClusterInventoryItem = require('./models/cluster_inventory_item');
const ClusterNodeType = require('./models/cluster_node_type');
const ClusterHardwareCatalogItem = require('./models/cluster_hardware_catalog_item');
const IncomingRequest = require('./models/incoming_request');
const RequestCounterSettings = require('./models/request_counter_settings');
const AppSetting = require('./models/app_setting');
const DeviceUsageRequest = require('./models/device_usage_request');
const DeviceUsageSettings = require('./models/device_usage_settings');
const DeviceUsageGateState = require('./models/device_usage_gate_state');
const DeviceUsagePackageRule = require('./models/device_usage_package_rule');
const DeviceUsageReward = require('./models/device_usage_reward');
const DeviceUsageRewardSuggestion = require('./models/device_usage_reward_suggestion');
const MinuteLoggerRequest = require('./models/minute_logger_request');
const MinuteLoggerStat = require('./models/minute_logger_stat');
const MinuteLoggerLocationGroup = require('./models/minute_logger_location_group');
const DummyApiRequestLog = require('./models/dummy_api_request_log');
const DummyApiEndpointSetting = require('./models/dummy_api_endpoint_setting');
const DisasterAlert = require('./models/disaster_alert');
const DisasterIngestionState = require('./models/disaster_ingestion_state');
const DisasterWeatherSnapshot = require('./models/disaster_weather_snapshot');
const DisasterWeatherObservation = require('./models/disaster_weather_observation');
const TrainingGroupModel = require('./models/training_group');
const TrainingEntryModel = require('./models/training_entry');
const CodexExecutionTarget = require('./models/codex_execution_target');
const CodexWorkspace = require('./models/codex_workspace');
const CodexSession = require('./models/codex_session');
const CodexTurn = require('./models/codex_turn');
const CodexEvent = require('./models/codex_event');
const CodexWorkspaceLock = require('./models/codex_workspace_lock');
const CodexTokenPrice = require('./models/codex_token_price');
const CodexRequestProfile = require('./models/codex_request_profile');

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
  VectorEmbedding,
  VectorEmbeddingHighQuality,
  FileMetaModel,
  Chat4Model,
  Conversation4Model,
  Chat5Model,
  Conversation5Model,
  Chat5TemplateModel,
  ChatPersonalityModel,
  ChatResponseTypeModel,
  PendingRequests,
  Chat4KnowledgeModel,
  CookbookRecipeModel,
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
  CookingCalendarV2Model,
  HealthEntry,
  MyLifeLogEntry,
  MyLifeLogImportState,
  MyLifeLogReminder,
  ExchangeRate,
  AgentModel,
  Agent5Model,
  Agent5ConversationBehavior,
  BatchPromptModel,
  BatchRequestModel,
  LocationModel,
  QuicknoteModel,
  BookmarkModel,
  TapoReading,
  TapoDailyConsumptionSnapshot,
  TapoMonthlyConsumptionSnapshot,
  ESCategory,
  ESItem,
  Receipt,
  ReceiptMappingRule,
  ProductDetails,
  AmiAmiItem,
  OpenAIUsage,
  OpenAISubscriptionPlan,
  AIModelCards,
  Images,
  GoodImage,
  GptImageGeneration,
  LlmTool,
  HtmlPageRating,
  MusicGeneration,
  Payroll,
  Task,
  Palette,
  Prompt,
  SoraVideo,
  Trellis2Job,
  BulkJob,
  BulkTestPrompt,
  CreditCard,
  CreditCardMonthlyBalance,
  CreditCardTransaction,
  AccountingBusinessMapping,
  ExternalAsset,
  ApiDebugLog,
  ApiRecordModel,
  PerformanceSnapshot,
  PerformanceRollup,
  PerformanceSlowRequest,
  OcrJob,
  OcrTtsJob,
  LocateAnythingJob,
  AsrJob,
  AudioWorkflowJob,
  AudioWorkflowTrigger,
  MessageInboxEntry,
  MessageFilter,
  LearningTopic,
  LearningSubtopic,
  LearningItem,
  LearningProgress,
  LearningAttempt,
  LearningArtAsset,
  ClusterInventoryItem,
  ClusterNodeType,
  ClusterHardwareCatalogItem,
  IncomingRequest,
  RequestCounterSettings,
  AppSetting,
  DeviceUsageRequest,
  DeviceUsageSettings,
  DeviceUsageGateState,
  DeviceUsagePackageRule,
  DeviceUsageReward,
  DeviceUsageRewardSuggestion,
  MinuteLoggerRequest,
  MinuteLoggerStat,
  MinuteLoggerLocationGroup,
  DummyApiRequestLog,
  DummyApiEndpointSetting,
  DisasterAlert,
  DisasterIngestionState,
  DisasterWeatherSnapshot,
  DisasterWeatherObservation,
  TrainingGroupModel,
  TrainingEntryModel,
  CodexExecutionTarget,
  CodexWorkspace,
  CodexSession,
  CodexTurn,
  CodexEvent,
  CodexWorkspaceLock,
  CodexTokenPrice,
  CodexRequestProfile,
};
