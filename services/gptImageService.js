const path = require('path');
const { randomUUID } = require('crypto');

const MODEL_NAME = 'gpt-image-2';
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
  const width = clampInt(widthInput, 0, 100000, 0);
  const height = clampInt(heightInput, 0, 100000, 0);
  if (!width || !height) {
    return {
      ok: false,
      message: 'Custom width and height are required.',
    };
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
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  const n = clampInt(raw.n, 1, 10, DEFAULT_FORM_VALUES.n);
  const quality = QUALITY_OPTIONS.includes(raw.quality) ? raw.quality : DEFAULT_FORM_VALUES.quality;
  const background = BACKGROUND_OPTIONS.includes(raw.background) ? raw.background : DEFAULT_FORM_VALUES.background;
  const outputFormat = OUTPUT_FORMAT_OPTIONS.includes(raw.outputFormat) ? raw.outputFormat : DEFAULT_FORM_VALUES.outputFormat;
  const moderation = MODERATION_OPTIONS.includes(raw.moderation) ? raw.moderation : DEFAULT_FORM_VALUES.moderation;
  const size = resolveRequestedSize(raw);
  const outputCompression = outputFormat === 'png'
    ? null
    : clampInt(raw.outputCompression, 0, 100, DEFAULT_FORM_VALUES.outputCompression);

  const formValues = {
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

module.exports = {
  MODEL_NAME,
  PAGE_SIZE,
  MAX_PROMPT_LENGTH,
  MAX_INPUT_IMAGE_COUNT,
  MAX_GALLERY_INPUT_SELECTIONS,
  MAX_UPLOAD_IMAGE_COUNT,
  MAX_UPLOAD_FILE_SIZE_BYTES,
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
};
