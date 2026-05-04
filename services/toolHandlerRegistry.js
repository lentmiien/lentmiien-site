let gptImageToolService;
let knowledgeToolService;
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

module.exports = {
  'gptImage.generate': {
    execute: (args, context) => getGptImageToolService().execute(args, context),
  },
  'knowledge.create': {
    execute: (args, context) => getKnowledgeToolService().createKnowledge(args, context),
  },
  'scheduleTask.createTodo': {
    execute: (args, context) => getScheduleTaskToolService().createTodo(args, context),
  },
  'scheduleTask.createTobuy': {
    execute: (args, context) => getScheduleTaskToolService().createTobuy(args, context),
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
