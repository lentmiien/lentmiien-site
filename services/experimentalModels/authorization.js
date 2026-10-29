const { hasCapabilities } = require('../../utils/authorization');
const { CAPABILITY, BUNDLES } = require('./policy');
// Capture only opaque identifiers and the session store, never the entire request.
function dispatchAuthorization(req) {
  const owner = req.labOwner, binding = req.labBinding, sid = req.sessionID, sessions = req.sessionStore;
  return async () => {
    if (!sessions || !sid) return false;
    const session = await new Promise((resolve, reject) => sessions.get(sid, (error, value) => error ? reject(error) : resolve(value)));
    if (!session || session.experimentalModelsBinding !== binding || String(session.passport?.user) !== owner
      || (session.cookie?.expires && new Date(session.cookie.expires).getTime() <= Date.now())) return false;
    const user = await require('../../database').UseraccountModel.findById(owner).select('_id name type_user').maxTimeMS(5000).lean();
    return !!user && user.type_user === 'admin' && await hasCapabilities(user, [CAPABILITY], { roleCapabilityBundles: BUNDLES });
  };
}
module.exports = { dispatchAuthorization };
