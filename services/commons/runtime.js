let room = null;
function setRoom(value) { room = value; }
function diagnostics() {
  return { initialized: Boolean(room), online: room?.connections.size || 0,
    roomOwned: Boolean(room?.state), persistenceFailed: Boolean(room?.failed),
    revision: room?.state?.revision ?? null, lastSuccessfulSave: room?.state?.savedAt || null };
}
module.exports = { setRoom, diagnostics };
