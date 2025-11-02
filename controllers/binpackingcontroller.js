const { z } = require('zod');
const binPackingService = require('../services/binPackingService');
const logger = require('../utils/logger');
const ApiDebugLog = require('../models/api_debug_log');

const ALGORITHMS = ['laff', 'plain', 'bruteforce'];
const JS_FILE_NAME = 'controllers/binpackingcontroller.js';

const toSerializable = (value) => {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item));
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (serializationError) {
      if (typeof value.toString === 'function') {
        return value.toString();
      }
      return {
        error: 'Failed to serialize payload',
        message: serializationError.message,
      };
    }
  }
  return value;
};

const recordApiDebugLog = async ({
  requestUrl,
  requestHeaders = null,
  requestBody = null,
  responseHeaders = null,
  responseBody = null,
  functionName,
}) => {
  try {
    await ApiDebugLog.create({
      requestUrl,
      requestHeaders: toSerializable(requestHeaders),
      requestBody: toSerializable(requestBody),
      responseHeaders: toSerializable(responseHeaders),
      responseBody: toSerializable(responseBody),
      jsFileName: JS_FILE_NAME,
      functionName,
    });
  } catch (logError) {
    logger.error('Failed to record API debug log entry', {
      category: 'api-debug',
      metadata: {
        requestUrl,
        functionName,
        message: logError.message,
      },
    });
  }
};

const containerSchema = z.object({
  id: z.string().trim().min(1, 'Container ID is required'),
  w: z.coerce.number().positive('Container width must be greater than 0'),
  d: z.coerce.number().positive('Container depth must be greater than 0'),
  h: z.coerce.number().positive('Container height must be greater than 0'),
  emptyWeight: z.coerce.number().min(0, 'Empty weight cannot be negative'),
  maxLoadWeight: z.coerce.number().min(0, 'Max load weight cannot be negative'),
});

const itemSchema = z.object({
  id: z.string().trim().min(1, 'Item ID is required'),
  w: z.coerce.number().positive('Item width must be greater than 0'),
  d: z.coerce.number().positive('Item depth must be greater than 0'),
  h: z.coerce.number().positive('Item height must be greater than 0'),
  weight: z.coerce.number().min(0, 'Item weight cannot be negative'),
  qty: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
});

const requestSchema = z.object({
  algorithm: z.enum(ALGORITHMS),
  container: containerSchema,
  items: z.array(itemSchema).min(1, 'At least one item is required'),
});

exports.index = (req, res) => {
  res.render('bin_packing', {
    pageTitle: '3D Bin Packing',
    algorithms: ALGORITHMS,
  });
};

exports.run = async (req, res) => {
  const functionName = 'run';
  const requestUrl = binPackingService.apiUrl || 'binPackingService.pack';
  let apiPayload = null;
  try {
    const sanitizedBody = {
      algorithm: req.body?.algorithm || 'laff',
      container: req.body?.container,
      items: req.body?.items,
    };

    const parsed = requestSchema.parse(sanitizedBody);
    const totalItemCount = parsed.items.reduce((sum, item) => sum + item.qty, 0);

    if (parsed.algorithm === 'bruteforce' && totalItemCount >= 8) {
      return res.status(400).json({
        success: false,
        message: 'The bruteforce algorithm is limited to fewer than 8 total items.',
      });
    }

    apiPayload = {
      algorithm: parsed.algorithm,
      maxContainers: 0,
      minimizeContainers: true,
      container: parsed.container,
      items: parsed.items.map((item) => ({
        ...item,
        rotate3D: true,
      })),
    };

    const apiResponse = await binPackingService.pack(apiPayload);

    await recordApiDebugLog({
      requestUrl,
      requestHeaders: null,
      requestBody: apiPayload,
      responseHeaders: null,
      responseBody: apiResponse,
      functionName,
    });

    res.json({
      success: Boolean(apiResponse?.success),
      data: apiResponse,
      meta: {
        algorithm: parsed.algorithm,
        totalItemCount,
        uniqueItems: parsed.items.length,
        containerId: parsed.container.id,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bin packing request.',
        issues: error.flatten(),
      });
    }

    if (apiPayload) {
      await recordApiDebugLog({
        requestUrl,
        requestHeaders: null,
        requestBody: apiPayload,
        responseHeaders: null,
        responseBody: error,
        functionName,
      });
    }

    logger.error('Bin packing request failed', {
      category: 'binpacking',
      metadata: {
        message: error.message,
      },
    });

    res.status(502).json({
      success: false,
      message: error.message || 'Failed to complete bin packing request.',
    });
  }
};

exports.requestSchema = requestSchema;
