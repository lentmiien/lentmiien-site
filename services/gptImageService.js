const fsp = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const OpenAI = require('openai');
const logger = require('../utils/logger');
const GptImageGeneration = require('../models/gpt_image_generation');

const { MODEL_NAME, MODEL_CONTRACTS, modelMetadata } = require('./gptImageModels');
const imageStorage = require('./gptImageStorageService');
const PAGE_SIZE = 20;
const MAX_PROMPT_LENGTH = 32000;
const MAX_INPUT_IMAGE_COUNT = 16;
const MAX_GALLERY_INPUT_SELECTIONS = 16;
const MAX_UPLOAD_IMAGE_COUNT = 8;
const MAX_UPLOAD_FILE_SIZE_BYTES = 12 * 1024 * 1024;

const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'];
const BACKGROUND_OPTIONS = ['auto', 'opaque'];
const OUTPUT_FORMAT_OPTIONS = ['png', 'jpeg', 'webp'];
const MODERATION_OPTIONS = ['auto', 'low'];
const SIZE_MODE_OPTIONS = ['preset', 'custom', 'auto'];
const SIZE_PRESETS = [
  { value: '1024x1024', label: '1024 × 1024' },
  { value: '1536x1024', label: '1536 × 1024' },
  { value: '1024x1536', label: '1024 × 1536' },
  { value: '2048x2048', label: '2048 × 2048' },
  { value: '2048x1152', label: '2048 × 1152' },
  { value: '3840x2160', label: '3840 × 2160' },
  { value: '2160x3840', label: '2160 × 3840' },
];
const N_OPTIONS = Array.from({ length: 10 }, (_entry, index) => index + 1);
const RETRYABLE_EDIT_PARAMETERS = [
  'quality',
  'background',
  'output_format',
  'output_compression',
  'size',
  'moderation',
  'n',
];
const activeGenerations = new Set();
const MAX_ACTIVE_GENERATIONS = 2;
const TOOL_CREATED_BY = 'Tool';

let openaiClient = null;
let openaiClientKey = null;

const DEFAULT_FORM_VALUES = {
  prompt: '',
  n: 1,
  quality: 'medium',
  sizeMode: 'preset',
  sizePreset: '1024x1024',
  customWidth: 1024,
  customHeight: 1024,
  background: 'auto',
  outputFormat: 'png',
  outputCompression: 100,
  moderation: 'auto',
};

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [value];
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clampInt(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

function sanitizePage(value) {
  return clampInt(value, 1, Number.MAX_SAFE_INTEGER, 1);
}

function buildPageUrl(basePath, page, keyword) {
  const params = new URLSearchParams();
  if (page > 1) {
    params.set('page', String(page));
  }
  if (keyword) {
    params.set('keyword', keyword);
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function buildPagination(basePath, currentPage, totalPages, keyword) {
  const safeTotalPages = Math.max(1, totalPages || 1);
  const safeCurrentPage = Math.min(Math.max(1, currentPage || 1), safeTotalPages);
  const pages = [];
  const start = Math.max(1, safeCurrentPage - 2);
  const end = Math.min(safeTotalPages, safeCurrentPage + 2);

  for (let page = start; page <= end; page += 1) {
    pages.push({
      page,
      url: buildPageUrl(basePath, page, keyword),
      isCurrent: page === safeCurrentPage,
    });
  }

  return {
    currentPage: safeCurrentPage,
    totalPages: safeTotalPages,
    pages,
    prevUrl: safeCurrentPage > 1 ? buildPageUrl(basePath, safeCurrentPage - 1, keyword) : null,
    nextUrl: safeCurrentPage < safeTotalPages ? buildPageUrl(basePath, safeCurrentPage + 1, keyword) : null,
  };
}

function extractPromptKeywords(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return [];
  }

  const normalized = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);

  return Array.from(new Set(normalized));
}

function buildPromptFilter(rawKeyword) {
  const keyword = typeof rawKeyword === 'string' ? rawKeyword.trim().slice(0, 200) : '';
  if (!keyword) {
    return {
      keyword: '',
      match: {},
      terms: [],
    };
  }

  const terms = extractPromptKeywords(keyword);
  if (terms.length > 0) {
    return {
      keyword,
      match: { promptKeywords: { $all: terms } },
      terms,
    };
  }

  return {
    keyword,
    match: { prompt: { $regex: escapeRegex(keyword), $options: 'i' } },
    terms,
  };
}

function parseCustomSize(widthInput, heightInput) {
  if (![widthInput, heightInput].every(value => typeof value === 'number' || typeof value === 'string')) {
    return { ok: false, message: 'Custom dimensions must be positive integers.' };
  }
  const width = Number(widthInput);
  const height = Number(heightInput);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    return { ok: false, message: 'Custom dimensions must be positive integers.' };
  }
  if ((width % 16) !== 0 || (height % 16) !== 0) {
    return {
      ok: false,
      message: 'Custom sizes must use width and height values divisible by 16.',
    };
  }
  if (Math.max(width, height) > 3840) {
    return {
      ok: false,
      message: 'Custom sizes cannot exceed 3840px on the longest edge.',
    };
  }
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  if (!shortEdge || (longEdge / shortEdge) > 3) {
    return {
      ok: false,
      message: 'Custom sizes must stay within a 3:1 aspect ratio.',
    };
  }
  const totalPixels = width * height;
  if (totalPixels < 655360 || totalPixels > 8294400) {
    return {
      ok: false,
      message: 'Custom sizes must stay between 655,360 and 8,294,400 total pixels.',
    };
  }

  return {
    ok: true,
    size: `${width}x${height}`,
    width,
    height,
  };
}

