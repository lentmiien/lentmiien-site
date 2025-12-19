require('dotenv').config();

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mongoose = require('mongoose');
const logger = require('./utils/logger');
const { runPreflightChecks, notifyStartupAlert } = require('./utils/startupChecks');
const { fetchUsageSummaryForPeriod } = require('./usage');
const Chat4Model = require('./models/chat4');
const Conversation4Model = require('./models/conversation4');
const batchprompt = require('./models/batchprompt');
const embedding = require('./models/embedding');
const openaicalllog = require('./models/openaicalllog');
const OpenAIUsage = require('./models/openai_usage');
const SoraVideo = require('./models/sora_video');
const ApiDebugLog = require('./models/api_debug_log');
const TransactionModel = require('./models/transaction_db');
const HtmlPageRating = require('./models/html_page_rating');
const MessageInboxEntry = require('./models/message_inbox');
const VectorEmbedding = require('./models/vector_embedding');
const VectorEmbeddingHighQuality = require('./models/vector_embedding_high_quality');

const ROOT_DIR = __dirname;
const TEMP_DIR = path.join(ROOT_DIR, 'tmp_data');
const PDF_JOB_DIR = path.join(ROOT_DIR, 'public', 'temp', 'pdf');
const PNG_FOLDER = path.join(ROOT_DIR, 'public', 'img');
const VIDEO_DIR = path.join(ROOT_DIR, 'public', 'video');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const HTML_DIR = path.join(ROOT_DIR, 'public', 'html');
const DROPBOX_TOKEN_PATH = path.join(ROOT_DIR, 'tokens.json');

const PDF_JOB_MAX_AGE_HOURS = Number.parseInt(process.env.CHAT_PDF_MAX_AGE_HOURS || '24', 10) || 24;
const LOG_RETENTION_DAYS = 7;
const DROPBOX_REQUIRED_ENV = ['DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET', 'DROPBOX_REDIRECT_URI'];
const MESSAGE_COLLECTION = 'message_inbox';
const MESSAGE_CONTENT_TYPE = 'message';
const THREAD_COLLECTION = 'message_thread';

const DIRECTORIES_TO_ENSURE = [
  path.join(ROOT_DIR, 'tmp_data'),
  path.join(ROOT_DIR, 'cache'),
  path.join(ROOT_DIR, 'public', 'temp'),
  path.join(ROOT_DIR, 'public', 'video'),
  path.join(ROOT_DIR, 'github-repos'),
  path.join(ROOT_DIR, 'logs'),
];

const CACHE_FILES_TO_ENSURE = [
  { filePath: path.join(ROOT_DIR, 'cache', 'chat3vdb.json'), content: '[]' },
  { filePath: path.join(ROOT_DIR, 'cache', 'default_models.json'), content: '{}' },
  { filePath: path.join(ROOT_DIR, 'cache', 'embedding.json'), content: '[]' },
];

const sectionResults = [];

function recordSection(name, status, metadata = {}) {
  sectionResults.push({
    name,
    status,
    ...metadata,
  });
}

function resetSectionResults() {
  sectionResults.length = 0;
  return sectionResults;
}

function buildSummary() {
  const okSections = sectionResults.filter((entry) => entry.status === 'ok');
  const warningSections = sectionResults.filter((entry) => entry.status === 'warning');
  const failedSections = sectionResults.filter((entry) => entry.status === 'failed');
  const failedCriticalSections = failedSections.filter((entry) => entry.critical);
  return {
    totalSections: sectionResults.length,
    okCount: okSections.length,
    warningCount: warningSections.length,
    failedCount: failedSections.length,
    failedCriticalCount: failedCriticalSections.length,
    failedSections: failedSections.map((entry) => entry.name),
    warningSections: warningSections.map((entry) => entry.name),
    sections: sectionResults,
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withRetry(operation, options = {}) {
  const {
    attempts = 3,
    baseDelayMs = 500,
    factor = 2,
    label = 'operation',
  } = options;
  let attempt = 0;
  let lastError;
  while (attempt < attempts) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const hasNextAttempt = attempt < attempts;
      logger.warning(`${label} attempt ${attempt} failed`, {
        category: 'startup:retry',
        metadata: { error: error.message },
      });
      if (!hasNextAttempt) {
        break;
      }
      const delayMs = baseDelayMs * Math.pow(factor, attempt - 1);
      await delay(delayMs);
    }
  }
  throw lastError;
}

