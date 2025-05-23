const { Task, Palette } = require('../database');

class ScheduleTaskService {
  static SLOT_MINUTES = 15;

  /**
   * Returns {presences, tasks} objects for display in grid.
   * Fills presence gaps as 'home'.
   */
  static async getTasksForWindow(userId, from, to) {
    // Get all presences and tasks for window
    const presences = await Task.find({ 
      userId, 
      type: 'presence', 
      $or: [
        { start: { $lt: to }, end: { $gt: from } }, // Overlapping any slot in window
      ]
    }).lean();

    const tasks = await Task.find({ 
      userId, 
      type: { $in: ['todo', 'tobuy'] },
      $or: [
        { start: { $lte: to } },
        { end: { $gte: from } },
        { start: null }, { end: null }
      ]
    }).lean();

    // Compose presence fills
    const windowSlots = ScheduleTaskService.getSlots(from, to);
    const presenceSlots = [];
    // Mark each slot as covered or not, fill with 'home' where none exists.
    // TODO: Compose slot=>presence mapping

    return { presences, tasks };
  }

  /**
   * Checks for overlap with an existing presence for this user
   */
  static async detectPresenceConflict(userId, start, end, excludeId=null) {
    const query = {
      userId,
      type: 'presence',
      start: { $lt: end },
      end:   { $gt: start }
    };
    if (excludeId) query._id = { $ne: excludeId };

    return Task.find(query);
  }

  /**
   * Get palette as { [key]: { bgColor, border } }, merged with defaults
   */
  static async getPalette() {
    // Minimal example, expand as needed
    const defaults = {
      'location.home':      { bgColor: '#E8F5E9', border: null },
      'location.office':    { bgColor: '#E3F2FD', border: null },
      'location.commute':   { bgColor: '#FFF3E0', border: null },
      'location.travel':    { bgColor: '#EDE7F6', border: null },
      'purpose.work':       { bgColor: null, border: '#1565C0' },
      'purpose.travel':     { bgColor: null, border: '#6A1B9A' },
      'purpose.hospital':   { bgColor: null, border: '#F542B9' },
      'purpose.son':        { bgColor: null, border: '#AD3F0C' },
      'purpose.eatout':     { bgColor: null, border: '#3BC442' },
    };
    const docs = await Palette.find({}).lean();
    const custom = {};
    docs.forEach(c => custom[c.key] = { bgColor: c.bgColor, border: c.border });
    return {...defaults, ...custom};
  }

  static roundToSlot(date) {
    const d = new Date(date);           // Copy
    d.setSeconds(0, 0);
    const mins = d.getMinutes();
    const slot = Math.floor(mins / 15) * 15;
    d.setMinutes(slot);
    return d;
  }

  /**
   * Helper: return slot array of {start, end:Date} objects in [from, to)
   */
  static getSlots(from, to) {
    const result = [];
    let d = new Date(from);
    while (d < to) {
      const start = new Date(d);
      d = new Date(d.getTime() + 1000*60*ScheduleTaskService.SLOT_MINUTES);
      result.push({ start, end: new Date(d) });
    }
    return result;
  }

  /* Add further helpers as needed... */
}

module.exports = ScheduleTaskService;
