const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const OpenAI = require('openai');
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
  toArray,
  sanitizePage,
  buildPagination,
  extractPromptKeywords,
  buildPromptFilter,
  normalizeGenerationForm,
  getOutputExtension,
  getMimeTypeForFormat,
  buildStoredFileName,
  buildGalleryAggregate,
  dedupeStrings,
  fileNameFromOriginal,
} = require('../services/gptImageService');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const IMAGE_DIR = path.join(__dirname, '../public/img');
const GALLERY_PATH = '/gpt-image';

async function ensureImageDir() {
  await fsp.mkdir(IMAGE_DIR, { recursive: true });
}

function createHttpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function cleanupFiles(paths = []) {
  await Promise.all(paths.map(async (targetPath) => {
    if (!targetPath) {
      return;
    }
    try {
      await fsp.unlink(targetPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warning('Failed to remove GPT Image file during cleanup', {
          category: 'gpt_image',
          metadata: { targetPath, error: error.message },
        });
      }
    }
  }));
}

function buildImageUrl(fileName) {
  return `/img/${encodeURIComponent(fileName)}`;
}

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

async function persistUploadedInputFiles(files = [], prompt) {
  await ensureImageDir();
  const savedInputs = [];
  const savedPaths = [];

  try {
    for (const file of files) {
      const extension = fileNameFromOriginal(file.originalname, file.mimetype);
      const storedFileName = buildStoredFileName('gpt-image2-input', prompt, extension);
      const destinationPath = path.join(IMAGE_DIR, storedFileName);
      await fsp.rename(file.path, destinationPath);
      savedPaths.push(destinationPath);
      savedInputs.push({
        fileName: storedFileName,
        url: buildImageUrl(storedFileName),
        originalName: file.originalname || storedFileName,
        mimeType: file.mimetype || '',
        sizeBytes: file.size || 0,
        sourceType: 'upload',
        sourceImageId: null,
        sourceGenerationId: null,
        absolutePath: destinationPath,
      });
    }
  } catch (error) {
    await cleanupFiles(savedPaths);
    throw error;
  }

  return {
    savedInputs,
    savedPaths,
  };
}

async function loadSelectedGalleryInputs(selectedIds = []) {
  const validIds = dedupeStrings(selectedIds).filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (validIds.length === 0) {
    return [];
  }

  const docs = await GptImageGeneration.find({ _id: { $in: validIds } })
    .select({
      _id: 1,
      generationId: 1,
      outputFileName: 1,
      outputUrl: 1,
      outputMimeType: 1,
      outputSizeBytes: 1,
      prompt: 1,
    })
    .lean()
    .exec();

  if (docs.length !== validIds.length) {
    throw createHttpError('One or more selected gallery images no longer exist.', 400);
  }

  const byId = new Map(docs.map((doc) => [doc._id.toString(), doc]));
  const ordered = [];

  for (const id of validIds) {
    const doc = byId.get(id);
    const absolutePath = path.join(IMAGE_DIR, doc.outputFileName);
    try {
      await fsp.access(absolutePath, fs.constants.R_OK);
    } catch (_error) {
      throw createHttpError('A selected gallery image file is missing. Please refresh the page.', 400);
    }
    ordered.push({
      fileName: doc.outputFileName,
      url: doc.outputUrl || buildImageUrl(doc.outputFileName),
      originalName: doc.outputFileName,
      mimeType: doc.outputMimeType || 'image/png',
      sizeBytes: doc.outputSizeBytes || 0,
      sourceType: 'gallery',
      sourceImageId: doc._id,
      sourceGenerationId: doc.generationId || null,
      absolutePath,
    });
  }

  return ordered;
}

function stripAbsolutePaths(inputImages = []) {
  return inputImages.map((image) => ({
    fileName: image.fileName,
    url: image.url,
    originalName: image.originalName || '',
    mimeType: image.mimeType || '',
    sizeBytes: image.sizeBytes || 0,
    sourceType: image.sourceType,
    sourceImageId: image.sourceImageId || null,
    sourceGenerationId: image.sourceGenerationId || null,
  }));
}

