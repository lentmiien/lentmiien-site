const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { createApiDebugLogger } = require('../utils/apiDebugLogger');

const DEFAULT_PROMPT = 'Detect and recognize text in the image, and output the text coordinates in a formatted manner.';
const DEFAULT_MAX_NEW_TOKENS = 2048;
const MAX_ALLOWED_TOKENS = 8192;
const MAX_COORD_VALUE = 999;
const API_BASE_URL = process.env.OCR_API_BASE_URL || 'http://192.168.0.20:8000';
const logApiDebug = createApiDebugLogger('controllers/ocrcontroller.js');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const percentOfCanvas = (value) => clamp((value / MAX_COORD_VALUE) * 100, 0, 100);

const buildViewState = (overrides = {}) => ({
  title: 'OCR Workspace',
  tokenLimit: MAX_ALLOWED_TOKENS,
  defaults: {
    prompt: DEFAULT_PROMPT,
    maxNewTokens: DEFAULT_MAX_NEW_TOKENS,
  },
  formValues: {
    prompt: overrides.prompt ?? DEFAULT_PROMPT,
    maxNewTokens: overrides.maxNewTokens ?? DEFAULT_MAX_NEW_TOKENS,
  },
  error: overrides.error || null,
  result: overrides.result || null,
  health: overrides.health || null,
});

const fetchHealth = async () => {
  try {
    const { data } = await axios.get(`${API_BASE_URL}/health`, { timeout: 2000 });
    if (data && typeof data === 'object') {
      return data;
    }
  } catch (error) {
    // Health is optional; ignore failures
  }
  return null;
};

