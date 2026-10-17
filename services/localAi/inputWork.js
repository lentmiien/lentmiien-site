const { problem } = require('./policy');
let active = false;
// No waiter queue retains request bodies. Storage reservations independently
// bound multiple web processes; this slot bounds one process's media pipeline.
function acquire() {
  if (active) throw problem('input_upload_busy', 503);
  active = true;
  let released = false;
  return () => { if (!released) { released = true; active = false; } };
}
module.exports = { acquire };
