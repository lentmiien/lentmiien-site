const { BookmarkModel } = require('../database');
const logger = require('../utils/logger');

const IMPORTANCE_MIN = 1;
const IMPORTANCE_MAX = 5;
const IMPORTANCE_DEFAULT = 3;
const BOOKMARKS_PAGE_PATH = '/bookmarks';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeImportance(raw) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return IMPORTANCE_DEFAULT;
  }
  return clamp(parsed, IMPORTANCE_MIN, IMPORTANCE_MAX);
}

function parseUrl(rawUrl) {
  const value = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!value) {
    throw new Error('URL is required.');
  }

  const candidates = [value];
  if (!/^https?:\/\//i.test(value)) {
    candidates.push(`https://${value}`);
  }

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed;
      }
    } catch (error) {
      // Try next candidate.
    }
  }

  throw new Error('Please provide a valid http/https URL.');
}

function resolveTitle(rawTitle, parsedUrl) {
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (title) {
    return title;
  }
  return parsedUrl.hostname || parsedUrl.href;
}

function resolveReturnTo(rawValue, fallback = BOOKMARKS_PAGE_PATH) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value) {
    return fallback;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  return value;
}

function appendMessage(path, key, message) {
  const [pathname, hashPart = ''] = String(path).split('#');
  const [base, query = ''] = pathname.split('?');
  const params = new URLSearchParams(query);
  params.set(key, message);
  const serialized = params.toString();
  return `${base}${serialized ? `?${serialized}` : ''}${hashPart ? `#${hashPart}` : ''}`;
}

function buildSort() {
  return {
    importance: -1,
    updatedAt: -1,
    title: 1,
  };
}

exports.list = async (req, res) => {
  const userId = req.user.name;
  const bookmarks = await BookmarkModel.find({ user: userId })
    .sort(buildSort())
    .lean()
    .exec();

  res.render('bookmarks', {
    bookmarks,
    successMessage: req.query.success || null,
    errorMessage: req.query.error || null,
  });
};

exports.add = async (req, res) => {
  const userId = req.user.name;
  const returnTo = resolveReturnTo(req.body.returnTo, BOOKMARKS_PAGE_PATH);

  try {
    const parsedUrl = parseUrl(req.body.url);
    const bookmark = new BookmarkModel({
      user: userId,
      title: resolveTitle(req.body.title, parsedUrl),
      url: parsedUrl.href,
      importance: normalizeImportance(req.body.importance),
    });

    await bookmark.save();
    return res.redirect(appendMessage(returnTo, 'success', 'Bookmark saved.'));
  } catch (error) {
    logger.warning('Failed to create bookmark', {
      category: 'bookmarks',
      metadata: {
        userId,
        error: error.message,
      },
    });
    return res.redirect(appendMessage(returnTo, 'error', error.message || 'Unable to save bookmark.'));
  }
};

exports.update = async (req, res) => {
  const userId = req.user.name;
  const returnTo = resolveReturnTo(req.body.returnTo, BOOKMARKS_PAGE_PATH);
  const bookmarkId = req.params.id;

  try {
    const bookmark = await BookmarkModel.findOne({ _id: bookmarkId, user: userId });
    if (!bookmark) {
      return res.redirect(appendMessage(returnTo, 'error', 'Bookmark not found.'));
    }

    const parsedUrl = parseUrl(req.body.url);
    bookmark.title = resolveTitle(req.body.title, parsedUrl);
    bookmark.url = parsedUrl.href;
    bookmark.importance = normalizeImportance(req.body.importance);

    await bookmark.save();
    return res.redirect(appendMessage(returnTo, 'success', 'Bookmark updated.'));
  } catch (error) {
    logger.warning('Failed to update bookmark', {
      category: 'bookmarks',
      metadata: {
        userId,
        bookmarkId,
        error: error.message,
      },
    });
    return res.redirect(appendMessage(returnTo, 'error', error.message || 'Unable to update bookmark.'));
  }
};

exports.remove = async (req, res) => {
  const userId = req.user.name;
  const returnTo = resolveReturnTo(req.body.returnTo, BOOKMARKS_PAGE_PATH);
  const bookmarkId = req.params.id;

  try {
    const result = await BookmarkModel.findOneAndDelete({ _id: bookmarkId, user: userId });
    if (!result) {
      return res.redirect(appendMessage(returnTo, 'error', 'Bookmark not found.'));
    }
    return res.redirect(appendMessage(returnTo, 'success', 'Bookmark deleted.'));
  } catch (error) {
    logger.warning('Failed to delete bookmark', {
      category: 'bookmarks',
      metadata: {
        userId,
        bookmarkId,
        error: error.message,
      },
    });
    return res.redirect(appendMessage(returnTo, 'error', error.message || 'Unable to delete bookmark.'));
  }
};
