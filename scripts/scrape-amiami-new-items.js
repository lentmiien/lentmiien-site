const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const { CurlRequest } = require('curl-cffi');
const AmiAmiItem = require('../models/amiami_item');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DATA_FILE = path.join(PROJECT_ROOT, 'tmp_data', 'amiami-new-items.json');
const DEFAULT_SUMMARY_FILE = path.join(PROJECT_ROOT, 'tmp_data', 'amiami-new-items-summary.json');

const AMIAMI_SITE_URL = 'https://www.amiami.com';
const AMIAMI_IMAGE_URL = 'https://img.amiami.com';
const AMIAMI_API_URL = 'https://api.amiami.com';
const NEW_ITEMS_URL = `${AMIAMI_SITE_URL}/files/eng/new_items/newitem.html`;
const API_USER_KEY = 'amiami_dev';

const USER_AGENT = [
  'Mozilla/5.0 (X11; Linux x86_64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/136.0.0.0 Safari/537.36',
].join(' ');

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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.storage === 'db') {
    await runWithDatabase(options);
    return;
  }

  await runWithTmpData(options);
}

async function runWithTmpData(options) {
  await ensureParentDirectory(options.dataFile);
  await ensureParentDirectory(options.summaryFile);

  const startedAt = new Date();
  const store = await readStore(options.dataFile);
  const existingCount = Object.keys(store.items).length;

  console.log(`Fetching AmiAmi New Products list: ${NEW_ITEMS_URL}`);
  const html = await fetchText(NEW_ITEMS_URL, {
    options,
    referer: `${AMIAMI_SITE_URL}/eng/c/new/`,
    accept: 'text/html,*/*',
  });

  const listedItems = extractNewItems(html);
  const limitedListedItems = listedItems.slice(0, options.maxNewItems);
  const discoveredAt = startedAt.toISOString();
  const newlyDiscovered = [];
  const listingChanged = [];

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

  const detailQueue = buildDetailQueue(store, newlyDiscovered, options);
  const detailResults = {
    attempted: 0,
    fetched: 0,
    failed: 0,
    skipped: options.skipDetails ? detailQueue.length : 0,
  };

  if (!options.skipDetails) {
    const limitedQueue = detailQueue.slice(0, options.maxDetailItems);
    for (let i = 0; i < limitedQueue.length; i += 1) {
      const gcode = limitedQueue[i];
      if (i > 0 && options.detailDelayMs > 0) {
        console.log(`Waiting ${options.detailDelayMs}ms before next detail request...`);
        await sleep(options.detailDelayMs);
      }

      detailResults.attempted += 1;
      try {
        console.log(`Fetching detail ${i + 1}/${limitedQueue.length}: ${gcode}`);
        const detail = await fetchItemDetail(gcode, options);
        const record = store.items[gcode];
        record.detailStatus = 'fetched';
        record.detailFetchedAt = new Date().toISOString();
        record.detailError = null;
        record.details = normalizeDetail(detail, options);
        detailResults.fetched += 1;
      } catch (error) {
        const record = store.items[gcode];
        record.detailStatus = 'error';
        record.detailError = {
          message: error.message,
          at: new Date().toISOString(),
        };
        detailResults.failed += 1;
        console.error(`Failed to fetch ${gcode}: ${error.message}`);
      }

      await writeStore(options.dataFile, store);
    }
  }

  store.lastRunAt = new Date().toISOString();
  store.lastSourceItemCount = listedItems.length;
  await writeStore(options.dataFile, store);

  const summary = {
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
  };
  await writeJson(options.summaryFile, summary);

  console.log(`Saved ${Object.keys(store.items).length} AmiAmi items to ${options.dataFile}`);
  console.log(`Saved run summary to ${options.summaryFile}`);
  console.log(JSON.stringify(summary, null, 2));
}

