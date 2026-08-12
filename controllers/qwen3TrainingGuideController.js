const fs = require('fs/promises');
const path = require('path');
const logger = require('../utils/logger');
const { renderDocumentationMarkdown } = require('../services/aiGatewayDocumentationService');

const GUIDE_FILE_PATH = path.join(
  __dirname,
  '..',
  'documentation',
  'qwen3-adapter-training-guide.md',
);

exports.render = async (req, res) => {
  try {
    const guideMarkdown = await fs.readFile(GUIDE_FILE_PATH, 'utf8');
    return res.render('admin_qwen3_training_guide', {
      pageTitle: 'Qwen3 LoRA & QLoRA Training Guide',
      guideHtml: renderDocumentationMarkdown(guideMarkdown),
    });
  } catch (error) {
    logger.error('Failed to render Qwen3 adapter training guide', {
      category: 'qwen3_training_guide',
      metadata: {
        path: req.originalUrl || req.url,
        message: error?.message || String(error),
        stack: error?.stack || null,
      },
    });

    return res.status(500).render('error_page', {
      error: 'Unable to load the Qwen3 adapter training guide. Check qwen3_training_guide logs for details.',
    });
  }
};
