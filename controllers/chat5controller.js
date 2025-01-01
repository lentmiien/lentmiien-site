const { AIModelCards } = require('../database');

exports.index = async (req, res) => {
  res.render("chat5");
};

exports.ai_model_cards = async (req, res) => {
  const models = await AIModelCards.find();
  res.render('ai_model_cards', {models});
};

exports.add_model_card = async (req, res) => {
  // console.log(req.body);
  // {
  //   model_name: 'O3',
  //   provider: 'OpenAI',
  //   api_model: 'o3-2025-03-15',
  //   input_1m_token_cost: '30',
  //   output_1m_token_cost: '60',
  //   model_type: 'chat',
  //   in_modalities: [ 'text', 'image' ], <- Array if multiple selected
  //   out_modalities: 'text',             <- String if only 1 selected
  //   max_tokens: '200000',
  //   max_out_tokens: '100000',
  //   batch_use: 'on',                    <- Can be missing ('off')
  //   context_type: 'developer'
  // }

  // Prepare data
  // Check if identical `provider` + `api_model` exist -> Replace current entry
  // If unique entry -> Save as new entry to database

  res.redirect('/chat5/ai_model_cards');
};
