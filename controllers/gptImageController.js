const logger = require('../utils/logger');
const GptImageGeneration = require('../models/gpt_image_generation');
const { STUDIO_MODEL_NAME, MODEL_CONTRACTS, modelMetadata } = require('../services/gptImageModels');
const imageStorage = require('../services/gptImageStorageService');
const {
  PAGE_SIZE,
  MAX_INPUT_IMAGE_COUNT,
  MAX_GALLERY_INPUT_SELECTIONS,
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
    title: 'GPT Image Studio',
    gtag: false,
    gallery,
    filters,
    highlightGenerationId,
    formDefaults,
    modelInfo: {
      name: 'GPT Image',
      apiModel: STUDIO_MODEL_NAME,
      inputLimit: MAX_INPUT_IMAGE_COUNT,
      quickNote: 'Reference images are optional. Without them, the request runs as text-to-image.',
    },
    options: {
      models: Object.entries(MODEL_CONTRACTS).map(([value, contract]) => ({ value, label: contract.label })),
      qualities: MODEL_CONTRACTS[STUDIO_MODEL_NAME].qualities,
      backgrounds: MODEL_CONTRACTS[STUDIO_MODEL_NAME].backgrounds,
      outputFormats: OUTPUT_FORMAT_OPTIONS,
      moderations: MODERATION_OPTIONS,
      sizes: SIZE_PRESETS,
      counts: N_OPTIONS,
    },
    pageConfig: {
      models: MODEL_CONTRACTS,
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
    ...modelMetadata(item.model),
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
      formDefaults: { ...DEFAULT_FORM_VALUES, model: STUDIO_MODEL_NAME },
      highlightGenerationId: typeof req.query.highlight === 'string' ? req.query.highlight : '',
    }));
  } catch (error) {
    logger.error('Failed to render GPT Image page', {
      category: 'gpt_image',
      metadata: { code: error.code || 'UNKNOWN' },
    });
    return res.status(500).render('error_page', {
      message: 'Unable to load the GPT Image page right now.',
    });
  }
}

async function generate(req, res) {
  try {
    const result = await createImageGeneration({
      rawOptions: { ...(req.body || {}), model: req.body?.model ?? STUDIO_MODEL_NAME },
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
    const status = error.expose ? error.status : 502;
    return jsonError(res, status, error.expose ? error.message : 'Unable to generate an image right now.');
  }
}

async function toggleLike(req, res) {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return jsonError(res, 400, 'Invalid image ID.');
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
        code: error.code || 'UNKNOWN',
      },
    });
    return jsonError(res, 500, 'Unable to update the like right now.');
  }
}

async function serveMedia(req, res) {
  const fileName = req.params.fileName;
  if (!imageStorage.PRIVATE_NAME.test(fileName)) return res.status(404).end();
  try {
    // All authenticated users are members of this shared library, but orphan or
    // arbitrary files are not library objects. References authorize via parent.
    const url = `${imageStorage.MEDIA_PREFIX}${fileName}`;
    const record = await GptImageGeneration.exists({ $or: [
      { outputFileName: fileName, outputUrl: url },
      { inputImages: { $elemMatch: { fileName, url } } },
    ] });
    if (!record) return res.status(404).end();
    const buffer = await imageStorage.readPrivateImage(fileName);
    const extension = fileName.split('.').pop();
    res.set({
      'Content-Type': extension === 'jpg' ? 'image/jpeg' : `image/${extension}`,
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Accept-Ranges': 'none',
    });
    return res.status(200).end(buffer);
  } catch (error) {
    logger.warning('GPT Image media could not be served', { category: 'gpt_image', metadata: { code: error.code || 'UNKNOWN' } });
    return res.status(404).end();
  }
}

module.exports = {
  buildPageData,
  loadGallery,
  serveMedia,
  renderIndex,
  generate,
  toggleLike,
};