function resolveRequestedSize(raw = {}) {
  const sizeMode = SIZE_MODE_OPTIONS.includes(raw.sizeMode) ? raw.sizeMode : DEFAULT_FORM_VALUES.sizeMode;
  const sizePreset = SIZE_PRESETS.some((option) => option.value === raw.sizePreset)
    ? raw.sizePreset
    : DEFAULT_FORM_VALUES.sizePreset;
  const customWidth = clampInt(raw.customWidth, 16, 100000, DEFAULT_FORM_VALUES.customWidth);
  const customHeight = clampInt(raw.customHeight, 16, 100000, DEFAULT_FORM_VALUES.customHeight);

  if (sizeMode === 'auto') {
    return {
      ok: true,
      sizeMode,
      sizePreset,
      customWidth,
      customHeight,
      requestedSize: 'auto',
    };
  }

  if (sizeMode === 'custom') {
    const custom = parseCustomSize(raw.customWidth, raw.customHeight);
    if (!custom.ok) {
      return {
        ok: false,
        sizeMode,
        sizePreset,
        customWidth,
        customHeight,
        message: custom.message,
      };
    }
    return {
      ok: true,
      sizeMode,
      sizePreset,
      customWidth: custom.width,
      customHeight: custom.height,
      requestedSize: custom.size,
    };
  }

  return {
    ok: true,
    sizeMode: 'preset',
    sizePreset,
    customWidth,
    customHeight,
    requestedSize: sizePreset,
  };
}

