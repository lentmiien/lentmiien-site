const { AmiAmiItem } = require('../database');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const SORT_OPTIONS = {
  firstSeenDesc: { label: 'First seen newest', sort: { firstSeenAt: -1, gcode: 1 } },
  firstSeenAsc: { label: 'First seen oldest', sort: { firstSeenAt: 1, gcode: 1 } },
  lastSeenDesc: { label: 'Last seen newest', sort: { lastSeenAt: -1, gcode: 1 } },
  listingChangedDesc: { label: 'Listing changed newest', sort: { listingChangedAt: -1, gcode: 1 } },
  detailFetchedDesc: { label: 'Detail fetched newest', sort: { detailFetchedAt: -1, gcode: 1 } },
  priceAsc: { label: 'Price low to high', sort: { 'details.price.currentJpy': 1, gcode: 1 } },
  priceDesc: { label: 'Price high to low', sort: { 'details.price.currentJpy': -1, gcode: 1 } },
  gcodeAsc: { label: 'Gcode A-Z', sort: { gcode: 1 } },
};

function toPositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }
  return Math.min(number, max);
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildQuery(params) {
  const query = {};
  const text = normalizeText(params.q);
  const detailStatus = normalizeText(params.detailStatus);
  const brand = normalizeText(params.brand);
  const saleStatus = normalizeText(params.saleStatus);
  const tag = normalizeText(params.tag);
  const changedOnly = params.changedOnly === '1' || params.changedOnly === 'true' || params.changedOnly === 'on';
  const pendingOnly = params.pendingOnly === '1' || params.pendingOnly === 'true' || params.pendingOnly === 'on';

  if (text) {
    const regex = new RegExp(escapeRegExp(text), 'i');
    query.$or = [
      { gcode: regex },
      { 'listing.itemName': regex },
      { 'details.itemName': regex },
      { 'listing.brand': regex },
      { 'details.brand': regex },
      { 'details.seriesTitle': regex },
      { 'details.characterName': regex },
      { 'details.janCode': regex },
    ];
  }

  if (detailStatus) {
    query.detailStatus = detailStatus;
  }

  if (brand) {
    const regex = new RegExp(escapeRegExp(brand), 'i');
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        { 'listing.brand': regex },
        { 'details.brand': regex },
      ],
    });
  }

  if (saleStatus) {
    query['details.saleStatus'] = new RegExp(escapeRegExp(saleStatus), 'i');
  }

  if (tag) {
    query['listing.tags'] = new RegExp(escapeRegExp(tag), 'i');
  }

  if (changedOnly) {
    query.$expr = { $gt: ['$listingChangedAt', '$firstSeenAt'] };
  }

  if (pendingOnly) {
    query.$and = query.$and || [];
    query.$and.push({
      $or: [
        { details: null },
        { detailStatus: 'error' },
      ],
    });
  }

  return query;
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function formatPrice(value) {
  if (!Number.isFinite(value)) {
    return '';
  }
  return `${value.toLocaleString('en-US')} JPY`;
}

function compactItem(doc) {
  const details = doc.details || {};
  const listing = doc.listing || {};
  const imageLinks = Array.isArray(details.imageLinks) && details.imageLinks.length
    ? details.imageLinks
    : (listing.imageUrl ? [listing.imageUrl] : []);

  return {
    id: doc._id ? String(doc._id) : '',
    gcode: doc.gcode,
    url: doc.url,
    itemName: details.itemName || listing.itemName || doc.gcode,
    brand: details.brand || listing.brand || '',
    currentPrice: formatPrice(details.price && details.price.currentJpy),
    comparisonPrice: formatPrice(details.price && details.price.comparisonJpy),
    releaseDate: details.releaseDate || '',
    seriesTitle: details.seriesTitle || '',
    characterName: details.characterName || '',
    janCode: details.janCode || '',
    saleStatus: details.saleStatus || '',
    detailStatus: doc.detailStatus || '',
    tags: Array.isArray(listing.tags) ? listing.tags : [],
    firstSeenAt: formatDate(doc.firstSeenAt),
    lastSeenAt: formatDate(doc.lastSeenAt),
    listingChangedAt: formatDate(doc.listingChangedAt),
    detailFetchedAt: formatDate(doc.detailFetchedAt),
    imageLinks,
  };
}

function buildPageUrl(query, page) {
  const params = new URLSearchParams();
  Object.keys(query).forEach((key) => {
    const value = query[key];
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, value);
    }
  });
  params.set('page', String(page));
  return `/admin/amiami-items?${params.toString()}`;
}

exports.index = async (req, res, next) => {
  try {
    const page = toPositiveInteger(req.query.page, 1);
    const limit = toPositiveInteger(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const sortKey = SORT_OPTIONS[req.query.sort] ? req.query.sort : 'firstSeenDesc';
    const queryState = {
      q: normalizeText(req.query.q),
      detailStatus: normalizeText(req.query.detailStatus),
      brand: normalizeText(req.query.brand),
      saleStatus: normalizeText(req.query.saleStatus),
      tag: normalizeText(req.query.tag),
      changedOnly: req.query.changedOnly === '1' ? '1' : '',
      pendingOnly: req.query.pendingOnly === '1' ? '1' : '',
      sort: sortKey,
      limit: String(limit),
    };
    const mongoQuery = buildQuery(queryState);
    const totalItems = await AmiAmiItem.countDocuments(mongoQuery);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const currentPage = Math.min(page, totalPages);
    const skip = (currentPage - 1) * limit;
    const docs = await AmiAmiItem.find(mongoQuery)
      .sort(SORT_OPTIONS[sortKey].sort)
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();
    const basePageQuery = { ...queryState };

    res.render('admin_amiami_items', {
      pageTitle: 'AmiAmi Items',
      items: docs.map(compactItem),
      totalItems,
      page: currentPage,
      totalPages,
      limit,
      sortOptions: Object.entries(SORT_OPTIONS).map(([value, option]) => ({ value, label: option.label })),
      query: queryState,
      pagination: {
        previousUrl: currentPage > 1 ? buildPageUrl(basePageQuery, currentPage - 1) : null,
        nextUrl: currentPage < totalPages ? buildPageUrl(basePageQuery, currentPage + 1) : null,
        firstUrl: buildPageUrl(basePageQuery, 1),
        lastUrl: buildPageUrl(basePageQuery, totalPages),
      },
    });
  } catch (error) {
    next(error);
  }
};
