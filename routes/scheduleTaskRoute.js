const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/scheduleTaskController');

// Main calendar view (user page)
router.get('/calendar', ctrl.renderCalendarPage);
// Upcoming tasks (grouped by month)
router.get('/upcoming', ctrl.renderUpcomingTasksPage);

// API endpoints
router.get('/api/tasks', ctrl.listTasksApi);
router.post('/api/tasks', ctrl.createTaskApi);
router.patch('/api/tasks/:id', ctrl.updateTaskApi);
router.patch('/api/tasks/:id/done', ctrl.toggleDoneApi);
router.get('/api/palette', ctrl.paletteApi);

router.get('/new/presence', ctrl.renderPresenceForm);
router.post('/new/presence', ctrl.savePresence);

router.get('/new/task', ctrl.renderTaskForm);
router.post('/new/task', ctrl.saveTask);

module.exports = router;
