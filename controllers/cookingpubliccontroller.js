const logger = require('../utils/logger');

exports.index = (req, res) => {
  logger.notice('Redirect cooking request access to v2 calendar', { category: 'cooking-calendar' });
  res.redirect('/cooking/v2');
};

exports.api_send_cooking_request = (req, res) => {
  res.status(410).json({
    status: 'disabled',
    message: 'Cooking requests have been retired. Please use the cooking calendar instead.',
  });
};
