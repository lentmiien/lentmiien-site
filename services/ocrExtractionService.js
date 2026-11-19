const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');
const { API_BASE_URL, DEFAULT_MODEL } = require('./ocrModelService');

const MAX_COORD_VALUE = 1000;
const OCR_TIMEOUT_MS = Number(process.env.OCR_API_TIMEOUT_MS || 1200000);
const logApiDebug = createApiDebugLogger('controllers/ocrcontroller.js');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const percentOfCanvas = (value) => clamp((value / MAX_COORD_VALUE) * 100, 0, 100);
const parseOcrText = (rawText) => {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return [];
  }

  const matches = [];
  let cursor = 0;
  const pattern = /\((\d{1,3}),(\d{1,3})\),\((\d{1,3}),(\d{1,3})\)/g;
  let match;

  while ((match = pattern.exec(rawText)) !== null) {
    const text = rawText.slice(cursor, match.index).trim();
    cursor = pattern.lastIndex;
    const coords = match.slice(1).map((value) => clamp(parseInt(value, 10), 0, MAX_COORD_VALUE));
    if (!text) {
      continue;
    }
    matches.push({
      text,
      startX: coords[0],
      startY: coords[1],
      endX: coords[2],
      endY: coords[3],
    });
  }
  return matches;
};

const TEXT_DIRECTION = {
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
};

const normalizeDirection = (value, fallback = TEXT_DIRECTION.HORIZONTAL) => {
  if (value === TEXT_DIRECTION.VERTICAL) return TEXT_DIRECTION.VERTICAL;
  if (value === TEXT_DIRECTION.HORIZONTAL) return TEXT_DIRECTION.HORIZONTAL;
  return fallback;
};

const guessDirection = (boxes, fallback = TEXT_DIRECTION.HORIZONTAL) => {
  if (!Array.isArray(boxes) || !boxes.length) {
    return fallback;
  }
  let horizontalCount = 0;
  let verticalCount = 0;

  boxes.forEach((box) => {
    if (!box) return;
    const width = Math.max(1, box.endX - box.startX);
    const height = Math.max(1, box.endY - box.startY);
    if (width > height) {
      horizontalCount += 1;
    } else if (height > width) {
      verticalCount += 1;
    }
  });

  if (verticalCount > horizontalCount) return TEXT_DIRECTION.VERTICAL;
  if (horizontalCount > verticalCount) return TEXT_DIRECTION.HORIZONTAL;
  return fallback;
};

const buildHorizontalRows = (boxes) => {
  const height = (box) => Math.max(1, box.endY - box.startY);
  const yOverlap = (a, b) => Math.max(0, Math.min(a.endY, b.endY) - Math.max(a.startY, b.startY));
  const sharesRow = (a, b) => {
    const overlap = yOverlap(a, b);
    return overlap >= 0.5 * height(a) && overlap >= 0.5 * height(b);
  };

  const sorted = boxes.sort((a, b) => (a.startY - b.startY) || (a.startX - b.startX));
  const rows = [];
  sorted.forEach((box) => {
    const targetRow = rows.find((row) => row.some((entry) => sharesRow(entry, box)));
    if (targetRow) {
      targetRow.push(box);
    } else {
      rows.push([box]);
    }
  });

  return rows.map((row) => row.sort((a, b) => a.startX - b.startX));
};

const buildVerticalColumns = (boxes) => {
  const width = (box) => Math.max(1, box.endX - box.startX);
  const xOverlap = (a, b) => Math.max(0, Math.min(a.endX, b.endX) - Math.max(a.startX, b.startX));
  const sharesColumn = (a, b) => {
    const overlap = xOverlap(a, b);
    return overlap >= 0.5 * width(a) && overlap >= 0.5 * width(b);
  };

  const sorted = boxes.sort((a, b) => (b.startX - a.startX) || (a.startY - b.startY));
  const columns = [];
  sorted.forEach((box) => {
    const targetColumn = columns.find((column) => column.some((entry) => sharesColumn(entry, box)));
    if (targetColumn) {
      targetColumn.push(box);
    } else {
      columns.push([box]);
    }
  });

  return columns.map((column) => column.sort((a, b) => a.startY - b.startY));
};

const buildLayoutResult = (boxes, { direction = 'auto' } = {}) => {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    const normalizedDirection = normalizeDirection(direction);
    return { layoutText: '', layoutDirection: normalizedDirection };
  }

  const normalized = boxes
    .filter((box) => box && typeof box.text === 'string')
    .map((box) => ({
      ...box,
      text: box.text.trim(),
    }))
    .filter((box) => box.text);

  if (!normalized.length) {
    const normalizedDirection = normalizeDirection(direction);
    return { layoutText: '', layoutDirection: normalizedDirection };
  }

  const resolvedDirection = direction === 'auto'
    ? guessDirection(normalized, TEXT_DIRECTION.HORIZONTAL)
    : normalizeDirection(direction, TEXT_DIRECTION.HORIZONTAL);

  const rows = resolvedDirection === TEXT_DIRECTION.VERTICAL
    ? buildVerticalColumns([...normalized])
    : buildHorizontalRows([...normalized]);

  const lines = rows
    .map((row) => row
      .map((box) => (box.text || '').trim())
      .filter(Boolean)
      .join('  '))
    .filter(Boolean);

  return {
    layoutText: lines.join('\n'),
    layoutDirection: resolvedDirection,
  };
};

