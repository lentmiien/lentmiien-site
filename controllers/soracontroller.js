const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { SoraVideo } = require('../database');
const { generateVideo, checkVideoProgress } = require('../utils/OpenAI_API');
const logger = require('../utils/logger');

const DEFAULT_PAGE_SIZE = 12;
const DEFAULT_MIN_RATING = 3;

const MODEL_OPTIONS = {
  'sora-2': {
    label: 'Sora 2',
    seconds: [4, 8, 12],
    sizes: ['720x1280', '1280x720'],
  },
  'sora-2-pro': {
    label: 'Sora 2 Pro',
    seconds: [4, 8, 12],
    sizes: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
  },
  'sora-2-2025-12-08': {
    label: 'Sora 2 (Latest)',
    seconds: [4, 8, 12],
    sizes: ['720x1280', '1280x720'],
  },
};

const RATING_DESCRIPTIONS = {
  1: 'Garbage',
  2: 'Bad',
  3: 'OK',
  4: 'Good',
  5: 'Awesome',
};

const PENDING_STATUSES = ['queued', 'in_progress'];
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const rawPollInterval = parseInt(process.env.SORA_STATUS_POLL_MS, 10);
const BACKGROUND_POLL_INTERVAL_MS = Number.isNaN(rawPollInterval) ? DEFAULT_POLL_INTERVAL_MS : Math.max(0, rawPollInterval);
const rawPollBatchSize = parseInt(process.env.SORA_STATUS_POLL_BATCH, 10);
const BACKGROUND_POLL_BATCH_SIZE = Number.isNaN(rawPollBatchSize) || rawPollBatchSize <= 0 ? 10 : rawPollBatchSize;

const TMP_DATA_DIR = path.resolve(__dirname, '..', 'tmp_data');
const PROCESSED_IMAGE_PREFIX = 'sora-input-processed';

