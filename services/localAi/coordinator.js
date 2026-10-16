const fs = require('fs/promises');
const os = require('os');
async function processIdentity(pid = process.pid) {
  if (process.platform !== 'linux') return null;
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function ownerIdentity() { return { ownerHost: os.hostname(), ownerPid: process.pid, ownerProcessStart: await processIdentity() }; }
async function previousCoordinatorTerminated(control) {
  if (!control.holder) return true;
  if (control.ownerHost !== os.hostname() || !Number.isInteger(control.ownerPid)) return false;
  try { process.kill(control.ownerPid, 0); }
  catch (error) { return error.code === 'ESRCH'; }
  if (process.platform === 'linux' && control.ownerProcessStart) {
    const current = await processIdentity(control.ownerPid);
    return current !== null && current !== control.ownerProcessStart;
  }
  return false;
}
module.exports = { processIdentity, ownerIdentity, previousCoordinatorTerminated };