const enrichBoxesForOverlay = (boxes) => boxes.map((box, index) => {
  const width = clamp(box.endX - box.startX, 1, MAX_COORD_VALUE);
  const height = clamp(box.endY - box.startY, 1, MAX_COORD_VALUE);
  return {
    ...box,
    id: `${index}-${box.startX}-${box.startY}`,
    leftPercent: percentOfCanvas(box.startX),
    topPercent: percentOfCanvas(box.startY),
    widthPercent: clamp((width / MAX_COORD_VALUE) * 100, 0.5, 100),
    heightPercent: clamp((height / MAX_COORD_VALUE) * 100, 0.5, 100),
  };
});

const runFileOcr = async (job, file, payload, { privateRequest = false, signal } = {}) => {
  const requestUrl = `${API_BASE_URL}/ocr`;
  const multipart = new FormData();
  multipart.append('file', payload.buffer, {
    filename: payload.originalname || `${file.id}.dat`,
    contentType: payload.mimetype || 'application/octet-stream',
    knownLength: payload.buffer.length,
  });
  const model = job.model || DEFAULT_MODEL;
  multipart.append('model', model);
  const options = job.options || { prompt: job.prompt, max_new_tokens: job.maxNewTokens };
  for (const [key, value] of Object.entries(options)) {
    if (value != null && value !== '') multipart.append(key, String(value));
  }

  if (!privateRequest) logger.notice('Submitting OCR file to API', {
    category: 'ocr',
    metadata: {
      jobId: job.id || job._id,
      fileId: file.id,
      sizeBytes: payload.size,
    },
  });

  try {
    const axiosResponse = await axios.post(requestUrl, multipart, {
      timeout: model === DEFAULT_MODEL ? OCR_TIMEOUT_MS : Math.max(OCR_TIMEOUT_MS, 2800000),
      signal,
      maxContentLength: 1024 * 1024,
      maxRedirects: 0,
      headers: {
        ...multipart.getHeaders(),
        Accept: 'application/json',
      },
    });
    const { data } = axiosResponse;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid OCR response.');

    try {
      if (!privateRequest) await logApiDebug({
        requestUrl,
        requestHeaders: axiosResponse.config?.headers,
        requestBody: {
          jobId: job.id || job._id,
          fileId: file.id,
          model,
          fileSizeBytes: payload.size,
          transport: 'multipart/form-data',
        },
        responseHeaders: axiosResponse.headers,
        responseBody: {
          model: data?.model,
          textLength: typeof data?.text === 'string' ? data.text.length : 0,
        },
        functionName: 'runFileOcr',
      });
    } catch (loggingError) {
      logger.error('Failed to persist OCR API debug log', {
        category: 'ocr',
        metadata: { message: loggingError?.message || loggingError },
      });
    }

    const rawText = typeof data?.text === 'string' ? data.text : '';
    if (privateRequest && (typeof data.text !== 'string' || rawText.length > 64000)) throw new Error('Invalid OCR text.');
    const boxes = model === DEFAULT_MODEL ? parseOcrText(rawText) : [];
    const layoutResult = buildLayoutResult(boxes, { direction: 'auto' });
    const overlayBoxes = enrichBoxesForOverlay(boxes);

    return {
      rawText,
      rawResponse: model === DEFAULT_MODEL ? null : data,
      layoutText: model === DEFAULT_MODEL ? layoutResult.layoutText || rawText : '',
      overlayBoxes,
      originalOverlayBoxes: overlayBoxes,
      originalLayoutText: model === DEFAULT_MODEL ? layoutResult.layoutText || rawText : '',
      layoutDirection: layoutResult.layoutDirection,
      originalLayoutDirection: layoutResult.layoutDirection,
      model: data?.model || data?.model_id || model,
      promptUsed: data?.prompt || job.prompt,
      segmentsCount: overlayBoxes.length,
      receivedAt: new Date(),
    };
  } catch (error) {
    if (privateRequest) throw error;
    let message = 'Unable to contact the OCR service.';
    if (error.response?.data?.error) {
      message = error.response.data.error;
    } else if (Array.isArray(error.response?.data?.detail)) {
      message = error.response.data.detail.map((d) => d.msg).join('; ');
    } else if (error.message) {
      message = error.message;
    }

    try {
      if (!privateRequest) await logApiDebug({
        requestUrl,
        requestHeaders: error.config?.headers,
        requestBody: {
          jobId: job.id || job._id,
          fileId: file.id,
          model,
          fileSizeBytes: payload.size,
          transport: 'multipart/form-data',
        },
        responseHeaders: error.response?.headers,
        responseBody: { status: error.response?.status, code: error.code || 'OCR_REQUEST_FAILED' },
        functionName: 'runFileOcr',
      });
    } catch (loggingError) {
      logger.error('Failed to persist OCR API debug log', {
        category: 'ocr',
        metadata: { message: loggingError?.message || loggingError },
      });
    }

    if (model !== DEFAULT_MODEL) {
      logger.error('Alternative OCR gateway request failed', { category: 'ocr', metadata: { model, status: error.response?.status, code: error.code || 'INVALID_RESPONSE' } });
      message = `OCR service failed${error.response?.status ? ` (HTTP ${error.response.status})` : ''}. Check the model warning and input settings, then retry.`;
    }
    throw new Error(message);
  }
};

module.exports = { runFileOcr, buildLayoutResult, enrichBoxesForOverlay, normalizeDirection, TEXT_DIRECTION, clamp, MAX_COORD_VALUE };