async function generate(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    return jsonError(res, 500, 'OPENAI_API_KEY is not configured.');
  }

  const validation = normalizeGenerationForm(req.body || {});
  if (!validation.ok) {
    return jsonError(res, 400, validation.message);
  }

  const selectedImageIds = dedupeStrings(toArray(req.body.selectedImageIds));
  if (selectedImageIds.length > MAX_GALLERY_INPUT_SELECTIONS) {
    return jsonError(res, 400, `Please select no more than ${MAX_GALLERY_INPUT_SELECTIONS} gallery images.`);
  }

  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  const tempUploadPaths = uploadedFiles.map((file) => file.path).filter(Boolean);
  const newInputPaths = [];
  const outputPaths = [];

  try {
    const galleryInputs = await loadSelectedGalleryInputs(selectedImageIds);
    const persistedUploads = await persistUploadedInputFiles(uploadedFiles, validation.requestOptions.prompt);
    const uploadedInputs = persistedUploads.savedInputs;
    const combinedInputs = [...galleryInputs, ...uploadedInputs];
    newInputPaths.push(...persistedUploads.savedPaths);

    if (combinedInputs.length > MAX_INPUT_IMAGE_COUNT) {
      throw createHttpError(`A maximum of ${MAX_INPUT_IMAGE_COUNT} input images is supported per request.`, 400);
    }

    const generationId = randomUUID();
    const baseRequest = {
      model: MODEL_NAME,
      prompt: validation.requestOptions.prompt,
      n: validation.requestOptions.n,
      quality: validation.requestOptions.quality,
      size: validation.requestOptions.requestedSize,
      background: validation.requestOptions.background,
      output_format: validation.requestOptions.outputFormat,
      moderation: validation.requestOptions.moderation,
      user: req.user._id ? req.user._id.toString() : req.user.name,
    };

    if (validation.requestOptions.outputCompression !== null) {
      baseRequest.output_compression = validation.requestOptions.outputCompression;
    }

    let response;
    let requestType = 'generate';
    if (combinedInputs.length > 0) {
      requestType = 'edit';
      const imagePayload = combinedInputs.map((image) => fs.createReadStream(image.absolutePath));
      response = await openai.images.edit({
        ...baseRequest,
        image: imagePayload.length === 1 ? imagePayload[0] : imagePayload,
      });
    } else {
      response = await openai.images.generate(baseRequest);
    }

    const createdAt = response && response.created
      ? new Date(response.created * 1000)
      : new Date();
    const outputFormat = response && response.output_format
      ? response.output_format
      : validation.requestOptions.outputFormat;
    const outputExtension = getOutputExtension(outputFormat);
    const outputMimeType = getMimeTypeForFormat(outputFormat);
    const promptKeywords = extractPromptKeywords(validation.requestOptions.prompt);
    const storedInputImages = stripAbsolutePaths(combinedInputs);
    const data = Array.isArray(response && response.data) ? response.data : [];

    if (data.length === 0) {
      throw new Error('The OpenAI image response did not contain any images.');
    }

    const docsToInsert = [];
    let outputIndex = 0;
    for (const item of data) {
      if (!item || !item.b64_json) {
        continue;
      }

      const buffer = Buffer.from(item.b64_json, 'base64');
      const storedFileName = buildStoredFileName('gpt-image2-output', validation.requestOptions.prompt, outputExtension);
      const outputPath = path.join(IMAGE_DIR, storedFileName);
      await fsp.writeFile(outputPath, buffer);
      outputPaths.push(outputPath);

      docsToInsert.push({
        generationId,
        outputIndex,
        createdBy: req.user.name,
        model: MODEL_NAME,
        requestType,
        prompt: validation.requestOptions.prompt,
        promptKeywords,
        revisedPrompt: item.revised_prompt || '',
        inputImages: storedInputImages,
        outputFileName: storedFileName,
        outputUrl: buildImageUrl(storedFileName),
        outputMimeType,
        outputSizeBytes: buffer.length,
        requestedSize: validation.requestOptions.requestedSize,
        resolvedSize: response && typeof response.size === 'string' ? response.size : validation.requestOptions.requestedSize,
        quality: response && response.quality ? response.quality : validation.requestOptions.quality,
        background: response && response.background ? response.background : validation.requestOptions.background,
        outputFormat,
        outputCompression: validation.requestOptions.outputCompression,
        moderation: validation.requestOptions.moderation,
        requestedCount: validation.requestOptions.n,
        openaiCreatedAt: createdAt,
        openaiUsage: response && response.usage ? response.usage : null,
        createdAt,
        updatedAt: createdAt,
      });
      outputIndex += 1;
    }

    if (docsToInsert.length === 0) {
      throw new Error('The OpenAI image response did not contain usable image data.');
    }

    await GptImageGeneration.insertMany(docsToInsert, { ordered: true });

    logger.notice('GPT Image generation saved', {
      category: 'gpt_image',
      metadata: {
        generationId,
        requestType,
        outputCount: docsToInsert.length,
        inputCount: storedInputImages.length,
        promptLength: validation.requestOptions.prompt.length,
        user: req.user.name,
      },
    });

    return res.json({
      ok: true,
      generationId,
      createdCount: docsToInsert.length,
      redirectUrl: `${GALLERY_PATH}?highlight=${encodeURIComponent(generationId)}`,
    });
  } catch (error) {
    await cleanupFiles(outputPaths);
    await cleanupFiles(newInputPaths);
    await cleanupFiles(tempUploadPaths);

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