function parseVideoSize(size) {
  if (!size) {
    return null;
  }
  const parts = String(size).toLowerCase().split('x');
  if (parts.length !== 2) {
    return null;
  }
  const width = parseInt(parts[0], 10);
  const height = parseInt(parts[1], 10);
  if (Number.isNaN(width) || Number.isNaN(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

async function resizeReferenceImage(sourcePath, size) {
  const dimensions = parseVideoSize(size);
  if (!dimensions) {
    throw new Error(`Unsupported video size: ${size}`);
  }
  await fs.promises.mkdir(TMP_DATA_DIR, { recursive: true });
  const filename = `${PROCESSED_IMAGE_PREFIX}-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
  const outputPath = path.join(TMP_DATA_DIR, filename);
  await sharp(sourcePath)
    .resize(dimensions.width, dimensions.height, { fit: 'cover' })
    .jpeg({ quality: 92 })
    .toFile(outputPath);
  return outputPath;
}

function removeFileQuietly(filepath) {
  if (!filepath) {
    return Promise.resolve();
  }
  return fs.promises.unlink(filepath).catch((error) => {
    logger.debug('Unable to remove temporary Sora image', { filepath, error });
  });
}

let backgroundPollInterval;
let pollInFlight = false;

function serializeVideo(doc) {
  const raw = doc.toObject ? doc.toObject() : doc;
  const filename = raw.filename || '';
  return {
    id: String(raw._id),
    openaiId: raw.openaiId,
    prompt: raw.prompt,
    model: raw.model,
    seconds: raw.seconds,
    size: raw.size,
    category: raw.category,
    rating: raw.rating,
    progress: raw.progress ?? 0,
    status: raw.status,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    filename,
    fileUrl: filename ? `/video/${encodeURIComponent(filename)}` : null,
    errorMessage: raw.errorMessage,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function sanitizeCategory(category) {
  if (!category) return '';
  return category.trim().slice(0, 120);
}

async function refreshVideoStatus(videoDoc) {
  const status = await checkVideoProgress(videoDoc.openaiId);
  if (!status) {
    const error = new Error('Unable to fetch video status');
    error.code = 'STATUS_UNAVAILABLE';
    throw error;
  }

  videoDoc.status = status.status || videoDoc.status;
  videoDoc.progress = typeof status.progress === 'number'
    ? Math.max(0, Math.min(status.progress, 100))
    : videoDoc.progress;

  if (status.status === 'completed' && videoDoc.filename && !videoDoc.completedAt) {
    videoDoc.completedAt = new Date();
  }

  if (status.status === 'failed') {
    videoDoc.errorMessage = status.error ? JSON.stringify(status.error) : videoDoc.errorMessage;
  }

  const needsSave = videoDoc.isModified();
  if (needsSave) {
    await videoDoc.save();
  }
  return videoDoc;
}

async function pollPendingVideosOnce() {
  if (pollInFlight) {
    return;
  }

  pollInFlight = true;
  try {
    const pendingVideos = await SoraVideo.find({ status: { $in: PENDING_STATUSES } })
      .sort({ updatedAt: 1 })
      .limit(BACKGROUND_POLL_BATCH_SIZE);

    for (const videoDoc of pendingVideos) {
      try {
        await refreshVideoStatus(videoDoc);
      } catch (error) {
        if (error && error.code === 'STATUS_UNAVAILABLE') {
          logger.debug('Background Sora status check skipped (service unavailable)', { videoId: String(videoDoc._id) });
        } else {
          logger.warning('Background Sora status check failed', { videoId: String(videoDoc._id), error });
        }
      }
    }
  } catch (error) {
    logger.error('Background Sora status polling failed', { error });
  } finally {
    pollInFlight = false;
  }
}

function startBackgroundStatusPolling() {
  if (backgroundPollInterval || BACKGROUND_POLL_INTERVAL_MS === 0) {
    return;
  }

  backgroundPollInterval = setInterval(() => {
    pollPendingVideosOnce().catch((error) => {
      logger.error('Unhandled error in Sora background poll loop', { error });
    });
  }, BACKGROUND_POLL_INTERVAL_MS);

  if (backgroundPollInterval.unref) {
    backgroundPollInterval.unref();
  }

  pollPendingVideosOnce().catch((error) => {
    logger.error('Initial Sora background poll failed', { error });
  });
}

startBackgroundStatusPolling();

exports.renderLanding = async (_req, res) => {
  try {
    const categories = await SoraVideo.distinct('category', { category: { $nin: ['', null] } });
    const categoryList = categories
      .map((c) => (typeof c === 'string' ? c.trim() : ''))
      .filter((c) => c.length > 0)
      .sort();

    const modelKeys = Object.keys(MODEL_OPTIONS);
    const primaryModel = modelKeys.length > 0 ? modelKeys[0] : '';

    const secondsOptions = Array.from(
      new Set(
        modelKeys.reduce((acc, key) => {
          const options = MODEL_OPTIONS[key]?.seconds || [];
          return acc.concat(options);
        }, []),
      ),
    ).sort((a, b) => a - b);

    const sizeOptions = Array.from(
      new Set(
        modelKeys.reduce((acc, key) => {
          const options = MODEL_OPTIONS[key]?.sizes || [];
          return acc.concat(options);
        }, []),
      ),
    );

    const ratingOptions = Object.keys(RATING_DESCRIPTIONS)
      .map((val) => parseInt(val, 10))
      .filter((val) => !Number.isNaN(val))
      .sort((a, b) => b - a);

    res.render('sora', {
      title: 'Sora 2 Studio',
      modelOptions: MODEL_OPTIONS,
      defaultPageSize: DEFAULT_PAGE_SIZE,
      ratingDescriptions: RATING_DESCRIPTIONS,
      categoryList,
      modelKeys,
      primaryModel,
      secondsOptions,
      sizeOptions,
      ratingOptions,
    });
  } catch (error) {
    logger.error('Failed to render Sora landing page', { error });
    res.status(500).render('error', { title: 'Error', message: 'Unable to load Sora Studio' });
  }
};

exports.listVideos = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE, 50));
    const search = (req.query.search || '').trim().slice(0, 200);
    const model = (req.query.model || '').trim();
    const category = sanitizeCategory(req.query.category);
    const size = (req.query.size || '').trim();
    const seconds = parseInt(req.query.seconds, 10);
    const includeLowRated = req.query.includeLowRated === 'true';
    const ratingFilter = req.query.rating ? req.query.rating.trim() : '';

    const query = {};
    const hasModelFilter = Boolean(model && MODEL_OPTIONS[model]);
    const hasSecondsFilter = !Number.isNaN(seconds);
    const hasCategoryFilter = Boolean(category);
    const hasSizeFilter = Boolean(size);
    const hasOtherFilters = Boolean(
      search ||
      hasModelFilter ||
      hasSecondsFilter ||
      hasCategoryFilter ||
      hasSizeFilter
    );

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { prompt: regex },
        { category: regex },
      ];
    }

    if (hasModelFilter) {
      query.model = model;
    }

    if (hasCategoryFilter) {
      query.category = category;
    }

    if (hasSizeFilter) {
      query.size = size;
    }

    if (hasSecondsFilter) {
      query.seconds = seconds;
    }

    if (!includeLowRated) {
      const ratingProvided = ratingFilter.length > 0;
      const parsedRating = parseInt(ratingFilter, 10);
      const hasValidRating = ratingFilter !== 'all' && !Number.isNaN(parsedRating);

      if (hasValidRating) {
        const minRating = Math.max(1, Math.min(parsedRating, 5));
        query.rating = { $gte: minRating };
      } else if (!hasOtherFilters && !ratingProvided) {
        query.rating = { $gte: DEFAULT_MIN_RATING };
      }
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      SoraVideo.find(query)
        .sort({ completedAt: -1, startedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SoraVideo.countDocuments(query),
    ]);

    res.json({
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
      items: items.map(serializeVideo),
    });
  } catch (error) {
    logger.error('Failed to list Sora videos', { error });
    res.status(500).json({ error: 'Unable to load videos' });
  }
};

exports.startGeneration = async (req, res) => {
  const cleanupTargets = [];
  try {
    const prompt = (req.body.prompt || '').trim();
    const model = (req.body.model || '').trim();
    const seconds = parseInt(req.body.seconds, 10);
    const size = (req.body.size || '').trim();
    const category = sanitizeCategory(req.body.category);

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    if (!MODEL_OPTIONS[model]) {
      return res.status(400).json({ error: 'Unsupported model selected' });
    }

    if (!MODEL_OPTIONS[model].seconds.includes(seconds)) {
      return res.status(400).json({ error: 'Invalid duration for selected model' });
    }

    if (!MODEL_OPTIONS[model].sizes.includes(size)) {
      return res.status(400).json({ error: 'Invalid size for selected model' });
    }

    if (req.fileValidationError) {
      return res.status(400).json({ error: req.fileValidationError });
    }

    let processedImagePath = null;
    if (req.file && req.file.path) {
      logger.debug('Processing Sora reference image', {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        sizeBytes: req.file.size,
        targetSize: size,
      });
      cleanupTargets.push(req.file.path);
      try {
        processedImagePath = await resizeReferenceImage(req.file.path, size);
        cleanupTargets.push(processedImagePath);
        logger.debug('Resized Sora reference image', { processedImagePath });
      } catch (error) {
        logger.error('Failed to prepare Sora reference image', { error });
        return res.status(400).json({ error: 'Unable to process reference image. Please try a different file.' });
      }
    }

    const generation = await generateVideo(
      prompt,
      model,
      seconds.toString(),
      size,
      processedImagePath,
    );
    if (!generation || !generation.id) {
      return res.status(502).json({ error: 'Video generation failed to start' });
    }

    const videoDoc = await SoraVideo.create({
      openaiId: generation.id,
      prompt,
      model,
      seconds,
      size,
      category,
      progress: generation.progress ?? 0,
      status: generation.status ?? 'queued',
      startedAt: new Date(),
    });

    res.status(202).json({ video: serializeVideo(videoDoc) });
  } catch (error) {
    logger.error('Failed to start Sora video generation', { error });
    res.status(500).json({ error: 'Unable to start generation' });
  } finally {
    await Promise.all(cleanupTargets.map((filepath) => removeFileQuietly(filepath)));
  }
};

exports.getVideoStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const videoDoc = await SoraVideo.findById(id);
    if (!videoDoc) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (videoDoc.status === 'completed' && videoDoc.filename) {
      return res.json({ video: serializeVideo(videoDoc) });
    }

    try {
      await refreshVideoStatus(videoDoc);
    } catch (error) {
      if (error && error.code === 'STATUS_UNAVAILABLE') {
        return res.status(502).json({ error: 'Unable to fetch video status' });
      }
      throw error;
    }

    res.json({ video: serializeVideo(videoDoc) });
  } catch (error) {
    logger.error('Failed to fetch Sora video status', { error });
    res.status(500).json({ error: 'Unable to fetch status' });
  }
};

exports.updateRating = async (req, res) => {
  try {
    const { id } = req.params;
    const rating = parseInt(req.body.rating, 10);

    if (Number.isNaN(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const videoDoc = await SoraVideo.findByIdAndUpdate(
      id,
      { rating, updatedAt: new Date() },
      { new: true },
    );

    if (!videoDoc) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({ video: serializeVideo(videoDoc) });
  } catch (error) {
    logger.error('Failed to update Sora video rating', { error });
    res.status(500).json({ error: 'Unable to update rating' });
  }
};

exports.listCategories = async (_req, res) => {
  try {
    const categories = await SoraVideo.distinct('category', { category: { $nin: ['', null] } });
    res.json({ categories: categories.sort() });
  } catch (error) {
    logger.error('Failed to list Sora categories', { error });
    res.status(500).json({ error: 'Unable to load categories' });
  }
};
