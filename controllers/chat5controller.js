const { AIModelCards } = require('../database');
const utils = require('../utils/utils');
const openai = require('../utils/ChatGPT');

exports.index = async (req, res) => {
  // Load available OpenAI models
  const models = await AIModelCards.find();
  const available = openai.GetOpenAIModels().map(d => d.model);
  const usable_models = models.filter(d => d.provider === "OpenAI" && available.indexOf(d.api_model) >= 0 && d.model_type === "chat");

  res.render("chat5", {models: usable_models});
};

exports.ai_model_cards = async (req, res) => {
  const models = (await AIModelCards.find()).sort((a,b) => {
    if (a.model_type < b.model_type) return -1;
    if (a.model_type > b.model_type) return 1;
    if (a.output_1m_token_cost > b.output_1m_token_cost) return -1;
    if (a.output_1m_token_cost < b.output_1m_token_cost) return 1;
    if (a.input_1m_token_cost > b.input_1m_token_cost) return -1;
    if (a.input_1m_token_cost < b.input_1m_token_cost) return 1;
    if (a.model_name < b.model_name) return -1;
    if (a.model_name > b.model_name) return 1;
    return 0;
  });
  res.render('ai_model_cards', {models});
};

exports.add_model_card = async (req, res) => {
  // Prepare data
  const data = {
    model_name: req.body.model_name,
    provider: req.body.provider,
    api_model: req.body.api_model,
    input_1m_token_cost: parseFloat(req.body.input_1m_token_cost),
    output_1m_token_cost: parseFloat(req.body.output_1m_token_cost),
    model_type: req.body.model_type,
    in_modalities: utils.normalizeInputToArrayOfStrings(req.body.in_modalities),
    out_modalities: utils.normalizeInputToArrayOfStrings(req.body.out_modalities),
    max_tokens: parseInt(req.body.max_tokens),
    max_out_tokens: parseInt(req.body.max_out_tokens),
    added_date: new Date(),
    batch_use: req.body.batch_use != undefined && req.body.batch_use === "on",
    context_type: req.body.context_type
  }

  // Check if identical `provider` + `api_model` exist
  const existing = await AIModelCards.find({provider: req.body.provider, api_model: req.body.api_model});
  if (existing.length === 1) {
    // Exist -> Replace current entry
    existing[0].model_name = data.model_name;
    existing[0].input_1m_token_cost = data.input_1m_token_cost;
    existing[0].output_1m_token_cost = data.output_1m_token_cost;
    existing[0].model_type = data.model_type;
    existing[0].in_modalities = data.in_modalities;
    existing[0].out_modalities = data.out_modalities;
    existing[0].max_tokens = data.max_tokens;
    existing[0].max_out_tokens = data.max_out_tokens;
    existing[0].added_date = data.added_date;
    existing[0].batch_use = data.batch_use;
    existing[0].context_type = data.context_type;
    await existing[0].save();
  } else {
    // Unique entry -> Save as new entry to database
    await new AIModelCards(data).save();
  }

  res.redirect('/chat5/ai_model_cards');
};
