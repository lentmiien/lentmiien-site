const logger = require('../utils/logger');
const labelResponse_sample = require('../sample_data/labelResponse.json');
exports.shipping_labels = (req, res) => {
  logger.debug('Shipping label API request', { data: req.body });
  res.json({
    labelResponse: labelResponse_sample
  });
};