async function runSection(name, fn, options = {}) {
  const { critical = false, bailOnError = false } = options;
  const start = Date.now();
  try {
    const data = await fn();
    const normalized = data && typeof data === 'object' ? data : { value: data };
    const status = normalized.skipped ? 'skipped' : 'ok';
    recordSection(name, status, {
      critical,
      durationMs: Date.now() - start,
      details: normalized,
    });
    logger.notice(`${name} completed with status ${status}`, {
      category: 'startup:section',
      metadata: { name, status },
    });
    return normalized;
  } catch (error) {
    const status = critical ? 'failed' : 'warning';
    recordSection(name, status, {
      critical,
      durationMs: Date.now() - start,
      error: error.message,
    });
    logger.error(`${name} failed`, {
      category: 'startup:section',
      metadata: { name, error: error.message },
    });
    if (bailOnError) {
      throw error;
    }
    return null;
  }
}

async function ensureDirectoriesAndFiles() {
  const createdDirs = [];
  DIRECTORIES_TO_ENSURE.forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      createdDirs.push(dirPath);
    }
  });

  const createdFiles = [];
  CACHE_FILES_TO_ENSURE.forEach(({ filePath, content }) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content);
      createdFiles.push(filePath);
    }
  });

  if (!fs.existsSync(path.join(ROOT_DIR, '.env'))) {
    logger.warning('.env file not found; using only environment variables', {
      category: 'startup:env',
    });
  }

  return { createdDirs, createdFiles };
}

async function resetDirectory(dirPath) {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function pruneStalePdfJobs(directory, maxAgeHours) {
  let removed = 0;
  try {
    await fs.promises.mkdir(directory, { recursive: true });
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const jobDir = path.join(directory, entry.name);
      const stats = await fs.promises.stat(jobDir);
      if (stats.mtimeMs < cutoff) {
        await fs.promises.rm(jobDir, { recursive: true, force: true });
        removed += 1;
        logger.notice(`Removed stale PDF conversion job: ${jobDir}`);
      }
    }
  } catch (error) {
    logger.warning('Unable to prune PDF conversion cache', error);
  }
  return removed;
}

async function pruneMissingHtmlRatings() {
  await fs.promises.mkdir(HTML_DIR, { recursive: true });
  const entriesOnDisk = await fs.promises.readdir(HTML_DIR).catch(() => []);
  const normalizedFiles = new Set(
    entriesOnDisk
      .filter((name) => typeof name === 'string' && name.toLowerCase().endsWith('.html'))
      .map((name) => name.toLowerCase()),
  );
  const metadataEntries = await HtmlPageRating.find({}, { filename: 1 }).lean().exec();
  const missing = metadataEntries
    .filter((entry) => !entry.filename || !normalizedFiles.has(String(entry.filename).toLowerCase()))
    .map((entry) => entry.filename)
    .filter(Boolean);
  if (!missing.length) {
    return 0;
  }
  const { deletedCount = 0 } = await HtmlPageRating.deleteMany({ filename: { $in: missing } });
  if (deletedCount > 0) {
    logger.notice(`Removed ${deletedCount} stale HTML rating entr${deletedCount === 1 ? 'y' : 'ies'}.`, {
      category: 'startup:html',
    });
  }
  return deletedCount;
}

