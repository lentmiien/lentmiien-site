let gptImageToolService;
let knowledgeToolService;
let pushoverReminderToolService;
let scheduleTaskToolService;
let codexChatToolService;
let humanToolRequestService;

function getCodexChatToolService() {
  if (!codexChatToolService) {
    const CodexChatToolService = require('./codexChatToolService');
    codexChatToolService = new CodexChatToolService();
  }
  return codexChatToolService;
}

function getHumanToolRequestService() {
  if (!humanToolRequestService) {
    const HumanToolRequestService = require('./humanToolRequestService');
    humanToolRequestService = new HumanToolRequestService();
  }
  return humanToolRequestService;
}

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
  'codex.runAiGatewayLinux': {
    execute: (args, context) => getCodexChatToolService().runAiGatewayLinux(args, context),
  },
  'codex.runLentmiienSiteLinux': {
    execute: (args, context) => getCodexChatToolService().runLentmiienSiteLinux(args, context),
  },
  'codex.runLentmiienSiteProduction': {
    execute: (args, context) => getCodexChatToolService().runLentmiienSiteProduction(args, context),
  },
  'codex.fetchRequestOptions': {
    execute: (args, context) => getCodexChatToolService().fetchRequestOptions(args, context),
  },
  'codex.runInWorkspace': {
    execute: (args, context) => getCodexChatToolService().runInWorkspace(args, context),
  },
  'humanRequest.askCodex': {
    execute: (args, context) => getHumanToolRequestService().execute(args, context, 'codex'),
  },
  'humanRequest.askGeneral': {
    execute: (args, context) => getHumanToolRequestService().execute(args, context, 'general'),
  },
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
