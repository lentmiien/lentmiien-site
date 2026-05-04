const GptImageToolService = require('./gptImageToolService');
const ScheduleTaskToolService = require('./scheduleTaskToolService');

const gptImageToolService = new GptImageToolService();
const scheduleTaskToolService = new ScheduleTaskToolService();

module.exports = {
  'gptImage.generate': {
    execute: (args, context) => gptImageToolService.execute(args, context),
  },
  'scheduleTask.createTodo': {
    execute: (args, context) => scheduleTaskToolService.createTodo(args, context),
  },
  'scheduleTask.createTobuy': {
    execute: (args, context) => scheduleTaskToolService.createTobuy(args, context),
  },
  'scheduleTask.createQuickNote': {
    execute: (args, context) => scheduleTaskToolService.createQuickNote(args, context),
  },
  'scheduleTask.fetchTodos': {
    execute: (args, context) => scheduleTaskToolService.fetchTodos(args, context),
  },
  'scheduleTask.fetchTobuys': {
    execute: (args, context) => scheduleTaskToolService.fetchTobuys(args, context),
  },
};