async function runWithDatabase(options) {
  await ensureParentDirectory(options.summaryFile);

  const startedAt = new Date();
  await connectMongo(options);

  try {
    const existingCount = await AmiAmiItem.countDocuments();

    console.log(`Fetching AmiAmi New Products list: ${NEW_ITEMS_URL}`);
    const html = await fetchText(NEW_ITEMS_URL, {
      options,
      referer: `${AMIAMI_SITE_URL}/eng/c/new/`,
      accept: 'text/html,*/*',
    });

    const listedItems = extractNewItems(html);
    const limitedListedItems = listedItems.slice(0, options.maxNewItems);
    const seenAt = startedAt;
    const { newlyDiscovered, listingChanged } = await upsertMongoListings(limitedListedItems, seenAt);
    const detailQueue = await buildMongoDetailQueue(newlyDiscovered, options);
    const detailResults = {
      attempted: 0,
      fetched: 0,
      failed: 0,
      skipped: options.skipDetails ? detailQueue.length : 0,
    };

    if (!options.skipDetails) {
      const limitedQueue = detailQueue.slice(0, options.maxDetailItems);
      for (let i = 0; i < limitedQueue.length; i += 1) {
        const gcode = limitedQueue[i];
        if (i > 0 && options.detailDelayMs > 0) {
          console.log(`Waiting ${options.detailDelayMs}ms before next detail request...`);
          await sleep(options.detailDelayMs);
        }

        detailResults.attempted += 1;
        try {
          console.log(`Fetching detail ${i + 1}/${limitedQueue.length}: ${gcode}`);
          const detail = await fetchItemDetail(gcode, options);
          await AmiAmiItem.updateOne(
            { gcode },
            {
              $set: {
                detailStatus: 'fetched',
                detailFetchedAt: new Date(),
                detailError: { message: null, at: null },
                details: normalizeDetail(detail, options),
              },
            },
          );
          detailResults.fetched += 1;
        } catch (error) {
          await AmiAmiItem.updateOne(
            { gcode },
            {
              $set: {
                detailStatus: 'error',
                detailError: {
                  message: error.message,
                  at: new Date(),
                },
              },
            },
          );
          detailResults.failed += 1;
          console.error(`Failed to fetch ${gcode}: ${error.message}`);
        }
      }
    }

    const pendingDetailCount = await countMongoPendingDetails();
    const existingAfterRun = await AmiAmiItem.countDocuments();
    const summary = {
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
      pendingDetailCount,
      detailResults,
      collection: AmiAmiItem.collection.name,
      storage: 'db',
    };
    await writeJson(options.summaryFile, summary);

    console.log(`Saved AmiAmi items to MongoDB collection: ${AmiAmiItem.collection.name}`);
    console.log(`Saved run summary to ${options.summaryFile}`);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

function buildDetailQueue(store, newlyDiscovered, options) {
  if (options.forceRefreshDetails) {
    return Object.keys(store.items).sort();
  }

  const newPending = newlyDiscovered.filter((gcode) => !store.items[gcode].details);
  const olderPending = Object.values(store.items)
    .filter((item) => !newPending.includes(item.gcode))
    .filter((item) => !item.details || item.detailStatus === 'error')
    .sort((a, b) => String(a.discoveredAt).localeCompare(String(b.discoveredAt)))
    .map((item) => item.gcode);

  return [...newPending, ...olderPending];
}

async function connectMongo(options) {
  dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
  const mongoUri = options.mongoUri || process.env.MONGOOSE_URL;
  if (!mongoUri) {
    throw new Error('Missing MongoDB URI. Set MONGOOSE_URL or pass --mongo-uri=...');
  }
  await mongoose.connect(mongoUri);
}

async function upsertMongoListings(listings, seenAt) {
  if (listings.length === 0) {
    return { newlyDiscovered: [], listingChanged: [] };
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
    const didListingChange = Boolean(
      existingItem &&
      existingItem.listingHash &&
      existingItem.listingHash !== currentListingHash,
    );

    if (didListingChange) {
      listingChanged.push(listing.gcode);
    }

    const update = {
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
    };

    if (didListingChange) {
      update.$set.listingChangedAt = seenAt;
    }

    return {
      updateOne: {
        filter: { gcode: listing.gcode },
        update,
        upsert: true,
      },
    };
  });

  await AmiAmiItem.bulkWrite(operations, { ordered: false });
  return { newlyDiscovered, listingChanged };
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

async function buildMongoDetailQueue(newlyDiscovered, options) {
  if (options.forceRefreshDetails) {
    const docs = await AmiAmiItem.find({}).select('gcode').sort({ gcode: 1 }).lean();
    return docs.map((item) => item.gcode);
  }

  const newPending = newlyDiscovered;
  const olderPending = await AmiAmiItem.find({
    gcode: { $nin: newPending },
    $or: [
      { details: null },
      { detailStatus: 'error' },
    ],
  }).select('gcode').sort({ firstSeenAt: 1, gcode: 1 }).lean();

  return [...newPending, ...olderPending.map((item) => item.gcode)];
}

async function countMongoPendingDetails() {
  return AmiAmiItem.countDocuments({
    $or: [
      { details: null },
      { detailStatus: 'error' },
    ],
  });
}

async function fetchItemDetail(gcode, options) {
  const data = await withRetries(async () => fetchJson(`${AMIAMI_API_URL}/api/v1.0/item`, {
    options,
    params: { gcode, lang: 'eng' },
    referer: `${AMIAMI_SITE_URL}/eng/detail?gcode=${encodeURIComponent(gcode)}`,
  }), {
    retries: options.detailRetries,
    retryDelayMs: options.retryDelayMs,
    label: gcode,
  });

  if (!data || data.RSuccess !== true || !data.item) {
    throw new Error(`AmiAmi item API did not return a product for ${gcode}`);
  }

  return data;
}

async function fetchText(url, { options, referer, accept }) {
  const response = await curlGet(url, {
    impersonate: options.impersonate,
    headers: buildHeaders({ referer, accept }),
    timeout: options.requestTimeoutMs,
  });

  assertOkResponse(response, url);
  return response.text || String(response.data || '');
}

async function fetchJson(url, { options, params, referer }) {
  const response = await curlGet(url, {
    impersonate: options.impersonate,
    params,
    headers: buildHeaders({
      referer,
      accept: 'application/json,text/plain,*/*',
      extra: { 'X-User-Key': API_USER_KEY },
    }),
    timeout: options.requestTimeoutMs,
  });

  assertOkResponse(response, url);

  if (response.data && typeof response.data === 'object') {
    return response.data;
  }

  const text = response.text || String(response.data || '');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 120)}`);
  }
}

async function curlGet(url, requestOptions) {
  const client = new CurlRequest({ keepAlive: false }, { maxSize: 1, idleTTL: 1 });
  try {
    return await client.get(url, {
      ...requestOptions,
      keepAlive: false,
    });
  } finally {
    client.close();
  }
}

function buildHeaders({ referer, accept, extra = {} }) {
  return {
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: referer,
    'User-Agent': USER_AGENT,
    ...extra,
  };
}

function assertOkResponse(response, url) {
  const status = response.statusCode || response.status;
  if (status < 200 || status >= 300) {
    const text = response.text || String(response.data || '');
    throw new Error(`HTTP ${status} from ${url}: ${text.slice(0, 120)}`);
  }
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

function normalizeDetail(apiData, options) {
  const item = apiData.item || {};
  const embedded = apiData._embedded || {};
  const seriesTitles = namesFromEmbedded(embedded.series_titles);
  const originalTitles = namesFromEmbedded(embedded.original_titles);
  const characterNames = namesFromEmbedded(embedded.character_names);
  const makers = namesFromEmbedded(embedded.makers);
  const reviewImages = Array.isArray(embedded.review_images) ? embedded.review_images : [];
  const bonusImages = Array.isArray(embedded.bonus_images) ? embedded.bonus_images : [];

  const normalized = {
    gcode: item.gcode || null,
    scode: item.scode || null,
    itemName: firstPresent(item.gname, item.sname_simple, item.sname),
    price: {
      currentJpy: numberOrNull(firstPresent(item.price, item.price1)),
      comparisonJpy: numberOrNull(item.c_price_taxed),
      listJpy: numberOrNull(item.list_price),
      points: numberOrNull(item.point),
    },
    releaseDate: firstPresent(item.releasedate, item.release_date),
    brand: firstPresent(item.maker_name, makers[0]),
    seriesTitle: firstPresent(seriesTitles[0], originalTitles[0]),
    seriesTitles,
    originalTitles,
    characterName: characterNames.join(', ') || null,
    characterNames,
    sculptor: firstPresent(item.modeler, extractMemoField(item.memo, 'Sculptor')),
    sculptorGroup: firstPresent(item.modelergroup),
    specifications: firstPresent(item.spec),
    details: firstPresent(item.memo, item.remarks),
    remarks: firstPresent(item.remarks),
    janCode: firstPresent(item.jancode, item.jan_code),
    copyright: firstPresent(item.copyright),
    saleStatus: firstPresent(item.salestatus),
    flags: {
      sale: item.saleitem === 1,
      preOrder: item.preorderitem === 1,
      backOrder: item.backorderitem === 1,
      preOwned: item.condition_flg === 1,
      storeBonus: item.store_bonus === 1,
      amiamiLimited: item.amiami_limited === 1,
      orderClosed: item.order_closed_flg === 1,
      soldOut: item.soldout_flg === 1,
      ageRestricted: item.agelimit === 1,
    },
    imageLinks: unique([
      absoluteImageUrl(item.main_image_url),
      absoluteImageUrl(item.thumb_url),
      ...reviewImages.flatMap((image) => [
        absoluteImageUrl(image.image_url),
        absoluteImageUrl(image.thumb_url),
      ]),
      ...bonusImages.flatMap((image) => [
        absoluteImageUrl(image.image_url),
        absoluteImageUrl(image.thumb_url),
      ]),
    ].filter(Boolean)),
    sourceUrl: `${AMIAMI_SITE_URL}/eng/detail?gcode=${encodeURIComponent(item.gcode || '')}`,
    apiFetchedAt: new Date().toISOString(),
  };

  if (options.includeRaw) {
    normalized.raw = {
      item,
      embedded,
    };
  }

  return normalized;
}

function namesFromEmbedded(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => entry && entry.name).filter(Boolean);
}

function extractMemoField(memo, label) {
  if (!memo) {
    return null;
  }
  const pattern = new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, 'im');
  const match = String(memo).match(pattern);
  return match ? match[1].trim() : null;
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

function firstPresent(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set(values)];
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

async function withRetries(operation, { retries, retryDelayMs, label }) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        break;
      }
      console.warn(`Retrying ${label} after error: ${error.message}`);
      if (retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }
  throw lastError;
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

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
