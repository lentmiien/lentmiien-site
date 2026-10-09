const { CommonsError } = require('./room');
function createPrivateAccess() {
  const connections = new Map();
  return {
    add(ticket, connection) { connections.set(ticket, connection); },
    remove(ticket) { connections.delete(ticket); },
    async open(req, surface) {
      const ticket = req.get('x-commons-connection');
      const connection = typeof ticket === 'string' && ticket.length === 36 && connections.get(ticket);
      if (!connection || connection.sessionId !== req.sessionID
        || connection.userId !== String(req.session?.passport?.user || '')) throw new CommonsError('UNAUTHORIZED');
      if (connection.pending) throw new CommonsError('BUSY');
      const check = async () => {
        if (connections.get(ticket) !== connection) throw new CommonsError('UNAUTHORIZED');
        return connection.check(surface);
      };
      connection.pending = true;
      try { return { principal: await check(), check, release: () => { connection.pending = false; } }; }
      catch (error) { connection.pending = false; throw error; }
    },
  };
}
const privateAccess = createPrivateAccess();
module.exports = { createPrivateAccess, privateAccess };
