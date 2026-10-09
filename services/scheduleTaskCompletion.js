// Canonical My Page / Commons completion: legacy name ownership, never an admin override.
function createTaskCompletion({ Task = require('../models/scheduleTask/Task'),
  deleteReminders = (owner, id) => require('./scheduleTaskReminderService').scheduleTaskReminderService.deletePendingForTask(owner, id) } = {}) {
  return async function completeTask(principal, id) {
    const scope = { _id: id, userId: principal.name, type: { $in: ['todo', 'tobuy'] } };
    // Conditional update preserves the first completion timestamp even under races.
    let task = await Task.findOneAndUpdate({ ...scope, done: { $ne: true } }, { $set: { done: true } },
      { returnDocument: 'after', runValidators: true, maxTimeMS: 2000 });
    if (!task) task = await Task.findOne({ ...scope, done: true }).maxTimeMS(2000);
    if (!task) return null;
    // Retrying after cleanup failure is safe and still removes pending reminders.
    const deletedReminders = await deleteReminders(task.userId, task._id);
    return { ok: true, done: true, deletedReminders };
  };
}
module.exports = { createTaskCompletion };
