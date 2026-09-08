const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { hasCapabilities } = require('../utils/authorization');
const { READ, WRITE, TRANSCRIBE, MIIEN_ROLE_CAPABILITY_BUNDLES } = require('../utils/miienAuthorizationPolicy');
const { MAX_AUDIO_BYTES, validMiienWav } = require('../utils/miienAudio');
const { MiienError, DEFAULT_CONTEXT } = require('../services/miienChatService');
const { MOODS } = require('../utils/miienMood');

function createMiienRouter({ service, asr, roleModel, logger }) {
  const router = express.Router();
  const csrf = createSessionCsrf({ appLogger: logger });
  const authorization = { roleModel, roleCapabilityBundles: MIIEN_ROLE_CAPABILITY_BUNDLES, logger };
  const requireCap = (...capabilities) => createRequireCapabilities({ ...authorization, capabilities });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !req.user?._id) return res.status(401).json({ error: 'Sign in to use Miien.' });
    next();
  });
  router.use(requireCap(READ));
  router.use(rateLimit({ windowMs: 60000, limit: 100, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use(csrf.issueToken);
  // The application's large legacy parsers explicitly skip this route subtree.
  router.use(express.json({ limit: '16kb' }), express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 10 }));
  const mutations = rateLimit({ windowMs: 60000, limit: 12, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false });
  const view = async (req, res, conversation = null) => {
    res.render('miien_settings', { conversation, models: await service.models(),
      conversations: conversation ? [] : await service.list(req.user), defaultContext: DEFAULT_CONTEXT,
      canWrite: await hasCapabilities(req.user, [WRITE], authorization),
      canTranscribe: await hasCapabilities(req.user, [WRITE, TRANSCRIBE], authorization) });
  };
  router.get('/', wrap((req, res) => view(req, res)));
  router.post('/', requireCap(WRITE), csrf.requireToken, mutations, wrap(async (req, res) => {
    const conversation = await service.create(req.user, req.body);
    res.redirect(303, `/chat5/miien/${conversation._id}`);
  }));
  router.get('/:id/settings', wrap(async (req, res) => {
    const conversation = await service.owned(req.user, req.params.id);
    await service.compatible(conversation);
    return view(req, res, conversation);
  }));
  router.post('/:id/settings', requireCap(WRITE), csrf.requireToken, mutations, wrap(async (req, res) => {
    await service.update(req.user, req.params.id, req.body);
    res.redirect(303, `/chat5/miien/${req.params.id}`);
  }));
  router.get('/:id', wrap(async (req, res) => {
    const conversation = await service.owned(req.user, req.params.id);
    await service.compatible(conversation);
    res.render('miien_room', { conversation, moods: MOODS,
      canWrite: await hasCapabilities(req.user, [WRITE], authorization),
      canTranscribe: await hasCapabilities(req.user, [WRITE, TRANSCRIBE], authorization) });
  }));
  router.get('/:id/state', wrap(async (req, res) => res.json(await service.snapshot(req.user, req.params.id))));
  router.post('/:id/messages', requireCap(WRITE), csrf.requireToken, mutations, wrap(async (req, res) => {
    res.status(202).json(await service.send(req.user, req.params.id, req.body));
  }));
  const audioActive = new Set();
  router.post('/:id/transcribe', requireCap(WRITE, TRANSCRIBE), csrf.requireToken, mutations,
    wrap(async (req, res) => {
      await service.owned(req.user, req.params.id);
      if (audioActive.has(String(req.user._id)) || audioActive.size >= 2) throw new MiienError(429, 'Transcription is busy. Try again shortly.');
      // Reserve before parsing so concurrent uploads cannot accumulate unbounded buffers.
      const key = String(req.user._id);
      audioActive.add(key);
      const controller = new AbortController();
      const abort = () => controller.abort();
      res.on('close', abort);
      try {
        await new Promise((resolve, reject) => express.raw({ type: 'audio/wav', limit: MAX_AUDIO_BYTES })(req, res, error => error ? reject(error) : resolve()));
        if (!validMiienWav(req.body)) throw new MiienError(400, 'Record up to 60 seconds of microphone audio.');
        const result = await asr.transcribeBuffer({ buffer: req.body, originalName: 'miien-recording.wav',
          mimetype: 'audio/wav', options: { model: 'whisper-api', language: 'auto' }, privateRequest: true, signal: controller.signal });
        const text = typeof result.data?.text === 'string' ? result.data.text.trim() : '';
        if (!text) throw new MiienError(422, 'No speech was recognized. Try again or type your message.');
        if (text.length > 4000) throw new MiienError(422, 'The transcript is too long. Record a shorter message.');
        res.json({ text });
      } finally {
        audioActive.delete(key);
        res.off('close', abort);
        req.body = null;
      }
    }));
  router.use((error, req, res, next) => {
    if (req.aborted || res.destroyed) return;
    if (res.headersSent) return next(error);
    const status = error instanceof MiienError ? error.status : error.type === 'entity.too.large' ? 413 : ['entity.parse.failed', 'parameters.too.many'].includes(error.type) ? 400 : 503;
    if (status >= 500) logger.error('Miien operation failed; check Chat5 or ASR availability', {
      category: 'chat5_miien', metadata: { operation: req.route?.path || 'request', errorName: error?.name || 'Error' },
    });
    const message = error instanceof MiienError ? error.message : status === 413 ? 'Request is too large.' : status === 400 ? 'Invalid request.'
      : 'Miien could not finish this operation. Text chat remains available. Check history before resending a message.';
    if (req.accepts(['html', 'json']) === 'html') return res.status(status).render('miien_error', { message });
    return res.status(status).json({ error: message });
  });
  return router;
}
module.exports = { createMiienRouter };
