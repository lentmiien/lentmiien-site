const logger = require('../utils/logger');
const { getVllmImageLimits } = require('../utils/Ollama_API');

let limits;
let refresh;
let refreshAfter = 0;

module.exports = async function vllmImageLimits(_req, res, next) {
  if (Date.now() >= refreshAfter && !refresh) {
    refresh = getVllmImageLimits().then(current => {
      limits = current;
    }).catch(error => {
      logger.warning('Unable to refresh vLLM image limits for the UI', {
        category: 'ai_gateway',
        metadata: { code: error.code, status: error.response?.status },
      });
    }).finally(() => {
      refreshAfter = Date.now() + 60000;
      refresh = null;
    });
  }
  await refresh;
  res.locals.vllmImageLimits = limits;
  next();
};
