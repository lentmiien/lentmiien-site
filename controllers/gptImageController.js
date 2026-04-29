const logger = require('../utils/logger');
const { GptImageGeneration } = require('../database');
const {
  MODEL_NAME,
  PAGE_SIZE,
  MAX_INPUT_IMAGE_COUNT,
  MAX_GALLERY_INPUT_SELECTIONS,
  QUALITY_OPTIONS,
  BACKGROUND_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  MODERATION_OPTIONS,
  SIZE_PRESETS,
  N_OPTIONS,
  DEFAULT_FORM_VALUES,
  sanitizePage,
  buildPagination,
  buildPromptFilter,
  buildGalleryAggregate,
  createImageGeneration,
} = require('../services/gptImageService');

const GALLERY_PATH = '/gpt-image';

function jsonError(res, status, message, details) {
  return res.status(status).json({
    ok: false,
    error: message,
    details: details || null,
  });
}

function buildPageData({
  gallery,
  filters,
  formDefaults,
  highlightGenerationId,
}) {
  return {
    title: 'GPT Image 2 Studio',
    gallery,
    filters,
    highlightGenerationId,
    formDefaults,
    modelInfo: {
      name: 'GPT Image 2',
      apiModel: MODEL_NAME,
      inputLimit: MAX_INPUT_IMAGE_COUNT,
      quickNote: 'Reference images are optional. Without them, the request runs as text-to-image.',
    },
    options: {
      qualities: QUALITY_OPTIONS,
      backgrounds: BACKGROUND_OPTIONS,
      outputFormats: OUTPUT_FORMAT_OPTIONS,
      moderations: MODERATION_OPTIONS,
      sizes: SIZE_PRESETS,
      counts: N_OPTIONS,
    },
    pageConfig: {
      generateEndpoint: `${GALLERY_PATH}/api/generate`,
      likeEndpointBase: `${GALLERY_PATH}/api/images`,
      selectedInputLimit: MAX_GALLERY_INPUT_SELECTIONS,
    },
  };
}

async function getRecentGenerationIds(match) {
  const rows = await GptImageGeneration.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$generationId',
        createdAt: { $first: '$createdAt' },
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 5 },
  ]).exec();

  return rows.map((entry) => entry._id).filter(Boolean);
}

async function loadGallery({ page, keyword, username }) {
  const promptFilter = buildPromptFilter(keyword);
  const match = promptFilter.match || {};
  const totalCount = await GptImageGeneration.countDocuments(match).exec();
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE) || 1);
  const currentPage = Math.min(sanitizePage(page), totalPages);
  const skip = (currentPage - 1) * PAGE_SIZE;
  const recentGenerationIds = await getRecentGenerationIds(match);

  const items = await GptImageGeneration.aggregate(
    buildGalleryAggregate({
      match,
      username,
      recentGenerationIds,
      skip,
      limit: PAGE_SIZE,
    })
  ).exec();

  const normalizedItems = items.map((item) => ({
    id: item._id.toString(),
    generationId: item.generationId,
    outputIndex: item.outputIndex,
    prompt: item.prompt,
    revisedPrompt: item.revisedPrompt || '',
    outputUrl: item.outputUrl,
    outputFileName: item.outputFileName,
    outputMimeType: item.outputMimeType,
    requestType: item.requestType,
    quality: item.quality,
    requestedSize: item.requestedSize,
    resolvedSize: item.resolvedSize || item.requestedSize,
    background: item.background,
    outputFormat: item.outputFormat,
    moderation: item.moderation,
    likeCount: Number.isFinite(item.likeCount) ? item.likeCount : 0,
    likedByCurrentUser: Boolean(item.likedByCurrentUser),
    inputImageCount: Array.isArray(item.inputImages) ? item.inputImages.length : 0,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    isRecentGeneration: recentGenerationIds.includes(item.generationId),
  }));

  return {
    items: normalizedItems,
    totalCount,
    totalPages,
    currentPage,
    pagination: buildPagination(GALLERY_PATH, currentPage, totalPages, promptFilter.keyword),
    keyword: promptFilter.keyword,
  };
}

async function renderIndex(req, res) {
  try {
    const gallery = await loadGallery({
      page: req.query.page,
      keyword: req.query.keyword,
      username: req.user.name,
    });

    return res.render('gpt_image/index', buildPageData({
      gallery,
      filters: {
        keyword: gallery.keyword,
      },
      formDefaults: { ...DEFAULT_FORM_VALUES },
      highlightGenerationId: typeof req.query.highlight === 'string' ? req.query.highlight : '',
    }));
  } catch (error) {
    logger.error('Failed to render GPT Image page', {
      category: 'gpt_image',
      metadata: { error: error.message },
    });
    return res.status(500).render('error_page', {
      message: 'Unable to load the GPT Image 2 page right now.',
    });
  }
}

async function generate(req, res) {
  try {
    const result = await createImageGeneration({
      rawOptions: req.body || {},
      uploadedFiles: Array.isArray(req.files) ? req.files : [],
      selectedImageIds: req.body ? req.body.selectedImageIds : [],
      user: req.user,
    });

    return res.json({
      ok: true,
      generationId: result.generationId,
      createdCount: result.createdCount,
      redirectUrl: `${GALLERY_PATH}?highlight=${encodeURIComponent(result.generationId)}`,
    });
  } catch (error) {
    logger.error('GPT Image generation failed', {
      category: 'gpt_image',
      metadata: {
        error: error.message,
        user: req.user && req.user.name ? req.user.name : null,
      },
    });

    return jsonError(res, error.status || 502, error.message || 'Unable to generate an image right now.');
  }
}

async function toggleLike(req, res) {
  try {
    const image = await GptImageGeneration.findById(req.params.id).exec();
    if (!image) {
      return jsonError(res, 404, 'Image not found.');
    }

    const username = req.user.name;
    const likedByUsers = Array.isArray(image.likedByUsers) ? image.likedByUsers.slice() : [];
    const existingIndex = likedByUsers.indexOf(username);
    let liked = false;

    if (existingIndex >= 0) {
      likedByUsers.splice(existingIndex, 1);
    } else {
      likedByUsers.push(username);
      liked = true;
    }

    image.likedByUsers = likedByUsers;
    image.likeCount = likedByUsers.length;
    await image.save();

    return res.json({
      ok: true,
      liked,
      likeCount: image.likeCount,
    });
  } catch (error) {
    logger.error('Failed to toggle GPT Image like', {
      category: 'gpt_image',
      metadata: {
        id: req.params.id,
        error: error.message,
      },
    });
    return jsonError(res, 500, 'Unable to update the like right now.');
  }
}

module.exports = {
  renderIndex,
  generate,
  toggleLike,
};