async function cleanTempAndPdfCaches() {
  await resetDirectory(TEMP_DIR);
  const prunedJobs = await pruneStalePdfJobs(PDF_JOB_DIR, PDF_JOB_MAX_AGE_HOURS);
  return { tempReset: true, prunedPdfJobs: prunedJobs };
}

async function convertPngAssets() {
  if (!fs.existsSync(PNG_FOLDER)) {
    return { skipped: true, reason: 'public/img directory missing' };
  }
  const files = await fs.promises.readdir(PNG_FOLDER);
  let converted = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.png') {
      continue;
    }
    const baseName = path.basename(file, ext);
    const jpgPath = path.join(PNG_FOLDER, `${baseName}.jpg`);
    const pngPath = path.join(PNG_FOLDER, file);
    try {
      await fs.promises.access(jpgPath);
    } catch (_) {
      try {
        const pngBuffer = await fs.promises.readFile(pngPath);
        const jpgBuffer = await sharp(pngBuffer).jpeg({ quality: 70 }).toBuffer();
        await fs.promises.writeFile(jpgPath, jpgBuffer);
        converted += 1;
        logger.notice(`Converted ${file} to JPG.`);
      } catch (error) {
        logger.warning(`Failed to convert ${file}`, error);
      }
    }
  }
  return { converted };
}

async function pruneOldLogs() {
  const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
  const entries = await fs.promises.readdir(LOG_DIR);
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.log')) {
      continue;
    }
    const filePath = path.join(LOG_DIR, entry);
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        continue;
      }
      if (Date.now() - stats.mtimeMs > retentionMs) {
        await fs.promises.unlink(filePath);
        removed += 1;
        logger.notice(`Removed old log file: ${filePath}`);
      }
    } catch (error) {
      logger.warning(`Unable to inspect log file: ${filePath}`, error);
    }
  }
  return { removed };
}

