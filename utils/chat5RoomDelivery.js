const { currentReader, canReadConversation } = require('../middleware/chat5PrivateAccess');
const logger = require('./logger');
const { sessionHasRequiredTwoFactor } = require('./twoFactorSession');
async function authorized(socket, ids) {
  const session = socket.request?.session;
  if (typeof session?.reload === 'function') await new Promise((resolve, reject) => session.reload(error => error ? reject(error) : resolve()));
  const current = socket.request?.session;
  if (!current?.cookie?.expires || +new Date(current.cookie.expires) <= Date.now()) return false;
  const user = await currentReader(current.passport?.user);
  if (!user || user.name !== socket.data?.userName || !sessionHasRequiredTwoFactor(user, current)) return false;
  for (const id of ids) if (!await canReadConversation(id, user)) return false;
  return true;
}
function install(io, verify = authorized) {
  const namespace = io.of('/');
  const adapter = namespace.adapter;
  const broadcast = adapter.broadcast.bind(adapter);
  let chain = Promise.resolve();
  let pending = 0;
  // Membership may change after joining. Validate each private-room delivery,
  // including legacy updates that could contain a previously published batch message.
  adapter.broadcast = (packet, options) => {
    const rooms = [...(options.rooms || [])].filter(room => room.startsWith('conversation:'));
    if (!rooms.length) return broadcast(packet, options);
    if (pending >= 256) {
      logger.warning('Chat5 private room delivery backpressure; clients must reload', { category: 'chat5_authorization' });
      return;
    }
    pending += 1;
    chain = chain.then(async () => {
      const ids = rooms.map(room => room.slice('conversation:'.length));
      const recipients = new Set(rooms.flatMap(room => [...(adapter.rooms.get(room) || [])]));
      const except = new Set(options.except || []);
      for (const id of recipients) {
        const socket = namespace.sockets.get(id);
        if (!socket || !await verify(socket, ids)) {
          except.add(id);
          for (const room of rooms) socket?.leave(room);
        }
      }
      broadcast(packet, { ...options, except });
    }).catch(() => {
      logger.warning('Chat5 private room delivery withheld because authorization could not be verified', { category: 'chat5_authorization' });
    }).finally(() => { pending -= 1; });
    return chain;
  };
}
module.exports = { install, authorized };
