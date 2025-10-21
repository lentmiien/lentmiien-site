const logger = require('../utils/logger');
const labelResponse_sample = require('../sample_data/labelResponse.json');

exports.shipping_identifiers = (req, res) => {
  logger.debug('Shipping identifier API request', { headers: req.headers, data: req.query });
  const size = req.query.size && parseInt(req.query.size) > 0 ? parseInt(req.query.size) : 1;
  const type = req.query.type ? req.query.type : "SID";
  const array = [];
  for (let i = 0; i < size && i < 10; i++) {
    array.push((Date.now()+i).toString());
  }
  res.json({
    "warnings": [
      "Warning message if anything goes wrong"
    ],
    "identifiers": [
      {
        "typeCode": type,
        "list": array
      }
    ]
  });
};

exports.shipping_labels = (req, res) => {
  logger.debug('Shipping label API request', { headers: req.headers, data: req.body });
  res.json(labelResponse_sample);
};
