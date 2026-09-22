const { AmiAmiRequestError, safeHeaders } = require('../utils/amiamiDiagnostics');

const AMIAMI_SITE_URL = 'https://www.amiami.com';
const AMIAMI_IMAGE_URL = 'https://img.amiami.com';
const AMIAMI_API_URL = 'https://api.amiami.com';
const AMIAMI_NEW_ITEMS_URL = `${AMIAMI_SITE_URL}/files/eng/new_items/newitem.html`;
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

async function fetchNewItemsPage(requestOptions = {}) {
  const options = { ...DEFAULT_DETAIL_OPTIONS, ...requestOptions };
  return requestWithDiagnostics({ phase: 'list', target: AMIAMI_NEW_ITEMS_URL }, options, async (context) => {
    const response = await curlGet(context.target, {
      impersonate: options.impersonate,
      headers: buildHeaders({ referer: `${AMIAMI_SITE_URL}/eng/c/new/`, accept: 'text/html,*/*' }),
      timeout: options.requestTimeoutMs,
    }, context);
    assertOkResponse(response, context);
    const text = responseText(response);
    // Accept recognizable empty listings, but never turn an error/challenge page
    // or an unrelated document into a successful zero-item run.
    const title = text.slice(0, 65536).match(/<(?:title|h1)\b[^>]*>([^<]*)/i)?.[1] || '';
    if (/access denied|forbidden|not found|unavailable|\berror\b/i.test(title)
      || !/newly-added-items|new products|new items|\/eng\/detail\?gcode=/i.test(text)) {
      throw responseError('unexpected_html', response, context);
    }
    return text;
  });
}

async function fetchItemDetail(gcode, requestOptions = {}) {
  const options = { ...DEFAULT_DETAIL_OPTIONS, ...requestOptions };
  return requestWithDiagnostics({
    phase: 'detail', target: `${AMIAMI_API_URL}/api/v1.0/item`, itemCode: gcode,
  }, options, async (context) => {
    const response = await curlGet(context.target, {
      impersonate: options.impersonate,
      params: { gcode, lang: 'eng' },
      headers: buildHeaders({
        referer: buildItemUrl(gcode), accept: 'application/json,text/plain,*/*',
        extra: { 'X-User-Key': API_USER_KEY },
      }),
      timeout: options.requestTimeoutMs,
    }, context);
    assertOkResponse(response, context);
    let data = response.data;
    if (!data || typeof data !== 'object') {
      try {
        data = JSON.parse(responseText(response));
      } catch (cause) {
        throw responseError('invalid_json', response, context, { retryable: true, cause });
      }
    }
    if (!data || data.RSuccess !== true) {
      throw responseError('api_failure', response, context);
    }
    if (!data.item || typeof data.item !== 'object' || Array.isArray(data.item)
      || Object.keys(data.item).length === 0) {
      throw responseError('missing_item', response, context);
    }
    return data;
  });
}

async function requestWithDiagnostics(request, options, operation) {
  const context = { ...request, attempts: 0, startedAt: Date.now() };
  const retries = request.phase === 'list' ? 0 : options.detailRetries;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(context);
    } catch (cause) {
      let error = cause;
      if (!(error instanceof AmiAmiRequestError)) {
        const dependency = cause.code === 'AMIAMI_SCRAPER_UNAVAILABLE';
        const timeout = cause.code === 28 || ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(cause.code)
          || /timed?\s*out|timeout/i.test(String(cause.message));
        error = new AmiAmiRequestError(dependency ? 'dependency' : timeout ? 'timeout' : 'transport', context, {
          cause, retryable: !dependency,
        });
      }
      error.setTiming(context);
      if (!error.retryable || attempt >= retries) throw error;
      // The CLI reports the final outcome once through the shared logger.
      // Avoid repeated logs (and raw transport messages) on every attempt.
      if (options.retryDelayMs > 0) await sleep(options.retryDelayMs);
    }
  }
}

async function curlGet(url, requestOptions, context) {
  const CurlRequest = loadCurlRequest();
  const client = new CurlRequest({ keepAlive: false }, { maxSize: 1, idleTTL: 1 });
  try {
    context.attempts += 1;
    return await client.get(url, { ...requestOptions, keepAlive: false });
  } finally {
    await client.close();
  }
}

function loadCurlRequest() {
  try {
    return require('curl-cffi').CurlRequest;
  } catch (error) {
    const dependencyError = new Error(
      'AmiAmi scraping is unavailable because curl-cffi failed to initialize. '
      + 'Run `npm run install:curl-cffi` and retry.',
    );
    dependencyError.code = 'AMIAMI_SCRAPER_UNAVAILABLE';
    dependencyError.cause = error;
    throw dependencyError;
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

function responseText(response) {
  return response.text || (typeof response.data === 'string' ? response.data : '');
}

function responseError(kind, response, context, options = {}) {
  const status = Number(response.statusCode || response.status);
  return new AmiAmiRequestError(kind, context, {
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    headers: response.headers,
    ...options,
  });
}

function assertOkResponse(response, context) {
  const status = Number(response.statusCode || response.status);
  const headers = safeHeaders(response.headers);
  const preview = responseText(response).slice(0, 65536);
  if (headers['cf-mitigated'] === 'challenge') {
    throw responseError('challenge', response, context);
  }
  if (/<title[^>]*>\s*(?:just a moment|attention required)|cf-chl-|\/cdn-cgi\/challenge-platform/i.test(preview)
    || (status === 403 && /cloudflare/i.test(preview))) {
    throw responseError('suspected_challenge', response, context);
  }
  if (!Number.isInteger(status) || status < 200 || status >= 300) {
    const kind = status === 403 ? 'forbidden' : [404, 410].includes(status) ? 'unavailable' : 'http';
    throw responseError(kind, response, context, {
      retryable: [408, 429].includes(status) || (status >= 500 && status <= 599),
    });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  AMIAMI_NEW_ITEMS_URL,
  AMIAMI_SITE_URL,
  buildItemUrl,
  fetchItemDetail,
  fetchNewItemsPage,
  normalizeDetail,
};
