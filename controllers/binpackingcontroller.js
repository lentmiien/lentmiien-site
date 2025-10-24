const { z } = require('zod');
const binPackingService = require('../services/binPackingService');
const logger = require('../utils/logger');

const ALGORITHMS = ['laff', 'plain', 'bruteforce'];

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
  try {
    const sanitizedBody = {
      algorithm: req.body?.algorithm || 'laff',
      container: req.body?.container,
      items: req.body?.items,
    };

    const parsed = requestSchema.parse(sanitizedBody);
    const totalItemCount = parsed.items.reduce((sum, item) => sum + item.qty, 0);

    logger.debug("Received packing request", {parsed});

    if (parsed.algorithm === 'bruteforce' && totalItemCount >= 8) {
      return res.status(400).json({
        success: false,
        message: 'The bruteforce algorithm is limited to fewer than 8 total items.',
      });
    }

    const apiPayload = {
      algorithm: parsed.algorithm,
      maxContainers: 0,
      minimizeContainers: true,
      container: parsed.container,
      items: parsed.items.map((item) => ({
        ...item,
        rotate3D: true,
      })),
    };

    logger.debug("Sending data to packing API", {apiPayload});

    const apiResponse = await binPackingService.pack(apiPayload);

    logger.debug("Received response from packing API", {apiResponse});

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
