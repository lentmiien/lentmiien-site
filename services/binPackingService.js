const axios = require('axios');
const logger = require('../utils/logger');

const DEFAULT_API_URL = process.env.BIN_PACKING_API_URL || 'http://localhost:8080/pack';

class BinPackingService {
  constructor(apiUrl = DEFAULT_API_URL) {
    this.apiUrl = apiUrl;
  }

  async pack(payload) {
    try {
      const response = await axios.post(this.apiUrl, payload, {
        timeout: 30000,
      });
      return response.data;
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Unknown error';
      logger.error('Bin packing API request failed', {
        category: 'binpacking',
        metadata: {
          apiUrl: this.apiUrl,
          message,
          status: error.response?.status,
        },
      });
      throw new Error(message);
    }
  }
}

module.exports = new BinPackingService();
module.exports.BinPackingService = BinPackingService;
