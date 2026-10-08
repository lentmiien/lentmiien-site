const crypto = require('crypto');
const { hasCapabilities } = require('../utils/authorization');
const { PLAY, TALK, ROLE_BUNDLES } = require('../utils/commonsAuthorizationPolicy');
const { safeEqual } = require('../middleware/sessionCsrf');
const { portal } = require('../services/commons/registry');
const World = require('../public/commons/world');
const logger = require('../utils/logger');
let lastAuthorizationWarning = -Infinity;
const reload = session => new Promise((resolve, reject) => session.reload(error => error ? reject(error) : resolve()));
async function authorize(socket, { userModel, roleModel, config, now = Date.now }, capability = PLAY) {
  if (!config.enabled || !config.origins.includes(socket.handshake.headers.origin)) throw new Error('UNAUTHORIZED');
  if (!socket.request.session?.reload) throw new Error('UNAUTHORIZED');
  await reload(socket.request.session);
  const session = socket.request.session;
  if (!safeEqual(session.csrfToken, socket.handshake.auth?.csrf)) throw new Error('UNAUTHORIZED');
  const expires = +new Date(session.cookie?.expires || 0);
  const id = String(session.passport?.user || '');
  if (!/^[a-f0-9]{24}$/i.test(id) || (!Number.isFinite(expires) || expires <= now())) throw new Error('UNAUTHORIZED');
  let principal;
  try {
    principal = await userModel.findOne({ _id: id });
    if (!principal || !await hasCapabilities(principal, [PLAY, capability], { roleModel, roleCapabilityBundles: ROLE_BUNDLES })) throw new Error('UNAUTHORIZED');
  } catch (error) {
    if (error.message !== 'UNAUTHORIZED' && now() - lastAuthorizationWarning > 60000) {
      lastAuthorizationWarning = now();
      logger.warning('Commons access lookup failed; check database availability', {
        category: 'commons.authorization', metadata: { errorName: error?.name || 'Error' },
      });
    }
    throw error;
  }
  if (socket.data.userId && socket.data.userId !== id) throw new Error('UNAUTHORIZED');
  return { principal: { _id: id, name: principal.name, type_user: principal.type_user }, userId: id, validUntil: Math.min(expires, now() + 5000) };
}
function registerCommons(io, sessionMiddleware, dependencies) {
  const { room, npc, config, roleModel } = dependencies;
  const namespace = io.of('/commons');
  let admitting = 0;
  let joining = 0;
  const lastJoins = new Map();
  let admissionWindow = 0;
  let admissionCount = 0;
  namespace.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
  namespace.use(async (socket, next) => {
    const now = Date.now();
    if (now - admissionWindow > 1000) { admissionWindow = now; admissionCount = 0; }
    if (++admissionCount > 20 || admitting >= 4) return next(new Error('BUSY'));
    admitting++;
    try {
      Object.assign(socket.data, await authorize(socket, dependencies));
      if (now - (lastJoins.get(socket.data.userId) || 0) < 1500) return next(new Error('BUSY'));
      if (lastJoins.size >= 64) lastJoins.delete(lastJoins.keys().next().value);
      lastJoins.set(socket.data.userId, now);
      next();
    }
    catch (_) { next(new Error('UNAUTHORIZED')); }
    finally { admitting--; }
  });
  namespace.on('connection', async socket => {
    const userId = socket.data.userId;
    const token = crypto.randomUUID();
    const memory = [];
    let stopped = false, pending = false, pendingTalk = false, auditing = false;
    let inputWindow = 0, inputCount = 0, lastAction = 0;
    let auditTimer;
    const close = code => { socket.emit('closed', { code }); socket.disconnect(); };
    socket.on('disconnect', () => {
      stopped = true; clearInterval(auditTimer); npc.cancel(userId, token); memory.length = 0;
      room.leave(userId, token).catch(() => {});
    });
    if (joining >= 4) { close('BUSY'); return; }
    joining++;
    try {
      const snapshot = await room.join(userId, { token, validUntil: socket.data.validUntil, close });
      if (stopped) { await room.leave(userId, token); return; }
      socket.emit('joined', { ...snapshot, npcEnabled: config.npcEnabled });
    } catch (error) { close(error.code || 'ROOM_UNAVAILABLE'); return; }
    finally { joining--; }
    const check = async capability => {
      const auth = await authorize(socket, dependencies, capability);
      if (stopped) throw new Error('UNAUTHORIZED');
      room.authorize(userId, token, auth.validUntil);
      room.current(userId, token);
      socket.data.principal = auth.principal;
      return auth.principal;
    };
    auditTimer = setInterval(async () => {
      if (auditing || stopped) return;
      auditing = true;
      try { await check(PLAY); } catch (_) { close('UNAUTHORIZED'); }
      finally { auditing = false; }
    }, 3000);
    auditTimer.unref?.();
    socket.on('input', payload => {
      const now = Date.now();
      if (now - inputWindow >= 1000) { inputWindow = now; inputCount = 0; }
      if (++inputCount > 20) return;
      try { room.input(userId, token, payload); } catch (_) { /* Invalid/expired input cannot move. */ }
    });
    async function command(payload, ack, handler, capability = PLAY) {
      if (typeof ack !== 'function') return;
      const talking = capability === TALK;
      if ((talking ? pendingTalk : pending) || Date.now() - lastAction < 500) return ack({ error: 'BUSY' });
      lastAction = Date.now();
      if (talking) pendingTalk = true; else pending = true;
      try {
        const principal = await check(capability);
        const result = await handler(principal);
        await check(capability); // Delayed/provider results never outlive authorization/takeover.
        if (!stopped) ack(result);
      } catch (error) {
        if (!stopped) ack({ error: error.code || 'UNAUTHORIZED' });
        if (!error.code) close('UNAUTHORIZED');
      } finally { if (talking) pendingTalk = false; else pending = false; }
    }
    socket.on('action', (payload, ack) => command(payload, ack, async principal => {
      const result = await room.action(userId, token, payload);
      if (['chat', 'hall'].includes(result.target)) return portal(result.target, principal, roleModel);
      if (result.target === 'shelter') return { message: 'A quiet refuge. Household supplies are not connected in this release.' };
      if (result.target === 'gallery') return { gallery: true, message: 'The first collection: a village made of small, warm lights. Original art generated for Lantern Commons.' };
      if (result.target === 'keeper') {
        const canTalk = await hasCapabilities(principal, [TALK], { roleModel, roleCapabilityBundles: ROLE_BUNDLES });
        return { npc: canTalk, message: canTalk
          ? 'Mori is an AI character with no access to your tools or other conversations. Ask about the village, or simply say hello.'
          : `Mori’s local note: ${require('../services/commons/npc').FALLBACK}` };
      }
      return result;
    }));
    socket.on('emote', (payload, ack) => command(payload, ack, async () => {
      room.emote(userId, token, payload); return { ok: true };
    }));
    socket.on('talk', (payload, ack) => command(payload, ack, async () => {
      const self = room.snapshot(userId, token).self;
      if (!World.nearby(self).some(l => l.id === 'keeper')) return { error: 'TOO_FAR' };
      if (!payload || Object.keys(payload).length !== 1 || typeof payload.text !== 'string') return { error: 'INVALID_INPUT' };
      return npc.talk(userId, token, payload.text, memory);
    }, TALK));
    socket.data.commonsSnapshot = () => room.snapshot(userId, token);
  });
  const tick = setInterval(() => room.tick(), 50);
  const snapshots = setInterval(() => {
    for (const socket of namespace.sockets.values()) {
      try { if (socket.data.commonsSnapshot) socket.emit('state', socket.data.commonsSnapshot()); }
      catch (_) { /* Fail closed: no snapshots beyond the authorization or lease deadline. */ }
    }
  }, 100);
  let checkpointPending = false;
  const checkpoints = setInterval(async () => {
    if (checkpointPending) return;
    checkpointPending = true;
    try { await room.checkpoint(); } catch (_) { /* Room reports persistence failures. */ }
    finally { checkpointPending = false; }
  }, config.checkpointMs);
  for (const timer of [tick, snapshots, checkpoints]) timer.unref?.();
  const stop = () => { clearInterval(tick); clearInterval(snapshots); clearInterval(checkpoints); };
  io.engine.on('close', stop);
  return { namespace, stop };
}
function installCommons(server, sessionMiddleware) {
  try {
    const { config: readConfig } = require('../services/commons/config');
    const config = readConfig();
    if (!config.enabled) return null;
    const { CommonsRepository } = require('../services/commons/repository');
    const { CommonsRoom } = require('../services/commons/room');
    const { CommonsNpc, gatewayProvider } = require('../services/commons/npc');
    const { UseraccountModel, RoleModel } = require('../database');
    const room = new CommonsRoom({ repository: new CommonsRepository({ leaseMs: config.leaseMs }), maxOnline: config.maxOnline });
    const npc = new CommonsNpc({ provider: gatewayProvider() });
    const io = new (require('socket.io').Server)(server, {
      path: '/commons/socket.io', serveClient: false, maxHttpBufferSize: 4096, transports: ['websocket'],
      allowRequest: (req, callback) => callback(null, config.origins.includes(req.headers.origin)),
    });
    require('../services/commons/runtime').setRoom(room);
    return registerCommons(io, sessionMiddleware, { room, npc, config, userModel: UseraccountModel, roleModel: RoleModel });
  } catch (_) {
    logger.error('Commons disabled: validate COMMONS configuration and NPC model settings', { category: 'commons.config' });
    return null;
  }
}
module.exports = { authorize, registerCommons, installCommons };
