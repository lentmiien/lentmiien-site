const { CurlRequest } = require('curl-cffi');

const AMIAMI_SITE_URL = 'https://www.amiami.com';
const AMIAMI_IMAGE_URL = 'https://img.amiami.com';
const AMIAMI_API_URL = 'https://api.amiami.com';
const API_USER_KEY = 'amiami_dev';

const USER_AGENT = [
  'Mozilla/5.0 (X11; Linux x86_64)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/136.0.0.0 Safari/537.36',
].join(' ');

const DEFAULT_DETAIL_OPTIONS = {
  impersonate: 'chrome136',
  requestTimeoutMs: 30000,
  detailRetries: 2,
  retryDelayMs: 5000,
  includeRaw: false,
};

function buildItemUrl(gcode) {
  return `${AMIAMI_SITE_URL}/eng/detail?gcode=${encodeURIComponent(gcode)}`;
}

async function fetchItemDetail(gcode, requestOptions = {}) {
  const options = {
    ...DEFAULT_DETAIL_OPTIONS,
    ...requestOptions,
  };
  const data = await withRetries(async () => fetchJson(`${AMIAMI_API_URL}/api/v1.0/item`, {
    options,
    params: { gcode, lang: 'eng' },
    referer: buildItemUrl(gcode),
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

function normalizeDetail(apiData, options = {}) {
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
    sourceUrl: buildItemUrl(item.gcode || ''),
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  AMIAMI_SITE_URL,
  buildItemUrl,
  fetchItemDetail,
  normalizeDetail,
};
