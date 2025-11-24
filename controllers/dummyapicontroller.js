const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const labelResponse_sample = require('../sample_data/labelResponse.json');

const japanPostXmlPath = path.join(__dirname, '../sample_data/japan_post_label_response.xml');
const japanPostPdfPath = path.join(__dirname, '../sample_data/japan_post_label.pdf');
const japanPostLabelResponse = fs.readFileSync(japanPostXmlPath, 'utf8');
const japanPostLabelPdf = fs.readFileSync(japanPostPdfPath);

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

exports.japanPostLabel = (req, res) => {
  logger.debug('Japan Post label mock request', { headers: req.headers, data: req.body });
  res.type('application/xml');
  res.send(japanPostLabelResponse);
};

exports.japanPostLabelPdf = (req, res) => {
  logger.debug('Japan Post label PDF mock request', { headers: req.headers, params: req.params });
  const fileName = req.params.trackingNumber ? `${req.params.trackingNumber}.pdf` : 'sample-label.pdf';
  res.type('application/pdf');
  res.set('Content-Disposition', `inline; filename="${fileName}"`);
  res.send(japanPostLabelPdf);
};
