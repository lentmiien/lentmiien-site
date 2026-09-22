const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { operationDiagnostic, safeItemCode } = require('../utils/amiamiDiagnostics');
const AmiAmiItem = require('../models/amiami_item');
const { ensureCurlCffiRuntime } = require('./install-curl-cffi');
const {
  AMIAMI_NEW_ITEMS_URL,
  fetchItemDetail,
  fetchNewItemsPage,
  normalizeDetail,
} = require('../services/amiamiScraperService');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATA_FILE = path.join(PROJECT_ROOT, 'tmp_data', 'amiami-new-items.json');
const DEFAULT_SUMMARY_FILE = path.join(PROJECT_ROOT, 'tmp_data', 'amiami-new-items-summary.json');

const AMIAMI_SITE_URL = 'https://www.amiami.com';
const AMIAMI_IMAGE_URL = 'https://img.amiami.com';
const NEW_ITEMS_URL = AMIAMI_NEW_ITEMS_URL;

function parseArgs(argv) {
  const options = {
    dataFile: DEFAULT_DATA_FILE,
    summaryFile: DEFAULT_SUMMARY_FILE,
    detailDelayMs: 60000,
    maxDetailItems: Infinity,
    maxNewItems: Infinity,
    skipDetails: false,
    forceRefreshDetails: false,
    includeRaw: false,
    impersonate: 'chrome136',
    requestTimeoutMs: 30000,
    detailRetries: 2,
    retryDelayMs: 5000,
    storage: 'tmp',
    mongoUri: null,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--skip-details' || arg === '--list-only') {
      options.skipDetails = true;
    } else if (arg === '--force-refresh-details') {
      options.forceRefreshDetails = true;
    } else if (arg === '--include-raw') {
      options.includeRaw = true;
    } else if (arg.startsWith('--data-file=')) {
      options.dataFile = path.resolve(PROJECT_ROOT, arg.slice('--data-file='.length));
    } else if (arg.startsWith('--summary-file=')) {
      options.summaryFile = path.resolve(PROJECT_ROOT, arg.slice('--summary-file='.length));
    } else if (arg.startsWith('--detail-delay-ms=')) {
      options.detailDelayMs = parseNonNegativeInteger(arg, '--detail-delay-ms');
    } else if (arg.startsWith('--max-detail-items=')) {
      options.maxDetailItems = parseNonNegativeInteger(arg, '--max-detail-items');
    } else if (arg.startsWith('--max-new-items=')) {
      options.maxNewItems = parseNonNegativeInteger(arg, '--max-new-items');
    } else if (arg.startsWith('--impersonate=')) {
      options.impersonate = arg.slice('--impersonate='.length);
    } else if (arg.startsWith('--request-timeout-ms=')) {
      options.requestTimeoutMs = parseNonNegativeInteger(arg, '--request-timeout-ms');
    } else if (arg.startsWith('--detail-retries=')) {
      options.detailRetries = parseNonNegativeInteger(arg, '--detail-retries');
    } else if (arg.startsWith('--retry-delay-ms=')) {
      options.retryDelayMs = parseNonNegativeInteger(arg, '--retry-delay-ms');
    } else if (arg.startsWith('--storage=')) {
      options.storage = normalizeStorage(arg.slice('--storage='.length));
    } else if (arg.startsWith('--mongo-uri=')) {
      options.mongoUri = arg.slice('--mongo-uri='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseNonNegativeInteger(arg, flagName) {
  const rawValue = arg.slice(`${flagName}=`.length);
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: npm run scrape:amiami -- [options]

Fetch AmiAmi English New Products and save records to tmp_data.

Options:
  --detail-delay-ms=MS       Delay between product detail API calls. Default: 60000.
  --max-detail-items=N       Maximum product detail pages to fetch in this run.
  --max-new-items=N          Maximum newly discovered items to add in this run.
  --skip-details             Only refresh the New Products list and insert skeletons.
  --force-refresh-details    Fetch details even when a record already has details.
  --include-raw              Store the raw AmiAmi item payload for later schema work.
  --data-file=PATH           JSON data file. Default: tmp_data/amiami-new-items.json.
  --summary-file=PATH        Run summary file. Default: tmp_data/amiami-new-items-summary.json.
  --request-timeout-ms=MS    Per-request timeout. Default: 30000.
  --detail-retries=N         Retries for each detail request. Default: 2.
  --retry-delay-ms=MS        Delay before retrying a failed detail request. Default: 5000.
  --storage=tmp|db           Save to tmp_data JSON or MongoDB. Default: tmp.
  --mongo-uri=URI            MongoDB URI for --storage=db. Defaults to MONGOOSE_URL.
`);
}

function normalizeStorage(value) {
  if (value === 'database') {
    return 'db';
  }
  if (value !== 'tmp' && value !== 'db') {
    throw new Error('--storage must be either tmp or db');
  }
  return value;
}

const FAILURE_SAMPLE_LIMIT = 10;

async function main(argv = process.argv.slice(2)) {
  let options = parseArgs([]);
  const run = {
    phase: 'arguments',
    itemCode: null,
    needsDisconnect: false,
    summary: {
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      sourceUrl: NEW_ITEMS_URL,
      sourceItemCount: null,
      processedSourceItemCount: 0,
      detailResults: { attempted: 0, fetched: 0, failed: 0, skipped: 0 },
      failures: [],
    },
  };
  let fatal;
  try {
    options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return;
    }
    run.phase = 'runtime';
    await ensureCurlCffiRuntime();
    if (options.storage === 'db') await runWithDatabase(options, run);
    else await runWithTmpData(options, run);
  } catch (error) {
    fatal = operationDiagnostic(error, run);
  } finally {
    if (run.needsDisconnect) {
      try {
        await mongoose.disconnect();
      } catch (error) {
        const cleanupFailure = operationDiagnostic(error, { phase: 'cleanup' });
        if (fatal) run.summary.cleanupFailure = cleanupFailure;
        else fatal = cleanupFailure;
      }
    }
  }

  const summary = run.summary;
  for (const field of ['newlyDiscovered', 'listingChanged']) {
    if (summary[field]) {
      summary[`${field}Count`] = summary[field].length;
      summary[field] = summary[field].map(safeItemCode);
    }
  }
  summary.storage = options.storage;
  summary.finishedAt = new Date().toISOString();
  summary.elapsedMs = Date.parse(summary.finishedAt) - Date.parse(summary.startedAt);
  summary.status = fatal ? 'failed' : summary.detailResults.failed ? 'partial' : 'success';
  if (fatal) summary.error = fatal;
  let summaryWritten = false;
  try {
    await ensureParentDirectory(options.summaryFile);
    await writeJson(options.summaryFile, summary);
    summaryWritten = true;
  } catch (error) {
    const failure = operationDiagnostic(error, { phase: 'summary' });
    summary.summaryWriteFailure = failure;
    summary.status = 'failed';
    if (!fatal) {
      fatal = failure;
      summary.error = fatal;
    }
  }

  // Shared logger metadata deliberately excludes CLI options, paths, raw errors
  // and entire stores. Await the append before allowing the process to exit.
  if (summary.status !== 'success') {
    const level = fatal ? 'error' : 'warning';
    const message = fatal ? 'AmiAmi scraper run failed' : 'AmiAmi scraper run completed with detail failures';
    const metadata = {
      runId: summary.runId, startedAt: summary.startedAt, finishedAt: summary.finishedAt,
      elapsedMs: summary.elapsedMs, storage: summary.storage, status: summary.status,
      sourceItemCount: summary.sourceItemCount, detailResults: summary.detailResults,
      failures: summary.failures, error: summary.error, cleanupFailure: summary.cleanupFailure,
      summaryWritten, summaryWriteFailure: summary.summaryWriteFailure,
    };
    console.error(`${message} [${summary.runId}]${fatal ? `: ${fatal.message}` : ''}`);
    try {
      await logger[level](message, { category: 'amiami-scraper', metadata });
    } catch (_) {
      console.error(`AmiAmi scraper log write failed [${summary.runId}]; see the console summary.`);
    }
  }
  if (fatal) process.exitCode = 1;
  if (summaryWritten) console.log(`Saved run summary to ${options.summaryFile}`);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function recordDetailFailure(error, gcode, run) {
  const failure = operationDiagnostic(error, { phase: 'detail', itemCode: gcode });
  run.summary.detailResults.failed += 1;
  if (run.summary.failures.length < FAILURE_SAMPLE_LIMIT) run.summary.failures.push(failure);
  console.error(`Failed to fetch ${safeItemCode(gcode)}: ${failure.message}`);
  return { message: failure.message, at: new Date().toISOString() };
}

async function runWithTmpData(options, run) {
  run.phase = 'storage-read';
  await ensureParentDirectory(options.dataFile);
  run.phase = 'summary';
  await ensureParentDirectory(options.summaryFile);
  run.phase = 'storage-read';

  const startedAt = new Date(run.summary.startedAt);
  const store = await readStore(options.dataFile);
  const existingCount = Object.keys(store.items).length;
  run.summary.existingBeforeRun = existingCount;

  run.phase = 'list';
  console.log(`Fetching AmiAmi New Products list: ${NEW_ITEMS_URL}`);
  const html = await fetchNewItemsPage(options);

  run.phase = 'list-parse';
  const listedItems = extractNewItems(html);
  run.summary.sourceItemCount = listedItems.length;
  const limitedListedItems = listedItems.slice(0, options.maxNewItems);
  run.summary.processedSourceItemCount = limitedListedItems.length;
  run.phase = 'listing-persistence';
  const discoveredAt = startedAt.toISOString();
  const newlyDiscovered = [];
  const listingChanged = [];
  Object.assign(run.summary, { newlyDiscovered, listingChanged });

  for (const listing of limitedListedItems) {
    const currentListingHash = getListingHash(listing);
    const existing = store.items[listing.gcode];
    if (existing) {
      const previousListingHash = existing.latestListingHash || getListingHash(existing.latestListing);
      if (!existing.listingChangedAt) {
        existing.listingChangedAt = existing.discoveredAt || discoveredAt;
      }
      if (previousListingHash && previousListingHash !== currentListingHash) {
        existing.listingChangedAt = discoveredAt;
        listingChanged.push(listing.gcode);
      }
      existing.lastSeenAt = discoveredAt;
      existing.latestListing = listing;
      existing.latestListingHash = currentListingHash;
      continue;
    }

    store.items[listing.gcode] = {
      gcode: listing.gcode,
      url: listing.url,
      source: 'amiami-new-products',
      sourceUrl: NEW_ITEMS_URL,
      discoveredAt,
      lastSeenAt: discoveredAt,
      listingChangedAt: discoveredAt,
      latestListing: listing,
      latestListingHash: currentListingHash,
      detailStatus: 'pending',
      detailFetchedAt: null,
      detailError: null,
      details: null,
    };
    newlyDiscovered.push(listing.gcode);
  }

  const detailQueue = buildDetailQueue(store, newlyDiscovered, listingChanged, options);
  const detailResults = run.summary.detailResults;
  detailResults.skipped = options.skipDetails ? detailQueue.length : 0;

  if (!options.skipDetails) {
    const limitedQueue = detailQueue.slice(0, options.maxDetailItems);
    for (let i = 0; i < limitedQueue.length; i += 1) {
      const gcode = limitedQueue[i];
      if (i > 0 && options.detailDelayMs > 0) {
        console.log(`Waiting ${options.detailDelayMs}ms before next detail request...`);
        await sleep(options.detailDelayMs);
      }

      detailResults.attempted += 1;
      run.itemCode = gcode;
      run.phase = 'detail';
      const record = store.items[gcode];
      let detail;
      let detailError;
      try {
        console.log(`Fetching detail ${i + 1}/${limitedQueue.length}: ${safeItemCode(gcode)}`);
        detail = await fetchItemDetail(gcode, options);
      } catch (error) {
        detailError = recordDetailFailure(error, gcode, run);
      }
      if (detailError) {
        record.detailStatus = 'error';
        record.detailError = detailError;
      } else {
        run.phase = 'detail-normalize';
        record.details = normalizeDetail(detail, options);
        record.detailStatus = 'fetched';
        record.detailFetchedAt = new Date().toISOString();
        record.detailError = null;
      }
      run.phase = 'detail-persistence';
      await writeStore(options.dataFile, store);
      if (!detailError) detailResults.fetched += 1;
    }
  }

  run.itemCode = null;
  run.phase = 'listing-persistence';
  store.lastRunAt = new Date().toISOString();
  store.lastSourceItemCount = listedItems.length;
  await writeStore(options.dataFile, store);

  Object.assign(run.summary, {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    sourceUrl: NEW_ITEMS_URL,
    sourceItemCount: listedItems.length,
    processedSourceItemCount: limitedListedItems.length,
    existingBeforeRun: existingCount,
    existingAfterRun: Object.keys(store.items).length,
    newlyDiscoveredCount: newlyDiscovered.length,
    newlyDiscovered,
    listingChangedCount: listingChanged.length,
    listingChanged,
    pendingDetailCount: countPendingDetails(store),
    detailResults,
    dataFile: options.dataFile,
    storage: 'tmp',
  });

  console.log(`Saved ${Object.keys(store.items).length} AmiAmi items to ${options.dataFile}`);
}

async function runWithDatabase(options, run) {
  run.phase = 'summary';
  await ensureParentDirectory(options.summaryFile);

  const startedAt = new Date(run.summary.startedAt);
  run.phase = 'storage-connect';
  run.needsDisconnect = true;
  await connectMongo(options);

  run.phase = 'storage-read';
  const existingCount = await AmiAmiItem.countDocuments();
  run.summary.existingBeforeRun = existingCount;

  run.phase = 'list';
  console.log(`Fetching AmiAmi New Products list: ${NEW_ITEMS_URL}`);
  const html = await fetchNewItemsPage(options);

  run.phase = 'list-parse';
  const listedItems = extractNewItems(html);
  run.summary.sourceItemCount = listedItems.length;
  const limitedListedItems = listedItems.slice(0, options.maxNewItems);
  run.summary.processedSourceItemCount = limitedListedItems.length;
  run.phase = 'listing-persistence';
  const seenAt = startedAt;
  const { newlyDiscovered, listingChanged, unchangedSkipped } = await upsertMongoListings(limitedListedItems, seenAt);
  Object.assign(run.summary, { newlyDiscovered, listingChanged, unchangedSkippedCount: unchangedSkipped });
  run.phase = 'storage-read';
  const detailQueue = await buildMongoDetailQueue(newlyDiscovered, listingChanged, options);
  const detailResults = run.summary.detailResults;
  detailResults.skipped = options.skipDetails ? detailQueue.length : 0;

  if (!options.skipDetails) {
    const limitedQueue = detailQueue.slice(0, options.maxDetailItems);
    for (let i = 0; i < limitedQueue.length; i += 1) {
      const gcode = limitedQueue[i];
      if (i > 0 && options.detailDelayMs > 0) {
        console.log(`Waiting ${options.detailDelayMs}ms before next detail request...`);
        await sleep(options.detailDelayMs);
      }

      detailResults.attempted += 1;
      run.itemCode = gcode;
      run.phase = 'detail';
      let detail;
      let detailError;
      try {
        console.log(`Fetching detail ${i + 1}/${limitedQueue.length}: ${safeItemCode(gcode)}`);
        detail = await fetchItemDetail(gcode, options);
      } catch (error) {
        detailError = recordDetailFailure(error, gcode, run);
      }
      run.phase = 'detail-normalize';
      const update = detailError ? {
        detailStatus: 'error', detailError,
      } : {
        detailStatus: 'fetched', detailFetchedAt: new Date(),
        detailError: { message: null, at: null }, details: normalizeDetail(detail, options),
      };
      // A failed database write must not become a fetch failure or trigger
      // another database write claiming the upstream item failed.
      run.phase = 'detail-persistence';
      await AmiAmiItem.updateOne({ gcode }, { $set: update });
      if (!detailError) detailResults.fetched += 1;
    }
  }

  run.itemCode = null;
  run.phase = 'storage-read';
  const pendingDetailCount = await countMongoPendingDetails();
  const existingAfterRun = await AmiAmiItem.countDocuments();
  Object.assign(run.summary, {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    sourceUrl: NEW_ITEMS_URL,
    sourceItemCount: listedItems.length,
    processedSourceItemCount: limitedListedItems.length,
    existingBeforeRun: existingCount,
    existingAfterRun,
    newlyDiscoveredCount: newlyDiscovered.length,
    newlyDiscovered,
    listingChangedCount: listingChanged.length,
    listingChanged,
    unchangedSkippedCount: unchangedSkipped,
    pendingDetailCount,
    detailResults,
    collection: AmiAmiItem.collection.name,
    storage: 'db',
  });

  console.log(`Saved AmiAmi items to MongoDB collection: ${AmiAmiItem.collection.name}`);
}

function buildDetailQueue(store, newlyDiscovered, listingChanged, options) {
  if (options.forceRefreshDetails) {
    return Object.keys(store.items).sort();
  }

  const priorityGcodes = uniqueStrings([...newlyDiscovered, ...listingChanged]);
  const olderPending = Object.values(store.items)
    .filter((item) => !priorityGcodes.includes(item.gcode))
    .filter((item) => !item.details || item.detailStatus === 'error')
    .sort((a, b) => String(a.discoveredAt).localeCompare(String(b.discoveredAt)))
    .map((item) => item.gcode);

  return [...priorityGcodes, ...olderPending];
}

async function connectMongo(options) {
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
  const mongoUri = options.mongoUri || process.env.MONGOOSE_URL;
  if (!mongoUri) {
    throw new Error('Missing MongoDB URI. Set MONGOOSE_URL or pass --mongo-uri=...');
  }
  await mongoose.connect(mongoUri);
}

async function upsertMongoListings(listings, seenAt) {
  if (listings.length === 0) {
    return { newlyDiscovered: [], listingChanged: [], unchangedSkipped: 0 };
  }

  const gcodes = listings.map((listing) => listing.gcode);
  const existing = await AmiAmiItem.find({ gcode: { $in: gcodes } }).select('gcode listingHash').lean();
  const existingByGcode = new Map(existing.map((item) => [item.gcode, item]));
  const existingGcodes = new Set(existingByGcode.keys());
  const newlyDiscovered = gcodes.filter((gcode) => !existingGcodes.has(gcode));
  const listingChanged = [];
  const operations = listings.map((listing) => {
    const currentListingHash = getListingHash(listing);
    const existingItem = existingByGcode.get(listing.gcode);
    const hasStoredListingHash = Boolean(existingItem && existingItem.listingHash);
    const didListingChange = Boolean(
      existingItem &&
      hasStoredListingHash &&
      existingItem.listingHash !== currentListingHash,
    );
    const needsListingHashBackfill = Boolean(existingItem && !hasStoredListingHash);

    if (didListingChange) {
      listingChanged.push(listing.gcode);
    }

    if (!existingItem) {
      return {
        updateOne: {
          filter: { gcode: listing.gcode },
          update: {
            $set: {
              url: listing.url,
              source: 'amiami-new-products',
              sourceUrl: NEW_ITEMS_URL,
              lastSeenAt: seenAt,
              listing,
              listingHash: currentListingHash,
            },
            $setOnInsert: {
              gcode: listing.gcode,
              firstSeenAt: seenAt,
              listingChangedAt: seenAt,
              detailStatus: 'pending',
              detailFetchedAt: null,
              detailError: { message: null, at: null },
              details: null,
            },
          },
          upsert: true,
        },
      };
    }

    if (!didListingChange && !needsListingHashBackfill) {
      return null;
    }

    const updateSet = {
      url: listing.url,
      source: 'amiami-new-products',
      sourceUrl: NEW_ITEMS_URL,
      lastSeenAt: seenAt,
      listing,
      listingHash: currentListingHash,
    };

    if (didListingChange) {
      updateSet.listingChangedAt = seenAt;
    }

    return {
      updateOne: {
        filter: { gcode: listing.gcode },
        update: {
          $set: updateSet,
        },
      },
    };
  }).filter(Boolean);

  if (operations.length > 0) {
    await AmiAmiItem.bulkWrite(operations, { ordered: false });
  }

  return {
    newlyDiscovered,
    listingChanged,
    unchangedSkipped: listings.length - operations.length,
  };
}

function getListingHash(listing) {
  const stableListing = {
    itemName: listing && listing.itemName,
    brand: listing && listing.brand,
    priceText: listing && listing.priceText,
    imageUrl: listing && listing.imageUrl,
    tags: listing && listing.tags,
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableListing))
    .digest('hex');
}

async function buildMongoDetailQueue(newlyDiscovered, listingChanged, options) {
  if (options.forceRefreshDetails) {
    const docs = await AmiAmiItem.find({}).select('gcode').sort({ gcode: 1 }).lean();
    return docs.map((item) => item.gcode);
  }

  const priorityGcodes = uniqueStrings([...newlyDiscovered, ...listingChanged]);
  const olderPending = await AmiAmiItem.find({
    gcode: { $nin: priorityGcodes },
    $or: [
      { details: null },
      { detailStatus: 'error' },
    ],
  }).select('gcode').sort({ firstSeenAt: 1, gcode: 1 }).lean();

  return [...priorityGcodes, ...olderPending.map((item) => item.gcode)];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

async function countMongoPendingDetails() {
  return AmiAmiItem.countDocuments({
    $or: [
      { details: null },
      { detailStatus: 'error' },
    ],
  });
}

function extractNewItems(html) {
  const items = [];
  const seen = new Set();
  const itemPattern = /<a\s+href="\/eng\/detail\?gcode=([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

  for (const match of html.matchAll(itemPattern)) {
    const gcode = decodeHtml(match[1]).trim();
    if (!gcode || seen.has(gcode)) {
      continue;
    }

    const body = match[2];
    seen.add(gcode);
    items.push({
      gcode,
      url: `${AMIAMI_SITE_URL}/eng/detail?gcode=${encodeURIComponent(gcode)}`,
      itemName: extractClassText(body, 'newly-added-items__item__name'),
      brand: extractClassText(body, 'newly-added-items__item__brand'),
      priceText: normalizeWhitespace(extractClassText(body, 'newly-added-items__item__price')),
      imageUrl: extractImageUrl(body),
      tags: extractTagText(body),
    });
  }

  return items;
}

function extractClassText(html, className) {
  const pattern = new RegExp(`<p[^>]+class="[^"]*${escapeRegExp(className)}[^"]*"[^>]*>([\\s\\S]*?)<\\/p>`);
  const match = html.match(pattern);
  if (!match) {
    return null;
  }
  return normalizeWhitespace(stripTags(decodeHtml(match[1])));
}

function extractImageUrl(html) {
  const match = html.match(/\sdata-src="([^"]+)"/) || html.match(/\ssrc="([^"]+)"/);
  if (!match) {
    return null;
  }
  return absoluteImageUrl(decodeHtml(match[1]));
}

function extractTagText(html) {
  const tags = [];
  const tagPattern = /<li[^>]+class="[^"]*newly-added-items__item__tag-list[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  for (const match of html.matchAll(tagPattern)) {
    const tag = normalizeWhitespace(stripTags(decodeHtml(match[1])));
    if (tag) {
      tags.push(tag);
    }
  }
  return tags;
}

function absoluteImageUrl(value) {
  if (!value) {
    return null;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith('/')) {
    return `${AMIAMI_IMAGE_URL}${value}`;
  }
  return `${AMIAMI_IMAGE_URL}/${value}`;
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, ' ');
}

function normalizeWhitespace(value) {
  if (!value) {
    return null;
  }
  return String(value).replace(/\s+/g, ' ').trim() || null;
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countPendingDetails(store) {
  return Object.values(store.items).filter((item) => !item.details || item.detailStatus === 'error').length;
}

async function readStore(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(text);
    return {
      schemaVersion: parsed.schemaVersion || 1,
      lastRunAt: parsed.lastRunAt || null,
      lastSourceItemCount: parsed.lastSourceItemCount || 0,
      items: parsed.items || {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return {
      schemaVersion: 1,
      lastRunAt: null,
      lastSourceItemCount: 0,
      items: {},
    };
  }
}

async function writeStore(filePath, store) {
  await writeJson(filePath, sortStore(store));
}

function sortStore(store) {
  const sortedItems = {};
  for (const key of Object.keys(store.items).sort()) {
    sortedItems[key] = store.items[key];
  }
  return {
    ...store,
    items: sortedItems,
  };
}

async function writeJson(filePath, value) {
  const tempFile = `${filePath}.tmp`;
  await fs.writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempFile, filePath);
}

async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Importing the CLI for isolated tests must not install, connect or scrape.
if (require.main === module) {
  main().catch(() => {
    console.error('AmiAmi scraper failed while reporting the run. Check storage and logging configuration.');
    process.exitCode = 1;
  });
}

module.exports = { main, extractNewItems, parseArgs };