function normalizeGenerationForm(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Invalid image options.' };
  const model = raw.model === undefined ? MODEL_NAME : raw.model;
  const contract = typeof model === 'string' && Object.hasOwn(MODEL_CONTRACTS, model) ? MODEL_CONTRACTS[model] : null;
  if (!contract) return { ok: false, message: 'Unsupported image model.' };
  const allowed = ['model', 'prompt', 'n', 'quality', 'background', 'outputFormat', 'outputCompression', 'moderation', 'sizeMode', 'sizePreset', 'customWidth', 'customHeight', 'selectedImageIds', '_csrf'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) return { ok: false, message: 'Unsupported image option.' };
  const enums = { quality: contract.qualities, background: contract.backgrounds, outputFormat: OUTPUT_FORMAT_OPTIONS, moderation: MODERATION_OPTIONS, sizeMode: SIZE_MODE_OPTIONS };
  for (const [key, values] of Object.entries(enums)) {
    if (raw[key] !== undefined && !values.includes(raw[key])) return { ok: false, message: `Unsupported ${key} for ${model}.` };
  }
  for (const [key, min, max] of [['n', 1, 10], ['outputCompression', 0, 100]]) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'number' && typeof raw[key] !== 'string' || raw[key] === '' || !Number.isInteger(Number(raw[key])) || Number(raw[key]) < min || Number(raw[key]) > max)) {
      return { ok: false, message: `${key} must be an integer from ${min} to ${max}.` };
    }
  }
  if ((raw.sizeMode || 'preset') === 'preset' && raw.sizePreset !== undefined && !SIZE_PRESETS.some(option => option.value === raw.sizePreset)) return { ok: false, message: 'Unsupported preset size.' };
  if (raw.background === 'transparent' && raw.outputFormat === 'jpeg') return { ok: false, message: 'Transparent backgrounds require PNG or WebP.' };
  if (model !== MODEL_NAME && (raw.outputFormat || 'png') === 'png' && raw.outputCompression !== undefined) return { ok: false, message: 'Compression is supported only for JPEG or WebP.' };

  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  const n = raw.n === undefined ? DEFAULT_FORM_VALUES.n : Number(raw.n);
  const quality = contract.qualities.includes(raw.quality) ? raw.quality : DEFAULT_FORM_VALUES.quality;
  const background = contract.backgrounds.includes(raw.background) ? raw.background : DEFAULT_FORM_VALUES.background;
  const outputFormat = OUTPUT_FORMAT_OPTIONS.includes(raw.outputFormat) ? raw.outputFormat : DEFAULT_FORM_VALUES.outputFormat;
  const moderation = MODERATION_OPTIONS.includes(raw.moderation) ? raw.moderation : DEFAULT_FORM_VALUES.moderation;
  const size = resolveRequestedSize(raw);
  const outputCompression = outputFormat === 'png'
    ? null
    : raw.outputCompression === undefined ? DEFAULT_FORM_VALUES.outputCompression : Number(raw.outputCompression);

  const formValues = {
    model,
    prompt,
    n,
    quality,
    sizeMode: size.sizeMode || DEFAULT_FORM_VALUES.sizeMode,
    sizePreset: size.sizePreset || DEFAULT_FORM_VALUES.sizePreset,
    customWidth: size.customWidth || DEFAULT_FORM_VALUES.customWidth,
    customHeight: size.customHeight || DEFAULT_FORM_VALUES.customHeight,
    background,
    outputFormat,
    outputCompression: outputCompression === null ? DEFAULT_FORM_VALUES.outputCompression : outputCompression,
    moderation,
  };

  if (!prompt) {
    return {
      ok: false,
      message: 'A prompt is required.',
      formValues,
    };
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      message: `Prompts must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
      formValues,
    };
  }

  if (!size.ok) {
    return {
      ok: false,
      message: size.message,
      formValues,
    };
  }

  return {
    ok: true,
    formValues,
    requestOptions: {
      model,
      prompt,
      n,
      quality,
      requestedSize: size.requestedSize,
      background,
      outputFormat,
      outputCompression,
      moderation,
    },
  };
}

function getOutputExtension(format) {
  if (format === 'jpeg') {
    return '.jpg';
  }
  if (format === 'webp') {
    return '.webp';
  }
  return '.png';
}

function getMimeTypeForFormat(format) {
  if (format === 'jpeg') {
    return 'image/jpeg';
  }
  if (format === 'webp') {
    return 'image/webp';
  }
  return 'image/png';
}

function sanitizeFileStem(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'image';
}

function buildStoredFileName(prefix, prompt, extension) {
  const safePrefix = sanitizeFileStem(prefix);
  const safePrompt = sanitizeFileStem(prompt).slice(0, 24);
  return `${safePrefix}-${safePrompt}-${randomUUID()}${extension}`;
}

function buildGalleryAggregate({ match, username, recentGenerationIds, skip, limit }) {
  const safeRecentGenerationIds = Array.isArray(recentGenerationIds) ? recentGenerationIds : [];
  const safeUsername = typeof username === 'string' ? username : '';

  return [
    { $match: match },
    {
      $addFields: {
        likedByCurrentUser: safeUsername ? { $in: [safeUsername, '$likedByUsers'] } : false,
        sortBucket: {
          $switch: {
            branches: [
              {
                case: { $in: ['$generationId', safeRecentGenerationIds] },
                then: 0,
              },
              {
                case: safeUsername ? { $in: [safeUsername, '$likedByUsers'] } : false,
                then: 1,
              },
            ],
            default: 2,
          },
        },
      },
    },
    { $sort: { sortBucket: 1, createdAt: -1, generationId: -1, outputIndex: 1 } },
    { $skip: skip },
    { $limit: limit },
  ];
}

function dedupeStrings(values = []) {
  const output = [];
  values.forEach((value) => {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized && !output.includes(normalized)) {
      output.push(normalized);
    }
  });
  return output;
}

function fileNameFromOriginal(originalName, mimeType = '') {
  const providedExt = path.extname(String(originalName || '')).toLowerCase();
  if (providedExt) {
    return providedExt;
  }
  if (mimeType === 'image/jpeg') {
    return '.jpg';
  }
  if (mimeType === 'image/webp') {
    return '.webp';
  }
  return '.png';
}

function createServiceError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.expose = status < 500;
  return error;
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw createServiceError('OPENAI_API_KEY is not configured.', 500);
  }
  if (!openaiClient || openaiClientKey !== apiKey) {
    openaiClient = new OpenAI({ apiKey });
    openaiClientKey = apiKey;
  }
  return openaiClient;
}

async function ensureImageDir() {
  await imageStorage.ensureStorage();
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
          metadata: { code: error.code || 'UNKNOWN' },
        });
      }
    }
  }));
}

function buildImageUrl(fileName) {
  return `${imageStorage.MEDIA_PREFIX}${encodeURIComponent(fileName)}`;
}

async function persistUploadedInputFiles(files = []) {
  await ensureImageDir();
  const savedInputs = [];
  const savedPaths = [];

  try {
    for (const file of files) {
      const buffer = file.buffer || await fsp.readFile(file.path);
      if (buffer.length > MAX_UPLOAD_FILE_SIZE_BYTES) throw createServiceError('Reference upload is too large.', 400);
      let stored;
      try {
        stored = await imageStorage.writeImage(buffer);
      } catch (error) {
        if (error.status === 400) throw createServiceError(error.message, 400);
        throw error;
      }
      savedPaths.push(stored.absolutePath);
      savedInputs.push({
        ...stored,
        originalName: stored.fileName,
        sourceType: 'upload',
        sourceImageId: null,
        sourceGenerationId: null,
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
  const validIds = dedupeStrings(selectedIds);
  if (validIds.some(id => !/^[a-f0-9]{24}$/i.test(id))) throw createServiceError('Invalid gallery reference ID.', 400);
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
    throw createServiceError('One or more selected gallery images no longer exist.', 400);
  }

  const byId = new Map(docs.map((doc) => [doc._id.toString(), doc]));
  const ordered = [];

  for (const id of validIds) {
    const doc = byId.get(id);
    let buffer;
    try {
      buffer = await imageStorage.readLibraryImage({ fileName: doc.outputFileName, url: doc.outputUrl });
      await imageStorage.validateRaster(buffer);
    } catch (error) {
      logger.warning('GPT Image library reference is unavailable or invalid', { category: 'gpt_image', metadata: { code: error.code || 'INVALID_IMAGE' } });
      throw createServiceError('A selected gallery image is unavailable. Please refresh the page.', 400);
    }
    ordered.push({
      fileName: doc.outputFileName,
      url: doc.outputUrl,
      originalName: doc.outputFileName,
      mimeType: doc.outputMimeType || 'image/png',
      sizeBytes: doc.outputSizeBytes || 0,
      sourceType: 'gallery',
      sourceImageId: doc._id,
      sourceGenerationId: doc.generationId || null,
      buffer,
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

async function buildOpenAIEditImages(inputImages = []) {
  const uploadables = [];

  for (const image of inputImages) {
    const fileBuffer = image.buffer || await imageStorage.readLibraryImage(image);
    const fileOptions = image.mimeType ? { type: image.mimeType } : undefined;
    uploadables.push(await OpenAI.toFile(
      fileBuffer,
      image.fileName || image.originalName || 'input-image.png',
      fileOptions
    ));
  }

  return uploadables;
}

async function executeCompatibleEditRequest(baseRequest, inputImages) {
  const openai = getOpenAIClient();
  const { response, removedParameters } = await executeWithUnknownParameterRetry(
    baseRequest,
    async (request) => {
      const uploadables = await buildOpenAIEditImages(inputImages);
      return openai.images.edit({
        ...request,
        image: uploadables.length === 1 ? uploadables[0] : uploadables,
      });
    },
    baseRequest.model === MODEL_NAME ? RETRYABLE_EDIT_PARAMETERS : []
  );

  if (removedParameters.length > 0) {
    logger.warning('GPT Image edit retried without unsupported parameters', {
      category: 'gpt_image',
      metadata: {
        removedParameters,
        model: baseRequest.model,
      },
    });
  }

  return response;
}

function resolveCreatedBy(user, fallback = TOOL_CREATED_BY) {
  if (user && typeof user.name === 'string' && user.name.trim().length > 0) {
    return user.name.trim();
  }
  if (user && user._id) {
    return user._id.toString();
  }
  return fallback;
}

function resolveOpenAIUser(user, fallback = 'tool') {
  if (user && user._id) {
    return user._id.toString();
  }
  if (user && typeof user.name === 'string' && user.name.trim().length > 0) {
    return user.name.trim();
  }
  return fallback;
}

function normalizeToolImageArguments(args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw createServiceError('Invalid tool image options.', 400);
  const allowed = ['prompt', 'n', 'quality', 'background', 'output_format', 'outputFormat', 'output_compression', 'outputCompression', 'moderation', 'size', 'requestedSize', 'sizePreset', 'selected_image_ids', 'selectedImageIds'];
  if (Object.keys(args).some(key => !allowed.includes(key))) throw createServiceError('Unsupported tool image option.', 400);

  const rawSize = args.size ?? args.requestedSize ?? args.sizePreset ?? DEFAULT_FORM_VALUES.sizePreset;
  const rawOptions = {
    prompt: args.prompt,
    n: args.n,
    quality: args.quality,
    background: args.background,
    outputFormat: args.output_format || args.outputFormat,
    outputCompression: args.output_compression ?? args.outputCompression,
    moderation: args.moderation,
  };

  if (rawSize === 'auto') {
    rawOptions.sizeMode = 'auto';
  } else if (SIZE_PRESETS.some((option) => option.value === rawSize)) {
    rawOptions.sizeMode = 'preset';
    rawOptions.sizePreset = rawSize;
  } else if (typeof rawSize === 'string' && /^\d+x\d+$/i.test(rawSize)) {
    const [width, height] = rawSize.toLowerCase().split('x');
    rawOptions.sizeMode = 'custom';
    rawOptions.customWidth = width;
    rawOptions.customHeight = height;
  } else {
    throw createServiceError('Unsupported image size.', 400);
  }

  return rawOptions;
}

function buildToolImageRequest(args = {}) {
  const selected = toArray(args.selected_image_ids || args.selectedImageIds || []);
  if (selected.length > MAX_GALLERY_INPUT_SELECTIONS || selected.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) throw createServiceError('Invalid gallery references.', 400);
  return {
    rawOptions: normalizeToolImageArguments(args),
    selectedImageIds: dedupeStrings(selected),
  };
}

function formatGeneratedImageDoc(doc) {
  return {
    ...modelMetadata(doc.model),
    id: doc._id ? doc._id.toString() : '',
    generationId: doc.generationId,
    outputIndex: doc.outputIndex,
    outputUrl: doc.outputUrl,
    outputFileName: doc.outputFileName,
    outputMimeType: doc.outputMimeType,
    outputSizeBytes: doc.outputSizeBytes,
    prompt: doc.prompt,
    revisedPrompt: doc.revisedPrompt || '',
    requestType: doc.requestType,
    requestedSize: doc.requestedSize,
    resolvedSize: doc.resolvedSize || doc.requestedSize,
    quality: doc.quality,
    background: doc.background,
    outputFormat: doc.outputFormat,
    createdBy: doc.createdBy,
  };
}

async function performImageGeneration({
  rawOptions = {},
  uploadedFiles = [],
  selectedImageIds = [],
  user = null,
  createdBy = null,
  openaiUser = null,
} = {}) {
  const validation = normalizeGenerationForm(rawOptions || {});
  if (!validation.ok) {
    throw createServiceError(validation.message, 400);
  }

  const selections = toArray(selectedImageIds);
  if (selections.length > MAX_GALLERY_INPUT_SELECTIONS || selections.some(id => typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id))) throw createServiceError('Invalid gallery references.', 400);
  const normalizedSelectedIds = dedupeStrings(selections.map(id => id.toLowerCase()));
  if (normalizedSelectedIds.length > MAX_GALLERY_INPUT_SELECTIONS) {
    throw createServiceError(`Please select no more than ${MAX_GALLERY_INPUT_SELECTIONS} gallery images.`, 400);
  }

  const safeUploadedFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  if (safeUploadedFiles.length > MAX_UPLOAD_IMAGE_COUNT || safeUploadedFiles.length + normalizedSelectedIds.length > MAX_INPUT_IMAGE_COUNT) throw createServiceError('Too many reference images.', 400);
  const tempUploadPaths = safeUploadedFiles.map((file) => file.path).filter(Boolean);
  const newInputPaths = [];
  const outputPaths = [];
  const generationId = randomUUID();
  let persistenceAttempted = false;

  try {
    const galleryInputs = await loadSelectedGalleryInputs(normalizedSelectedIds);
    const persistedUploads = await persistUploadedInputFiles(safeUploadedFiles);
    const uploadedInputs = persistedUploads.savedInputs;
    const combinedInputs = [...galleryInputs, ...uploadedInputs];
    newInputPaths.push(...persistedUploads.savedPaths);

    if (combinedInputs.length > MAX_INPUT_IMAGE_COUNT) {
      throw createServiceError(`A maximum of ${MAX_INPUT_IMAGE_COUNT} input images is supported per request.`, 400);
    }

    await ensureImageDir();

    const baseRequest = {
      model: validation.requestOptions.model,
      prompt: validation.requestOptions.prompt,
      n: validation.requestOptions.n,
      quality: validation.requestOptions.quality,
      size: validation.requestOptions.requestedSize,
      background: validation.requestOptions.background,
      output_format: validation.requestOptions.outputFormat,
      moderation: validation.requestOptions.moderation,
      user: openaiUser || resolveOpenAIUser(user),
    };

    if (validation.requestOptions.outputCompression !== null) {
      baseRequest.output_compression = validation.requestOptions.outputCompression;
    }

    const openai = getOpenAIClient();
    let response;
    let requestType = 'generate';
    if (combinedInputs.length > 0) {
      requestType = 'edit';
      response = await executeCompatibleEditRequest(baseRequest, combinedInputs);
    } else {
      response = await openai.images.generate(baseRequest);
    }

    const createdAt = response && response.created
      ? new Date(response.created * 1000)
      : new Date();
    const outputFormat = response && response.output_format
      ? response.output_format
      : validation.requestOptions.outputFormat;
    const outputMimeType = getMimeTypeForFormat(outputFormat);
    const promptKeywords = extractPromptKeywords(validation.requestOptions.prompt);
    const storedInputImages = stripAbsolutePaths(combinedInputs);
    const data = Array.isArray(response && response.data) ? response.data : [];

    if (data.length > validation.requestOptions.n) throw new Error('Unexpected output count from image provider.');
    if (!OUTPUT_FORMAT_OPTIONS.includes(outputFormat)) throw new Error('Unexpected output format from image provider.');
    if (data.length === 0) {
      throw new Error('The OpenAI image response did not contain any images.');
    }

    const docsToInsert = [];
    let outputIndex = 0;
    for (const item of data) {
      if (!item || !item.b64_json) {
        continue;
      }

      if (typeof item.b64_json !== 'string' || item.b64_json.length > Math.ceil(imageStorage.MAX_STORED_BYTES / 3) * 4) throw new Error('Image provider output exceeds storage limits.');
      const buffer = Buffer.from(item.b64_json, 'base64');
      const stored = await imageStorage.writeImage(buffer, outputFormat);
      const storedFileName = stored.fileName;
      outputPaths.push(stored.absolutePath);

      docsToInsert.push({
        generationId,
        outputIndex,
        createdBy: createdBy || resolveCreatedBy(user),
        model: validation.requestOptions.model,
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

    persistenceAttempted = true;
    const insertedDocs = await GptImageGeneration.insertMany(docsToInsert, { ordered: true });

    return {
      ok: true,
      generationId,
      requestType,
      createdCount: insertedDocs.length,
      inputCount: storedInputImages.length,
      images: insertedDocs.map(formatGeneratedImageDoc),
      validation,
    };
  } catch (error) {
    if (persistenceAttempted) {
      try {
        await GptImageGeneration.deleteMany({ generationId }).exec();
      } catch (rollbackError) {
        logger.error('GPT Image partial save needs reconciliation; media retained', {
          category: 'gpt_image', metadata: { generationId, code: rollbackError.code || 'UNKNOWN' },
        });
        throw error;
      }
    }
    await cleanupFiles(outputPaths);
    await cleanupFiles(newInputPaths);
    await cleanupFiles(tempUploadPaths);
    throw error;
  }
}

async function createImageGeneration(options = {}) {
  const principalKey = String(options.user?._id || options.user?.name || 'legacy-tool');
  if (activeGenerations.has(principalKey) || activeGenerations.size >= MAX_ACTIVE_GENERATIONS) {
    throw createServiceError('Image generation is busy. Please try again shortly.', 429);
  }
  activeGenerations.add(principalKey);
  try {
    return await performImageGeneration(options);
  } catch (error) {
    if (!error.expose) {
      logger.error('GPT Image generation or persistence failed', {
        category: 'gpt_image', metadata: { code: error.code || 'UNKNOWN', status: Number(error.status) || 500 },
      });
      throw createServiceError('Unable to generate an image right now.', 502);
    }
    throw error;
  } finally {
    activeGenerations.delete(principalKey);
    await cleanupFiles((options.uploadedFiles || []).map(file => file.path).filter(Boolean));
  }
}

function extractUnknownParameterName(error) {
  const message = error && typeof error.message === 'string'
    ? error.message
    : String(error || '');
  const match = message.match(/Unknown parameter:\s*'([^']+)'/i);
  return match ? match[1] : null;
}

async function executeWithUnknownParameterRetry(initialRequest, executor, retryableParameters = RETRYABLE_EDIT_PARAMETERS) {
  let currentRequest = { ...initialRequest };
  const removedParameters = [];
  const retryableSet = new Set(Array.isArray(retryableParameters) ? retryableParameters : []);

  while (true) {
    try {
      const response = await executor(currentRequest);
      return {
        response,
        request: currentRequest,
        removedParameters,
      };
    } catch (error) {
      const parameterName = extractUnknownParameterName(error);
      const isRetryable = Number(error && error.status) === 400 &&
        parameterName &&
        retryableSet.has(parameterName) &&
        Object.prototype.hasOwnProperty.call(currentRequest, parameterName);

      if (!isRetryable) {
        throw error;
      }

      const nextRequest = { ...currentRequest };
      delete nextRequest[parameterName];
      currentRequest = nextRequest;
      retryableSet.delete(parameterName);
      removedParameters.push(parameterName);
    }
  }
}

module.exports = {
  MODEL_NAME,
  PAGE_SIZE,
  MAX_PROMPT_LENGTH,
  MAX_INPUT_IMAGE_COUNT,
  MAX_GALLERY_INPUT_SELECTIONS,
  MAX_UPLOAD_IMAGE_COUNT,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  RETRYABLE_EDIT_PARAMETERS,
  QUALITY_OPTIONS,
  BACKGROUND_OPTIONS,
  OUTPUT_FORMAT_OPTIONS,
  MODERATION_OPTIONS,
  SIZE_MODE_OPTIONS,
  SIZE_PRESETS,
  N_OPTIONS,
  DEFAULT_FORM_VALUES,
  toArray,
  escapeRegex,
  clampInt,
  sanitizePage,
  buildPageUrl,
  buildPagination,
  extractPromptKeywords,
  buildPromptFilter,
  parseCustomSize,
  resolveRequestedSize,
  normalizeGenerationForm,
  getOutputExtension,
  getMimeTypeForFormat,
  sanitizeFileStem,
  buildStoredFileName,
  buildGalleryAggregate,
  dedupeStrings,
  fileNameFromOriginal,
  createServiceError,
  ensureImageDir,
  cleanupFiles,
  buildImageUrl,
  persistUploadedInputFiles,
  loadSelectedGalleryInputs,
  stripAbsolutePaths,
  buildOpenAIEditImages,
  executeCompatibleEditRequest,
  normalizeToolImageArguments,
  buildToolImageRequest,
  formatGeneratedImageDoc,
  createImageGeneration,
  extractUnknownParameterName,
  executeWithUnknownParameterRetry,
};
