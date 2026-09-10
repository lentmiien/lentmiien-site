const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { hasCapabilities } = require('../utils/authorization');
const { READ, WRITE, TRANSCRIBE, SYNTHESIZE, MIIEN_ROLE_CAPABILITY_BUNDLES } = require('../utils/miienAuthorizationPolicy');
const { MAX_AUDIO_BYTES } = require('../utils/miienAudio');
const { MiienError, DEFAULT_CONTEXT } = require('../services/miienChatService');
const { MOODS } = require('../utils/miienMood');
const { MiienSpeechOccupiedError } = require('../services/miienSpeechService');
const { MiienAsrAdmissionError } = require('../utils/miienAsrAdmission');

function createMiienRouter({ service, transcription, speech, roleModel, logger }) {
  const router = express.Router();
  const csrf = createSessionCsrf({ appLogger: logger });
  const authorization = { roleModel, roleCapabilityBundles: MIIEN_ROLE_CAPABILITY_BUNDLES, logger };
  const requireCap = (...capabilities) => createRequireCapabilities({ ...authorization, capabilities });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' blob:; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
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
      canSynthesize: await hasCapabilities(req.user, [SYNTHESIZE], authorization),
      canWrite: await hasCapabilities(req.user, [WRITE], authorization),
      canTranscribe: await hasCapabilities(req.user, [WRITE, TRANSCRIBE], authorization) });
  }));
  router.get('/:id/state', wrap(async (req, res) => res.json(await service.snapshot(req.user, req.params.id))));
  router.post('/:id/messages', requireCap(WRITE), csrf.requireToken, mutations, wrap(async (req, res) => {
    res.status(202).json(await service.send(req.user, req.params.id, req.body));
  }));
  const speechSubmissions = rateLimit({ windowMs: 60000, limit: 4, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false });
  router.post('/:id/speech', requireCap(SYNTHESIZE), csrf.requireToken, speechSubmissions, wrap(async (req, res) => {
    res.status(202).json(await speech.submit(req.user, req.params.id, req.body));
  }));
  router.get('/:id/speech-admission/:messageId', requireCap(SYNTHESIZE), wrap(async (req, res) => {
    res.json(await speech.admission(req.user, req.params.id, req.params.messageId));
  }));
  router.get('/:id/speech/:jobId', requireCap(SYNTHESIZE), wrap(async (req, res) => {
    res.json(await speech.get(req.user, req.params.id, req.params.jobId));
  }));
  router.get('/:id/speech/:jobId/audio', requireCap(SYNTHESIZE), wrap(async (req, res) => {
    const audio = await speech.get(req.user, req.params.id, req.params.jobId, true);
    res.set({ 'Content-Type': 'audio/wav', 'Content-Disposition': 'inline; filename="miien-preview.wav"' }).send(audio);
  }));
  router.post('/:id/transcribe', requireCap(WRITE, TRANSCRIBE), csrf.requireToken, mutations, wrap(async (req, res) => {
    res.status(202).json(await transcription.reserve(req.user, req.params.id, req.body));
  }));
  router.get('/:id/transcribe/:jobId', requireCap(WRITE, TRANSCRIBE), wrap(async (req, res) => {
    res.json(await transcription.get(req.user, req.params.id, req.params.jobId));
  }));
  router.post('/:id/transcribe/:jobId', requireCap(WRITE, TRANSCRIBE), csrf.requireToken, mutations, wrap(async (req, res) => {
    res.json(await transcription.discard(req.user, req.params.id, req.params.jobId, req.body));
  }));
  router.post('/:id/transcribe/:jobId/audio', requireCap(WRITE, TRANSCRIBE), csrf.requireToken, mutations,
    wrap(async (req, res) => {
      const { job, accepted } = await transcription.beginUpload(req.user, req.params.id, req.params.jobId);
      if (!accepted) { req.resume(); return res.status(202).json(transcription.view(job)); }
      job.abortUpload = () => req.destroy();
      try {
        await new Promise((resolve, reject) => express.raw({ type: 'audio/wav', limit: MAX_AUDIO_BYTES, inflate: false })(req, res, error => error ? reject(error) : resolve()));
        if (req.aborted || res.destroyed) return;
        res.status(202).json(await transcription.upload(job, req.body));
      } finally {
        req.body = null;
        job.abortUpload = null;
        await transcription.uploadFailed(job, req.aborted || res.destroyed);
      }
    }));
  router.use((error, req, res, next) => {
    if (req.aborted || res.destroyed) return;
    if (res.headersSent) return next(error);
    const status = error instanceof MiienError ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'encoding.unsupported' ? 415 : ['entity.parse.failed', 'parameters.too.many'].includes(error.type) ? 400 : 503;
    const asrAdmission = error instanceof MiienAsrAdmissionError;
    const reservationFailure = status >= 500 && req.method === 'POST' && req.route?.path === '/:id/transcribe';
    if (status >= 500) logger.error(asrAdmission ? 'Miien ASR admission failed; check database readiness and admission index metadata'
      : 'Miien operation failed; check Chat5, ASR or speech availability', {
      category: asrAdmission ? 'chat5_miien_asr' : 'chat5_miien', metadata: {
        operation: req.route?.path || 'request',
        errorName: error instanceof TypeError ? 'TypeError' : 'Error',
        ...(asrAdmission ? { stage: error.stage, code: error.code } : reservationFailure ? { stage: 'reservation', code: 'asr_reservation_unexpected' } : {}),
      },
    });
    const message = error instanceof MiienError ? error.message : status === 413 ? 'Request is too large.' : status === 415 ? 'Compressed audio uploads are not supported.' : status === 400 ? 'Invalid request.'
      : reservationFailure ? 'Recording/transcription could not start. Try recording again shortly or type instead.'
        : 'Miien could not finish this operation. Text chat remains available. Check history before resending a message.';
    if (req.accepts(['html', 'json']) === 'html') return res.status(status).render('miien_error', { message });
    return res.status(status).json({ error: message,
      ...(asrAdmission ? { code: error.code } : reservationFailure ? { code: 'asr_reservation_unexpected' }
        : error instanceof MiienSpeechOccupiedError ? { code: 'speech_admission_occupied' } : {}) });
  });
  return router;
}
module.exports = { createMiienRouter };
