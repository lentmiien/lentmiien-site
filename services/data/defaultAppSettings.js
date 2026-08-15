const APP_SETTING_KEYS = Object.freeze({
  CHAT5_TITLE_MODEL: 'chat5.ai.title_model',
  CHAT5_SUMMARY_MODEL: 'chat5.ai.summary_model',
  CHAT5_BATCH_DEFAULT_MODEL: 'chat5.batch.default_model',
  CHAT5_BATCH_SUMMARY_MODEL: 'chat5.batch.summary_model',
  CODEX_LOCAL_MODELS: 'codex.local_models',
  CODEX_LOG_REVIEW_LAST_RUN_AT: 'codex_log_review.last_run_at',
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
    key: APP_SETTING_KEYS.CHAT5_BATCH_DEFAULT_MODEL,
    value: 'gpt-5.6-luna',
    description: 'OpenAI batch-capable model used when the model selected in Chat5 is not eligible for batch processing.',
  }),
  Object.freeze({
    key: APP_SETTING_KEYS.CHAT5_BATCH_SUMMARY_MODEL,
    value: 'gpt-4.1-nano-2025-04-14',
    description: 'Preferred OpenAI batch-capable model used for automatic Chat5 conversation summaries.',
  }),
  Object.freeze({
    key: APP_SETTING_KEYS.CODEX_LOCAL_MODELS,
    value: 'qwen3.6:27b',
    description: 'Comma-separated Ollama models offered by the Codex tool. Changes take effect on the next page load or request.',
  }),
  Object.freeze({
    key: APP_SETTING_KEYS.CODEX_LOG_REVIEW_LAST_RUN_AT,
    value: '2026-08-11T03:00:00.000Z',
    description: 'Last successful scheduled start for the Codex production log review workflow. The initial value schedules the first run for 2026-08-21 12:00 JST.',
  }),
]);

module.exports = {
  APP_SETTING_KEYS,
  DEFAULT_APP_SETTINGS,
};
