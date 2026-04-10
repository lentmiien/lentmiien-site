const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { syncOpenAIUsageHistory } = require('./openaiUsageSyncService');
const { RefreshOpenAIModels } = require('../utils/ChatGPT');
const { RefreshAnthropicModels } = require('../utils/anthropic');

const REFRESH_COOLDOWN_HOURS = 12;
const REFRESH_COOLDOWN_MS = REFRESH_COOLDOWN_HOURS * 60 * 60 * 1000;
const STATE_FILE_PATH = path.join(__dirname, '..', 'cache', 'admin_refresh_state.json');

const ADMIN_REFRESH_TASKS = Object.freeze({
  openaiUsage: 'openaiUsage',
  aiModelLists: 'aiModelLists',
});

function buildDefaultState() {
  return {
    [ADMIN_REFRESH_TASKS.openaiUsage]: { lastSuccessAt: null },
    [ADMIN_REFRESH_TASKS.aiModelLists]: { lastSuccessAt: null },
  };
}

function normalizeTaskState(taskState) {
  return {
    lastSuccessAt: typeof taskState?.lastSuccessAt === 'string' && taskState.lastSuccessAt.trim().length > 0
      ? taskState.lastSuccessAt
      : null,
  };
}

function normalizeState(rawState) {
  const baseState = buildDefaultState();
  const source = rawState && typeof rawState === 'object' ? rawState : {};
  return {
    [ADMIN_REFRESH_TASKS.openaiUsage]: normalizeTaskState(source[ADMIN_REFRESH_TASKS.openaiUsage] || baseState[ADMIN_REFRESH_TASKS.openaiUsage]),
    [ADMIN_REFRESH_TASKS.aiModelLists]: normalizeTaskState(source[ADMIN_REFRESH_TASKS.aiModelLists] || baseState[ADMIN_REFRESH_TASKS.aiModelLists]),
  };
}

async function ensureStateFile() {
  await fs.promises.mkdir(path.dirname(STATE_FILE_PATH), { recursive: true });
  try {
    await fs.promises.access(STATE_FILE_PATH, fs.constants.F_OK);
  } catch (_) {
    await fs.promises.writeFile(STATE_FILE_PATH, JSON.stringify(buildDefaultState(), null, 2));
  }
}

async function readState() {
  await ensureStateFile();
  try {
    const raw = await fs.promises.readFile(STATE_FILE_PATH, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    logger.warning('Unable to read admin refresh cooldown state; resetting file', {
      category: 'admin_refresh',
      metadata: { error: error.message },
    });
    const fallbackState = buildDefaultState();
    await fs.promises.writeFile(STATE_FILE_PATH, JSON.stringify(fallbackState, null, 2));
    return fallbackState;
  }
}

async function writeState(state) {
  await ensureStateFile();
  await fs.promises.writeFile(STATE_FILE_PATH, JSON.stringify(normalizeState(state), null, 2));
}

function formatTimestamp(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function buildCooldownStatus(taskState) {
  const lastSuccessAt = taskState?.lastSuccessAt || null;
  const lastSuccessDate = lastSuccessAt ? new Date(lastSuccessAt) : null;
  const lastSuccessValid = Boolean(lastSuccessDate && !Number.isNaN(lastSuccessDate.getTime()));
  const nextAllowedDate = lastSuccessValid
    ? new Date(lastSuccessDate.getTime() + REFRESH_COOLDOWN_MS)
    : null;
  const remainingMs = nextAllowedDate
    ? Math.max(0, nextAllowedDate.getTime() - Date.now())
    : 0;

  return {
    canRun: !nextAllowedDate || remainingMs === 0,
    lastSuccessAt: lastSuccessValid ? lastSuccessDate.toISOString() : null,
    lastSuccessLabel: formatTimestamp(lastSuccessValid ? lastSuccessDate.toISOString() : null),
    nextAllowedAt: nextAllowedDate ? nextAllowedDate.toISOString() : null,
    nextAllowedLabel: formatTimestamp(nextAllowedDate ? nextAllowedDate.toISOString() : null),
    remainingMs,
  };
}

async function getAdminRefreshState() {
  const state = await readState();
  return {
    openaiUsage: buildCooldownStatus(state[ADMIN_REFRESH_TASKS.openaiUsage]),
    aiModelLists: buildCooldownStatus(state[ADMIN_REFRESH_TASKS.aiModelLists]),
  };
}

async function runTaskWithCooldown(taskKey, runner) {
  const state = await readState();
  const cooldown = buildCooldownStatus(state[taskKey]);
  if (!cooldown.canRun) {
    return {
      ok: false,
      cooldownActive: true,
      cooldown,
      result: null,
    };
  }

  const result = await runner();
  if (result?.skipped) {
    return {
      ok: false,
      cooldownActive: false,
      skipped: true,
      cooldown,
      result,
    };
  }

  const lastSuccessAt = new Date().toISOString();
  state[taskKey] = { lastSuccessAt };
  await writeState(state);

  return {
    ok: true,
    cooldownActive: false,
    cooldown: buildCooldownStatus(state[taskKey]),
    result,
  };
}

async function refreshOpenAIUsageForAdmin() {
  return runTaskWithCooldown(ADMIN_REFRESH_TASKS.openaiUsage, async () => {
    const result = await syncOpenAIUsageHistory();
    if (!result?.skipped) {
      logger.notice('Admin-triggered OpenAI usage refresh completed', {
        category: 'admin_refresh',
        metadata: {
          inserted: result?.usageEntriesInserted || 0,
          skippedExisting: result?.existingEntriesSkipped || 0,
        },
      });
    }
    return result;
  });
}

async function refreshAIModelListsForAdmin() {
  return runTaskWithCooldown(ADMIN_REFRESH_TASKS.aiModelLists, async () => {
    const [openaiModels, anthropicModels] = await Promise.all([
      RefreshOpenAIModels(),
      RefreshAnthropicModels(),
    ]);

    logger.notice('Admin-triggered provider model refresh completed', {
      category: 'admin_refresh',
      metadata: {
        openaiCount: Array.isArray(openaiModels) ? openaiModels.length : 0,
        anthropicCount: Array.isArray(anthropicModels) ? anthropicModels.length : 0,
      },
    });

    return {
      openaiCount: Array.isArray(openaiModels) ? openaiModels.length : 0,
      anthropicCount: Array.isArray(anthropicModels) ? anthropicModels.length : 0,
    };
  });
}

module.exports = {
  ADMIN_REFRESH_TASKS,
  REFRESH_COOLDOWN_HOURS,
  getAdminRefreshState,
  refreshAIModelListsForAdmin,
  refreshOpenAIUsageForAdmin,
};
