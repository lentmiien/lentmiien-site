const { AmiAmiItem } = require('../database');
const logger = require('../utils/logger');

const MAX_CODES_PER_REQUEST = 100;

function normalizeCode(value) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }

  return '';
}

function orderItemsByRequestedCodes(items, codes) {
  const codePositions = new Map(codes.map((code, index) => [code, index]));

  function getPosition(item) {
    const matchingPositions = [item.gcode, item.details && item.details.janCode]
      .map((code) => codePositions.get(code))
      .filter((position) => position !== undefined);

    return matchingPositions.length > 0
      ? Math.min(...matchingPositions)
      : Number.MAX_SAFE_INTEGER;
  }

  return [...items].sort((left, right) => {
    const positionDifference = getPosition(left) - getPosition(right);
    if (positionDifference !== 0) {
      return positionDifference;
    }
    return String(left.gcode || '').localeCompare(String(right.gcode || ''));
  });
}

exports.fetchItems = async (req, res) => {
  if (!Array.isArray(req.body)) {
    return res.status(400).json({
      error: 'Expected the request body to be an array of gcode or JAN codes.',
    });
  }

  if (req.body.length > MAX_CODES_PER_REQUEST) {
    return res.status(400).json({
      error: `A maximum of ${MAX_CODES_PER_REQUEST} codes is allowed per request.`,
    });
  }

  const codes = req.body.map(normalizeCode);
  const invalidCodeIndex = codes.findIndex((code) => code.length === 0);
  if (invalidCodeIndex !== -1) {
    return res.status(400).json({
      error: `Code at index ${invalidCodeIndex} must be a non-empty string or a non-negative integer.`,
    });
  }

  const uniqueCodes = [...new Set(codes)];
  if (uniqueCodes.length === 0) {
    return res.json([]);
  }

  try {
    const items = await AmiAmiItem.find({
      $or: [
        { gcode: { $in: uniqueCodes } },
        { 'details.janCode': { $in: uniqueCodes } },
      ],
    })
      .lean()
      .exec();

    return res.json(orderItemsByRequestedCodes(items, uniqueCodes));
  } catch (error) {
    logger.error('Unable to fetch AmiAmi items through the API', {
      category: 'amiami-items-api',
      metadata: { error },
    });
    return res.status(500).json({
      error: 'Unable to fetch AmiAmi items.',
    });
  }
};

