const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const REASONS = ['deployment', 'host', 'database', 'network', 'other'];
const MAX_MINUTES = 1440;
const DEFAULT_FILE = path.resolve(__dirname, '../private_data/operations/maintenance.json');

function createMaintenanceWindow(file = DEFAULT_FILE) {
  function read() {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048) throw new Error('Invalid maintenance state');
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const start = Date.parse(data.startedAt), end = Date.parse(data.endsAt);
      if (data.version !== 1 || !/^[a-f0-9-]{36}$/.test(data.id) || !REASONS.includes(data.reason)
        || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MAX_MINUTES * 60000) {
        throw new Error('Invalid maintenance state');
      }
      return { id: data.id, startedAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), reason: data.reason };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('Maintenance state is unreadable or invalid; alerts remain enabled.');
    }
  }
  function active(at = new Date()) {
    const state = read();
    return state && Date.parse(state.startedAt) <= +at && +at < Date.parse(state.endsAt) ? state : null;
  }
  function start(minutes, reason = 'deployment', at = new Date()) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES || !REASONS.includes(reason)) {
      throw new Error(`Use 1–${MAX_MINUTES} minutes and a reason: ${REASONS.join(', ')}.`);
    }
    if (active(at)) throw new Error('A maintenance window is already active. End it before starting another.');
    const state = { version: 1, id: randomUUID(), startedAt: at.toISOString(),
      endsAt: new Date(+at + minutes * 60000).toISOString(), reason };
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(handle, JSON.stringify(state));
      fs.fsyncSync(handle);
      fs.closeSync(handle); handle = undefined;
      fs.renameSync(temp, file);
    } finally {
      if (handle !== undefined) fs.closeSync(handle);
      try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return active(at);
  }
  function end() {
    const previous = read();
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return previous;
  }
  return { active, start, end };
}

const maintenanceWindow = createMaintenanceWindow();
let lastWarning = 0;
function getActiveMaintenance(at = new Date()) {
  try { return maintenanceWindow.active(at); }
  catch (_) {
    // Fail open for alerting. Set the throttle before logging to avoid recursion
    // when the logger itself asks for maintenance context.
    if (Date.now() - lastWarning > 300000) {
      lastWarning = Date.now();
      Promise.resolve(require('./logger').warning('Maintenance state is invalid or unreadable; downtime alerts remain enabled', {
        category: 'maintenance',
      })).catch(() => {});
    }
    return null;
  }
}
module.exports = { createMaintenanceWindow, maintenanceWindow, getActiveMaintenance, REASONS, MAX_MINUTES };
