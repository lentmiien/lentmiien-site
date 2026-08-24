let gptImageToolService;
let knowledgeToolService;
let pushoverReminderToolService;
let scheduleTaskToolService;

function getGptImageToolService() {
  if (!gptImageToolService) {
    const GptImageToolService = require('./gptImageToolService');
    gptImageToolService = new GptImageToolService();
  }
  return gptImageToolService;
}

function getKnowledgeToolService() {
  if (!knowledgeToolService) {
    const KnowledgeToolService = require('./knowledgeToolService');
    knowledgeToolService = new KnowledgeToolService();
  }
  return knowledgeToolService;
}

function getScheduleTaskToolService() {
  if (!scheduleTaskToolService) {
    const ScheduleTaskToolService = require('./scheduleTaskToolService');
    scheduleTaskToolService = new ScheduleTaskToolService();
  }
  return scheduleTaskToolService;
}

function getPushoverReminderToolService() {
  if (!pushoverReminderToolService) {
    const PushoverReminderToolService = require('./pushoverReminderToolService');
    pushoverReminderToolService = new PushoverReminderToolService();
  }
  return pushoverReminderToolService;
}

module.exports = {
  'gptImage.generate': {
    execute: (args, context) => getGptImageToolService().execute(args, context),
  },
  'knowledge.create': {
    execute: (args, context) => getKnowledgeToolService().createKnowledge(args, context),
  },
  'pushoverReminder.set': {
    execute: (args, context) => getPushoverReminderToolService().setReminder(args, context),
  },
  'pushoverReminder.fetch': {
    execute: (args, context) => getPushoverReminderToolService().fetchReminders(args, context),
  },
  'pushoverReminder.delete': {
    execute: (args, context) => getPushoverReminderToolService().deleteReminder(args, context),
  },
  'scheduleTask.createTodo': {
    execute: (args, context) => getScheduleTaskToolService().createTodo(args, context),
  },
  'scheduleTask.createTobuy': {
    execute: (args, context) => getScheduleTaskToolService().createTobuy(args, context),
  },
  'scheduleTask.createTodoWithReminders': {
    execute: (args, context) => getScheduleTaskToolService().createTodoWithReminders(args, context),
  },
  'scheduleTask.createTobuyWithReminders': {
    execute: (args, context) => getScheduleTaskToolService().createTobuyWithReminders(args, context),
  },
  'scheduleTask.createQuickNote': {
    execute: (args, context) => getScheduleTaskToolService().createQuickNote(args, context),
  },
  'scheduleTask.fetchTodos': {
    execute: (args, context) => getScheduleTaskToolService().fetchTodos(args, context),
  },
  'scheduleTask.fetchTobuys': {
    execute: (args, context) => getScheduleTaskToolService().fetchTobuys(args, context),
  },
};
