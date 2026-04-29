const GptImageToolService = require('./gptImageToolService');

const gptImageToolService = new GptImageToolService();

module.exports = {
  'gptImage.generate': {
    execute: (args, context) => gptImageToolService.execute(args, context),
  },
};
