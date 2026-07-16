const APP_SETTING_KEYS = Object.freeze({
  CHAT5_TITLE_MODEL: 'chat5.ai.title_model',
  CHAT5_SUMMARY_MODEL: 'chat5.ai.summary_model',
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
]);

module.exports = {
  APP_SETTING_KEYS,
  DEFAULT_APP_SETTINGS,
};
