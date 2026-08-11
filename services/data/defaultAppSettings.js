const APP_SETTING_KEYS = Object.freeze({
  CHAT5_TITLE_MODEL: 'chat5.ai.title_model',
  CHAT5_SUMMARY_MODEL: 'chat5.ai.summary_model',
  CHAT5_BATCH_SUMMARY_MODEL: 'chat5.batch.summary_model',
});

const DEFAULT_APP_SETTINGS = Object.freeze([
  Object.freeze({
    key: APP_SETTING_KEYS.CHAT5_TITLE_MODEL,
    value: 'gpt-4.1-nano-2025-04-14',
    description: 'OpenAI model used by Chat5 AI Generate Title.',
  }),
  Object.freeze({
    key: APP_SETTING_KEYS.CHAT5_SUMMARY_MODEL,
    value: 'gpt-4.1-mini',
    description: 'OpenAI model used by Chat5 AI Generate Summary.',
  }),
  Object.freeze({
    key: APP_SETTING_KEYS.CHAT5_BATCH_SUMMARY_MODEL,
    value: 'gpt-4.1-nano-2025-04-14',
    description: 'Preferred OpenAI batch-capable model used for automatic Chat5 conversation summaries.',
  }),
]);

module.exports = {
  APP_SETTING_KEYS,
  DEFAULT_APP_SETTINGS,
};