async function removeVideoRecords(filter) {
  const videos = await SoraVideo.find(filter).lean();
  if (videos.length === 0) {
    return 0;
  }
  for (const video of videos) {
    if (!video.filename) {
      continue;
    }
    const videoPath = path.join(VIDEO_DIR, video.filename);
    try {
      await fs.promises.unlink(videoPath);
      logger.notice(`Removed video file: ${videoPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warning(`Unable to remove video file: ${videoPath}`, error);
      }
    }
  }
  await SoraVideo.deleteMany({ _id: { $in: videos.map((video) => video._id) } });
  return videos.length;
}

function extractPrimaryCategory(categories) {
  if (!categories || typeof categories !== 'string' || !categories.includes('@')) {
    return null;
  }
  const segments = categories
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [categoryId = '', percentString] = segment.split('@');
      const trimmedId = categoryId.trim();
      if (!trimmedId) {
        return null;
      }
      const percentValue = Number.parseFloat(percentString);
      return {
        categoryId: trimmedId,
        percent: Number.isFinite(percentValue) ? percentValue : null,
      };
    })
    .filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  if (segments.length === 1) {
    return { nextValue: segments[0].categoryId, reason: 'single' };
  }
  let chosen = segments[0];
  for (const segment of segments.slice(1)) {
    const currentPercent = segment.percent ?? -Infinity;
    const chosenPercent = chosen.percent ?? -Infinity;
    if (currentPercent > chosenPercent) {
      chosen = segment;
    }
  }
  return { nextValue: chosen.categoryId, reason: 'multiple' };
}

async function normalizeLegacyTransactionCategories() {
  const legacyTransactions = await TransactionModel.find({ categories: /@/ }).select('_id categories').lean();
  if (legacyTransactions.length === 0) {
    return {
      scanned: 0,
      updated: 0,
      singleNormalized: 0,
      multiNormalized: 0,
      skipped: 0,
    };
  }

  let singleNormalized = 0;
  let multiNormalized = 0;
  let skipped = 0;
  const operations = [];

  for (const transaction of legacyTransactions) {
    const normalized = extractPrimaryCategory(transaction.categories);
    if (!normalized || !normalized.nextValue) {
      skipped += 1;
      continue;
    }
    if (normalized.reason === 'single') {
      singleNormalized += 1;
    } else if (normalized.reason === 'multiple') {
      multiNormalized += 1;
    }
    operations.push({
      updateOne: {
        filter: { _id: transaction._id },
        update: { $set: { categories: normalized.nextValue } },
      },
    });
  }

  if (operations.length > 0) {
    await TransactionModel.bulkWrite(operations, { ordered: false });
  }

  const result = {
    scanned: legacyTransactions.length,
    updated: operations.length,
    singleNormalized,
    multiNormalized,
    skipped,
  };

  logger.notice('Normalized legacy transaction categories', {
    category: 'startup:db',
    metadata: result,
  });

  return result;
}

function buildMessageInboxSourceMetadata(message) {
  const threadId = message?.threadId || null;
  return {
    collectionName: MESSAGE_COLLECTION,
    documentId: String(message._id),
    contentType: MESSAGE_CONTENT_TYPE,
    parentCollection: threadId ? THREAD_COLLECTION : null,
    parentId: threadId,
  };
}

function buildEmbeddingSourceFilter(source) {
  return {
    'source.collectionName': source.collectionName,
    'source.documentId': source.documentId,
    'source.contentType': source.contentType,
    'source.parentCollection': source.parentCollection ?? null,
    'source.parentId': source.parentId ?? null,
  };
}

async function pruneExpiredInboxMessages() {
  const now = new Date();
  const expiredMessages = await MessageInboxEntry.find({ retentionDeadlineDate: { $lt: now } })
    .select('_id threadId hasEmbedding hasHighQualityEmbedding')
    .lean()
    .exec();

  if (expiredMessages.length === 0) {
    return {
      removed: 0,
      defaultEmbeddingsRemoved: 0,
      highQualityEmbeddingsRemoved: 0,
    };
  }

  const defaultFilters = [];
  const highQualityFilters = [];

  expiredMessages.forEach((message) => {
    const source = buildMessageInboxSourceMetadata(message);
    if (message.hasEmbedding) {
      defaultFilters.push(buildEmbeddingSourceFilter(source));
    }
    if (message.hasHighQualityEmbedding) {
      highQualityFilters.push(buildEmbeddingSourceFilter(source));
    }
  });

  const defaultResultPromise = defaultFilters.length
    ? VectorEmbedding.deleteMany({ $or: defaultFilters })
    : Promise.resolve({ deletedCount: 0 });
  const highQualityResultPromise = highQualityFilters.length
    ? VectorEmbeddingHighQuality.deleteMany({ $or: highQualityFilters })
    : Promise.resolve({ deletedCount: 0 });

  const [defaultResult, highQualityResult] = await Promise.all([defaultResultPromise, highQualityResultPromise]);
  const { deletedCount: messagesRemoved = 0 } = await MessageInboxEntry.deleteMany({
    _id: { $in: expiredMessages.map((message) => message._id) },
  });

  if (messagesRemoved > 0) {
    logger.notice(`Removed ${messagesRemoved} expired inbox message${messagesRemoved === 1 ? '' : 's'}.`, {
      category: 'startup:message_inbox',
      metadata: {
        defaultEmbeddingsRemoved: defaultResult?.deletedCount || 0,
        highQualityEmbeddingsRemoved: highQualityResult?.deletedCount || 0,
      },
    });
  }

  return {
    removed: messagesRemoved,
    defaultEmbeddingsRemoved: defaultResult?.deletedCount || 0,
    highQualityEmbeddingsRemoved: highQualityResult?.deletedCount || 0,
  };
}

async function performDatabaseMaintenance() {
  const mongoUrl = process.env.MONGOOSE_URL;
  if (!mongoUrl) {
    return { skipped: true, reason: 'MONGOOSE_URL missing' };
  }

  const summary = {
    deletedTestChats: 0,
    deletedTestConversations: 0,
    usageEntriesInserted: 0,
    usageSyncSkipped: false,
    batchPromptsRemoved: 0,
    embeddingsCleared: false,
    openaiCallLogsCleared: 0,
    apiDebugPurged: 0,
    lowRatedVideosRemoved: 0,
    staleIncompleteVideosRemoved: 0,
    transactionCategoryCleanup: null,
    htmlRatingEntriesRemoved: 0,
    expiredInboxMessagesRemoved: 0,
    messageInboxDefaultEmbeddingsRemoved: 0,
    messageInboxHighQualityEmbeddingsRemoved: 0,
  };

  await mongoose.connect(mongoUrl, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });

  try {
    const { deletedCount: chatRemoved = 0 } = await Chat4Model.deleteMany({ category: 'Test' });
    const { deletedCount: conversationRemoved = 0 } = await Conversation4Model.deleteMany({ category: 'Test' });
    summary.deletedTestChats = chatRemoved;
    summary.deletedTestConversations = conversationRemoved;

    if (process.env.OPENAI_ADMIN_KEY) {
      let currentMs = Date.now() - 1000 * 60 * 60 * 24 * 30;
      for (let i = 0; i < 31; i += 1) {
        const now = new Date(currentMs);
        const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const startDate = new Date(endDate.getTime() - 1000 * 60 * 60 * 24);
        const dateString = `${startDate.getFullYear()}-${startDate.getMonth() > 8 ? startDate.getMonth() + 1 : `0${startDate.getMonth() + 1}`}-${startDate.getDate() > 9 ? startDate.getDate() : `0${startDate.getDate()}`}`;
        const existing = await OpenAIUsage.find({ entry_date: dateString });
        if (existing.length === 0) {
          const usageSummary = await withRetry(
            async () => {
              const summaryForDay = await fetchUsageSummaryForPeriod(startDate, endDate);
              if (!summaryForDay) {
                throw new Error('Usage summary unavailable');
              }
              return summaryForDay;
            },
            { attempts: 3, baseDelayMs: 750, label: `openai-usage-${dateString}` },
          );
          usageSummary.entry_date = dateString;
          await new OpenAIUsage(usageSummary).save();
          summary.usageEntriesInserted += 1;
          logger.notice(`Saved OpenAI usage data for ${dateString}`);
        }
        currentMs += 1000 * 60 * 60 * 24;
      }
    } else {
      summary.usageSyncSkipped = true;
      logger.warning('Skipping OpenAI usage sync; OPENAI_ADMIN_KEY not configured', {
        category: 'startup:db',
      });
    }

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const { deletedCount: promptsRemoved = 0 } = await batchprompt.deleteMany({ timestamp: { $lt: oneMonthAgo } });
    summary.batchPromptsRemoved = promptsRemoved;

    await embedding.deleteMany({});
    summary.embeddingsCleared = true;

    const { deletedCount: logsRemoved = 0 } = await openaicalllog.deleteMany({});
    summary.openaiCallLogsCleared = logsRemoved;

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const { deletedCount: apiDebugRemoved = 0 } = await ApiDebugLog.deleteMany({ createdAt: { $lt: fiveDaysAgo } });
    summary.apiDebugPurged = apiDebugRemoved;

    summary.lowRatedVideosRemoved = await removeVideoRecords({ rating: 1, filename: { $nin: ['', null] } });
    const staleCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    summary.staleIncompleteVideosRemoved = await removeVideoRecords({
      status: { $ne: 'completed' },
      startedAt: { $lt: staleCutoff },
    });
    summary.transactionCategoryCleanup = await normalizeLegacyTransactionCategories();
    summary.htmlRatingEntriesRemoved = await pruneMissingHtmlRatings();
    const inboxCleanup = await pruneExpiredInboxMessages();
    summary.expiredInboxMessagesRemoved = inboxCleanup.removed;
    summary.messageInboxDefaultEmbeddingsRemoved = inboxCleanup.defaultEmbeddingsRemoved;
    summary.messageInboxHighQualityEmbeddingsRemoved = inboxCleanup.highQualityEmbeddingsRemoved;

    return summary;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

function canRunDropboxOperations() {
  const missingEnv = DROPBOX_REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missingEnv.length > 0) {
    return { ok: false, reason: `Missing env vars: ${missingEnv.join(', ')}` };
  }
  if (!fs.existsSync(DROPBOX_TOKEN_PATH)) {
    return { ok: false, reason: 'tokens.json not found' };
  }
  return { ok: true };
}

async function runDropboxPipelines() {
  const readiness = canRunDropboxOperations();
  if (!readiness.ok) {
    return { skipped: true, reason: readiness.reason };
  }

  const { backup, setup } = require('./dropbox');
  await withRetry(() => backup(), {
    attempts: 2,
    baseDelayMs: 1000,
    label: 'dropbox-backup',
  });
  await withRetry(() => setup(), {
    attempts: 2,
    baseDelayMs: 1000,
    label: 'dropbox-restore',
  });
  return { backup: 'ok', restore: 'ok' };
}

async function main() {
  resetSectionResults();
  const preflight = await runPreflightChecks();
  recordSection('Preflight checks', preflight.ok ? 'ok' : 'failed', {
    critical: true,
    details: preflight.results,
  });

  if (!preflight.ok) {
    await notifyStartupAlert({
      severity: 'critical',
      subject: 'Startup preflight failed',
      summary: preflight,
      message: 'Preflight checks failed; aborting startup pipeline.',
    });
    logger.error('Preflight checks failed. Aborting setup.');
    process.exitCode = 1;
    return;
  }

  try {
    await runSection('Directory preparation', ensureDirectoriesAndFiles, { critical: true, bailOnError: true });
    await runSection('Temp/cache cleanup', cleanTempAndPdfCaches);
    await runSection('PNG asset conversion', convertPngAssets);
    await runSection('Log pruning', pruneOldLogs);
    await runSection('Database maintenance', performDatabaseMaintenance);
    await runSection('Dropbox sync', runDropboxPipelines);
  } catch (error) {
    const summary = buildSummary();
    await notifyStartupAlert({
      severity: 'critical',
      subject: 'Setup aborted due to critical failure',
      message: error.message,
      summary,
    });
    process.exitCode = 1;
    return;
  }

  const summary = buildSummary();
  logger.notice('Startup diagnostics summary', {
    category: 'startup:summary',
    metadata: summary,
  });

  if (summary.failedCriticalCount > 0) {
    await notifyStartupAlert({
      severity: 'critical',
      subject: 'Startup diagnostics: critical failures detected',
      summary,
    });
    process.exitCode = 1;
    return;
  }

  if (summary.failedCount > 0 || summary.warningCount > 0) {
    await notifyStartupAlert({
      severity: 'warning',
      subject: 'Startup diagnostics reported warnings',
      summary,
    });
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    logger.error('setup.js encountered an unhandled exception', error);
    try {
      await notifyStartupAlert({
        severity: 'critical',
        subject: 'setup.js crashed',
        message: error.message,
      });
    } catch (_) {
      // ignore alert failures
    }
    process.exitCode = 1;
  });
}

module.exports = {
  buildSummary,
  canRunDropboxOperations,
  cleanTempAndPdfCaches,
  convertPngAssets,
  delay,
  ensureDirectoriesAndFiles,
  main,
  performDatabaseMaintenance,
  pruneExpiredInboxMessages,
  pruneOldLogs,
  recordSection,
  resetSectionResults,
  runDropboxPipelines,
  runSection,
  withRetry,
};
