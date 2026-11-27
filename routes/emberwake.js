const path = require('node:path');
const express = require('express');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { hasCapabilities } = require('../utils/authorization');
const { PLAY, MANAGE, BUNDLES } = require('../services/emberwake/policy');
const logger = require('../utils/logger');

function createEmberwakeRouter({
  room = require('../services/emberwake'),
  roleModel = require('../models/role')
} = {}) {
  const router = express.Router(),
    csrf = createSessionCsrf();
  const requireCap = cap =>
    createRequireCapabilities({ capabilities: [cap], roleModel, roleCapabilityBundles: BUNDLES });
  const client = path.join(__dirname, '../multiplayer/emberwake');
  router.use((req, res, next) => {
    res.set({
      'Cache-Control': PRIVATE_NO_STORE,
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff'
    });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !req.user?._id)
      return res.status(401).render('accessDenied', {
        title: 'Sign in to sail',
        message: 'Sign in to your site account to play Emberwake Together.',
        user: null
      });
    next();
  });
  router.use(requireCap(PLAY));
  router.use((req, res, next) => {
    res.locals.loggedIn = true;
    next();
  });
  for (const dir of ['assets', 'vendor', 'js', 'css'])
    router.use(
      '/' + dir,
      express.static(path.join(client, dir), {
        index: false,
        redirect: false,
        dotfiles: 'deny',
        cacheControl: false
      })
    );
  const state = async (_req, res, next) => {
    try {
      res.locals.harbor = await room.status();
      next();
    } catch (error) {
      logger.warning('Emberwake harbor status unavailable', {
        category: 'emberwake.persistence',
        metadata: { errorName: error.name }
      });
      res.status(503).send('The harbor checkpoint is unavailable. Try again shortly.');
    }
  };
  router.get('/', csrf.issueToken, state, async (req, res, next) => {
    try {
      res.render('emberwake/game', {
        canManage: await hasCapabilities(req.user, [MANAGE], { roleModel, roleCapabilityBundles: BUNDLES })
      });
    } catch (error) {
      next(error);
    }
  });
  router.get('/status', state, (_req, res) => res.json(res.locals.harbor));
  router.get('/harbormaster', requireCap(MANAGE), csrf.issueToken, state, (_req, res) =>
    res.render('emberwake/maintenance', { harborClass: 'harbor-admin' })
  );
  router.post(
    '/maintenance',
    requireCap(MANAGE),
    express.json({ limit: '1kb' }),
    csrf.requireToken,
    async (req, res) => {
      const body = req.body;
      if (
        !body ||
        Object.getPrototypeOf(body) !== Object.prototype ||
        Object.keys(body).length !== 1 ||
        typeof body.paused !== 'boolean'
      )
        return res.status(400).json({ error: 'Choose pause or resume.' });
      try {
        return res.json(await room.maintenance(body.paused));
      } catch (error) {
        logger.error('Emberwake maintenance change could not be confirmed', {
          category: 'emberwake.maintenance',
          metadata: { operation: body.paused ? 'pause' : 'resume', cause: error.code || error.name }
        });
        return res
          .status(503)
          .json({
            error:
              'The maintenance change could not be confirmed. Check the database and retry before stopping the server.'
          });
      }
    }
  );
  return router;
}
module.exports = { createEmberwakeRouter };
