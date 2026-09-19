const express = require('express');
const sanitizeHtml = require('sanitize-html');
const { renderMarkdownSafe } = require('../utils/chat5Markdown');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { RECIPE_READ, ROLE_BUNDLES } = require('../utils/cookbookReadPolicy');
const logger = require('../utils/logger');

function createLegacyCookbookRouter({
  cookbookModel = require('../models/cookbook_recipe'),
  knowledgeModel = require('../models/chat4_knowledge'),
  roleModel = require('../models/role'),
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', PRIVATE_NO_STORE);
    res.set('Referrer-Policy', 'no-referrer');
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !req.user?.name) return res.status(401).send('Sign in required.');
    return next();
  });
  router.get('/:id', createRequireCapabilities({
    capabilities: [RECIPE_READ], roleModel, roleCapabilityBundles: ROLE_BUNDLES,
  }), async (req, res) => {
    const id = req.params.id;
    if (!/^[a-f\d]{24}$/i.test(id)) return res.status(400).send('Invalid recipe identifier.');
    const userId = req.user.name;
    try {
      const converted = await cookbookModel.findOne({ user_id: userId, originKnowledgeId: id.toLowerCase() })
        .select('_id').sort({ _id: 1 }).maxTimeMS(2000).lean().exec();
      if (converted) return res.redirect(`/cooking/cookbook/${encodeURIComponent(String(converted._id))}`);
      const knowledge = await knowledgeModel.findOne({ _id: id, user_id: userId, category: /^Recipe$/i })
        .select('title contentMarkdown').maxTimeMS(2000).lean().exec();
      if (!knowledge) return res.status(404).send('Recipe unavailable.');
      if ((knowledge.contentMarkdown || '').length > 100000) {
        logger.warning('Legacy cookbook recipe exceeds rendering limit', { category: 'cookbook' });
        return res.status(422).send('Recipe is too large to display.');
      }
      // Reuse cookbook Markdown presentation, with no automatic media requests in this view.
      const contentHTML = sanitizeHtml(renderMarkdownSafe(knowledge.contentMarkdown || ''), {
        allowedTags: sanitizeHtml.defaults.allowedTags,
        allowedAttributes: { a: ['href', 'title', 'target', 'rel'], th: ['align'], td: ['align'] },
        allowedSchemes: ['https', 'http', 'mailto'],
        allowProtocolRelative: false,
      });
      return res.render('cookbook/legacy', { title: knowledge.title || 'Untitled recipe', contentHTML });
    } catch (_) {
      logger.error('Failed to load legacy cookbook recipe', { category: 'cookbook' });
      return res.status(503).send('Unable to load recipe. Try again.');
    }
  });
  return router;
}

module.exports = { createLegacyCookbookRouter };