const parseOcrText = (rawText) => {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return [];
  }

  const matches = [];
  const pattern = /([\s\S]*?)\((\d{1,3}),(\d{1,3})\),\((\d{1,3}),(\d{1,3})\)/g;
  let match;

  while ((match = pattern.exec(rawText)) !== null) {
    const text = match[1].trim();
    const coords = match.slice(2).map((value) => clamp(parseInt(value, 10), 0, MAX_COORD_VALUE));
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

const buildLayoutText = (boxes) => {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    return '';
  }

  const sorted = boxes.slice().sort((a, b) => {
    const yDiff = Math.abs(a.startY - b.startY);
    if (yDiff <= 16) {
      return a.startX - b.startX;
    }
    return a.startY - b.startY;
  });

  const lines = [];
  let currentLine = [];
  let currentBaseline = null;
  const LINE_THRESHOLD = 24;

  sorted.forEach((box) => {
    const midY = (box.startY + box.endY) / 2;
    if (!currentLine.length) {
      currentLine.push(box);
      currentBaseline = midY;
      return;
    }
    if (Math.abs(midY - currentBaseline) > LINE_THRESHOLD) {
      lines.push(currentLine);
      currentLine = [box];
      currentBaseline = midY;
    } else {
      currentLine.push(box);
      currentBaseline = (currentBaseline * (currentLine.length - 1) + midY) / currentLine.length;
    }
  });

  if (currentLine.length) {
    lines.push(currentLine);
  }

  const toLineText = (line) => {
    const fragments = [];
    let previousBox = null;
    line.forEach((box) => {
      const text = box.text.trim();
      if (!text) {
        return;
      }
      if (!previousBox) {
        fragments.push(text);
        previousBox = box;
        return;
      }

      const gap = Math.max(0, box.startX - previousBox.endX);
      let spacer = ' ';
      if (gap >= 60) {
        spacer = ' '.repeat(clamp(Math.round(gap / 30), 2, 12));
      } else if (gap <= 6) {
        spacer = '';
      }

      fragments.push(`${spacer}${text}`);
      previousBox = box;
    });

    return fragments.join('').trim();
  };

  return lines
    .map(toLineText)
    .filter(Boolean)
    .join('\n');
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

exports.renderTool = async (_req, res) => {
  const health = await fetchHealth();
  res.render('ocr_tool', buildViewState({ health }));
};

exports.handleOcr = async (req, res) => {
  const prompt = req.body.prompt && req.body.prompt.trim() ? req.body.prompt.trim() : DEFAULT_PROMPT;
  const requestedTokens = parseInt(req.body.max_new_tokens, 10);
  const maxNewTokens = Number.isFinite(requestedTokens)
    ? clamp(requestedTokens, 1, MAX_ALLOWED_TOKENS)
    : DEFAULT_MAX_NEW_TOKENS;

  if (!req.file || !req.file.buffer) {
    const health = await fetchHealth();
    return res.status(400).render('ocr_tool', buildViewState({
      prompt,
      maxNewTokens,
      health,
      error: 'Please upload an image before submitting the form.',
    }));
  }

  const base64Image = req.file.buffer.toString('base64');
  const previewDataUrl = `data:${req.file.mimetype || 'image/png'};base64,${base64Image}`;
  logger.notice('Submitting OCR request', {
    category: 'ocr',
    metadata: {
      filename: req.file.originalname || 'uploaded-image',
      byteSize: req.file.size,
      mimetype: req.file.mimetype,
      promptLength: prompt.length,
      maxNewTokens,
    },
  });

  const requestUrl = `${API_BASE_URL}/ocr`;
  const multipart = new FormData();
  multipart.append('file', req.file.buffer, {
    filename: req.file.originalname || `upload-${Date.now()}`,
    contentType: req.file.mimetype || 'application/octet-stream',
    knownLength: req.file.size,
  });
  multipart.append('prompt', prompt);
  multipart.append('max_new_tokens', String(maxNewTokens));

  try {
    const axiosResponse = await axios.post(
      requestUrl,
      multipart,
      {
        timeout: 300000,
        headers: {
          ...multipart.getHeaders(),
          Accept: 'application/json',
        },
      }
    );
    const { data } = axiosResponse;

    try {
      await logApiDebug({
        requestUrl,
        requestHeaders: axiosResponse.config?.headers,
        requestBody: {
          prompt,
          max_new_tokens: maxNewTokens,
          fileSizeBytes: req.file.size,
          transport: 'multipart/form-data',
        },
        responseHeaders: axiosResponse.headers,
        responseBody: {
          model: data?.model,
          prompt: data?.prompt,
          textLength: typeof data?.text === 'string' ? data.text.length : 0,
          textPreview: typeof data?.text === 'string' ? data.text.slice(0, 400) : null,
          keys: Object.keys(data || {}),
        },
        functionName: 'handleOcr',
      });
    } catch (loggingError) {
      logger.error('Failed to persist OCR API debug log', {
        category: 'ocr',
        metadata: { message: loggingError?.message || loggingError },
      });
    }

    const rawText = typeof data?.text === 'string' ? data.text : '';
    const boxes = parseOcrText(rawText);
    const layoutText = buildLayoutText(boxes);
    const overlayBoxes = enrichBoxesForOverlay(boxes);
    const health = await fetchHealth();
    logger.notice('OCR service responded', {
      category: 'ocr',
      metadata: {
        segments: overlayBoxes.length,
        rawTextLength: rawText.length,
        layoutLength: layoutText.length,
        model: data?.model,
      },
    });

    return res.render('ocr_tool', buildViewState({
      prompt,
      maxNewTokens,
      health,
      result: {
        rawText,
        layoutText: layoutText || rawText,
        overlayBoxes,
        imageDataUrl: previewDataUrl,
        model: data?.model || health?.model || 'Unknown model',
        promptUsed: data?.prompt || prompt,
        segmentsCount: overlayBoxes.length,
      },
    }));
  } catch (error) {
    const health = await fetchHealth();

    let message = 'Unable to contact the OCR service.';
    if (error.response?.data && typeof error.response.data === 'object') {
      message = error.response.data.error || message;
    } else if (error.message) {
      message = error.message;
    }

    logger.error('OCR service call failed', {
      category: 'ocr',
      metadata: {
        message,
        status: error.response?.status,
        headersPresent: Boolean(error.response?.headers),
        hasResponseData: Boolean(error.response?.data),
      },
    });

    try {
      await logApiDebug({
        requestUrl,
        requestHeaders: error.config?.headers,
        requestBody: {
          prompt,
          max_new_tokens: maxNewTokens,
          fileSizeBytes: req.file.size,
          transport: 'multipart/form-data',
        },
        responseHeaders: error.response?.headers,
        responseBody: error.response?.data || { error: error.message },
        functionName: 'handleOcr',
      });
    } catch (loggingError) {
      logger.error('Failed to persist OCR API debug log', {
        category: 'ocr',
        metadata: { message: loggingError?.message || loggingError },
      });
    }

    return res.status(502).render('ocr_tool', buildViewState({
      prompt,
      maxNewTokens,
      health,
      error: message,
    }));
  }
};
