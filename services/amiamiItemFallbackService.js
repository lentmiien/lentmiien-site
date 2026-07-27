const crypto = require('crypto');
const { AmiAmiItem } = require('../database');
const logger = require('../utils/logger');
const {
  buildItemUrl,
  fetchItemDetail,
  normalizeDetail,
} = require('./amiamiScraperService');

const DEFAULT_MAX_SCRAPES_PER_WINDOW = 20;
const DEFAULT_SCRAPE_WINDOW_MS = 60 * 1000;
const FALLBACK_SOURCE = 'amiami-api-lookup';

function createAmiAmiItemFallbackService({
  itemModel,
  fetchDetail,
  normalize,
  serviceLogger,
  now = Date.now,
  maxScrapesPerWindow = DEFAULT_MAX_SCRAPES_PER_WINDOW,
  scrapeWindowMs = DEFAULT_SCRAPE_WINDOW_MS,
}) {
  const scrapeTimestamps = [];
  const inFlightByGcode = new Map();

  function acquireScrapeSlot(nowMs) {
    const cutoff = nowMs - scrapeWindowMs;
    while (scrapeTimestamps.length > 0 && scrapeTimestamps[0] <= cutoff) {
      scrapeTimestamps.shift();
    }

    if (scrapeTimestamps.length >= maxScrapesPerWindow) {
      return false;
    }

    scrapeTimestamps.push(nowMs);
    return true;
  }

  async function findExisting(gcode) {
    return execLean(itemModel.findOne({ gcode }));
  }

  async function persistIfMissing(record) {
    try {
      return await execLean(itemModel.findOneAndUpdate(
        { gcode: record.gcode },
        { $setOnInsert: record },
        {
          new: true,
          setDefaultsOnInsert: true,
          upsert: true,
        },
      ));
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const existing = await findExisting(record.gcode);
      if (existing) {
        return existing;
      }
      throw error;
    }
  }

  async function scrapeAndPersist(gcode) {
    const existing = await findExisting(gcode);
    if (existing) {
      return {
        status: 'existing',
        item: existing,
      };
    }

    const scrapeStartedAtMs = now();
    if (!acquireScrapeSlot(scrapeStartedAtMs)) {
      return {
        status: 'rate-limited',
        item: null,
      };
    }

    let details;
    try {
      const apiData = await fetchDetail(gcode, {
        detailRetries: 0,
        retryDelayMs: 0,
      });
      details = normalize(apiData, { includeRaw: false });
    } catch (error) {
      const failedAt = new Date(now());
      const failedItem = await persistIfMissing(buildFailedRecord(gcode, error, failedAt));
      serviceLogger.warning('AmiAmi API fallback scrape failed', {
        category: 'amiami-items-api',
        metadata: { gcode, error },
      });
      return {
        status: 'failed',
        item: failedItem,
      };
    }

    const fetchedAt = new Date(now());
    const fetchedItem = await persistIfMissing(buildFetchedRecord(gcode, details, fetchedAt));
    return {
      status: 'fetched',
      item: fetchedItem,
    };
  }

  function attemptMissingItemScrape(gcode) {
    const inFlight = inFlightByGcode.get(gcode);
    if (inFlight) {
      return inFlight;
    }

    let sharedOperation;
    sharedOperation = scrapeAndPersist(gcode)
      .finally(() => {
        if (inFlightByGcode.get(gcode) === sharedOperation) {
          inFlightByGcode.delete(gcode);
        }
      });
    inFlightByGcode.set(gcode, sharedOperation);
    return sharedOperation;
  }

  return {
    attemptMissingItemScrape,
  };
}

function buildFetchedRecord(gcode, details, fetchedAt) {
  const listing = buildListing(gcode, details);
  const itemUrl = buildItemUrl(gcode);

  return {
    gcode,
    url: itemUrl,
    source: FALLBACK_SOURCE,
    sourceUrl: itemUrl,
    firstSeenAt: fetchedAt,
    lastSeenAt: fetchedAt,
    listingChangedAt: fetchedAt,
    listingHash: getListingHash(listing),
    listing,
    detailStatus: 'fetched',
    detailFetchedAt: fetchedAt,
    detailError: {
      message: null,
      at: null,
    },
    details,
  };
}

function buildFailedRecord(gcode, error, failedAt) {
  const listing = buildListing(gcode, null);
  const itemUrl = buildItemUrl(gcode);

  return {
    gcode,
    url: itemUrl,
    source: FALLBACK_SOURCE,
    sourceUrl: itemUrl,
    firstSeenAt: failedAt,
    lastSeenAt: failedAt,
    listingChangedAt: failedAt,
    listingHash: getListingHash(listing),
    listing,
    detailStatus: 'error',
    detailFetchedAt: null,
    detailError: {
      message: error && error.message ? error.message : String(error),
      at: failedAt,
    },
    details: null,
  };
}

function buildListing(gcode, details) {
  const itemUrl = buildItemUrl(gcode);
  return {
    gcode,
    url: itemUrl,
    itemName: details && details.itemName ? details.itemName : null,
    brand: details && details.brand ? details.brand : null,
    priceText: null,
    imageUrl: details && Array.isArray(details.imageLinks)
      ? details.imageLinks[0] || null
      : null,
    tags: [],
  };
}

function getListingHash(listing) {
  const stableListing = {
    itemName: listing.itemName,
    brand: listing.brand,
    priceText: listing.priceText,
    imageUrl: listing.imageUrl,
    tags: listing.tags,
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableListing))
    .digest('hex');
}

async function execLean(query) {
  const leanQuery = query && typeof query.lean === 'function'
    ? query.lean()
    : query;
  return leanQuery && typeof leanQuery.exec === 'function'
    ? leanQuery.exec()
    : leanQuery;
}

function isDuplicateKeyError(error) {
  return error && (error.code === 11000 || error.code === 11001);
}

const defaultService = createAmiAmiItemFallbackService({
  itemModel: AmiAmiItem,
  fetchDetail: fetchItemDetail,
  normalize: normalizeDetail,
  serviceLogger: logger,
});

module.exports = {
  attemptMissingItemScrape: defaultService.attemptMissingItemScrape,
  createAmiAmiItemFallbackService,
};
