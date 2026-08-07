const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/webhook');

const ollamaWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Too many webhook requests.',
});

/* GET home page. */
router.post('/openai', express.text({ type: 'application/json' }), controller.openai);
router.post(
  '/ollama',
  ollamaWebhookLimiter,
  express.json({ type: 'application/json', limit: '16kb', strict: true }),
  controller.ollama,
);

module.exports = router;
