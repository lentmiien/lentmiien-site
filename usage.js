// usage.js
require('dotenv').config();
const axios = require('axios');

/**
 * Base configuration for Axios
 */
const apiClient = axios.create({
    baseURL: 'https://api.openai.com/v1/organization',
    headers: {
        'Authorization': `Bearer ${process.env.OPENAI_ADMIN_KEY}`,
        'Content-Type': 'application/json',
    },
});

/**
 * Constructs query parameters based on the provided inputs.
 * @param {Object} params - The parameters for the API call.
 * @returns {Object} - The query parameters.
 */
function constructQueryParams(params) {
    const query = {};

    if (params.start_time) query.start_time = params.start_time;
    if (params.end_time) query.end_time = params.end_time;
    if (params.bucket_width) query.bucket_width = params.bucket_width;
    if (params.limit) query.limit = params.limit;
    if (params.page) query.page = params.page;

    // Handle array parameters
    if (params.project_ids && params.project_ids.length > 0) {
        query.project_ids = params.project_ids.join(',');
    }
    if (params.user_ids && params.user_ids.length > 0) {
        query.user_ids = params.user_ids.join(',');
    }
    if (params.api_key_ids && params.api_key_ids.length > 0) {
        query.api_key_ids = params.api_key_ids.join(',');
    }
    if (params.models && params.models.length > 0) {
        query.models = params.models.join(',');
    }
    if (typeof params.batch === 'boolean') {
        query.batch = params.batch;
    }
    if (params.group_by && params.group_by.length > 0) {
        query.group_by = params.group_by.join(',');
    }

    return query;
}

/**
 * Constructs query parameters for the `costs` endpoint.
 * Only includes the supported parameters.
 * 
 * @param {Object} params - The input parameters for the API.
 * @returns {Object} - The filtered query parameters for the `costs` endpoint.
 */
function constructCostsQueryParams(params) {
    const query = {};

    if (params.start_time) query.start_time = params.start_time;
    if (params.end_time) query.end_time = params.end_time;
    if (params.limit) query.limit = params.limit;
    if (params.page) query.page = params.page;
    query.bucket_width = '1d';

    return query;
}

/**
 * Generic function to fetch usage data.
 * @param {string} usageType - The type of usage (e.g., completions, embeddings).
 * @param {Object} options - The query parameters.
 * @returns {Promise<Object>} - The API response.
 */
async function fetchUsage(usageType, options = {}) {
    try {
        const response = await apiClient.get(`/usage/${usageType}`, {
            params: constructQueryParams(options),
        });
        return response.data;
    } catch (error) {
        // Handle errors appropriately
        if (error.response) {
          console.log(error.response.data);
          throw new Error(`API Error: ${error.response.status} - ${error.response.data}`);
        } else {
          throw new Error(`Request Error: ${error.message}`);
        }
    }
}

/**
 * Fetch completions usage.
 * @param {Object} options - The query parameters.
 * @returns {Promise<Object>} - The API response.
 */
function fetchCompletionsUsage(options) {
    return fetchUsage('completions', options);
}

/**
 * Fetch embeddings usage.
 * @param {Object} options - The query parameters.
 * @returns {Promise<Object>} - The API response.
 */
function fetchEmbeddingsUsage(options) {
    return fetchUsage('embeddings', options);
}

/**
 * Fetch images usage.
 * @param {Object} options - The query parameters.
 * @returns {Promise<Object>} - The API response.
 */
function fetchImagesUsage(options) {
    return fetchUsage('images', options);
}

/**
 * Fetch audio_speeches usage.
 * @param {Object} options - The query parameters.
 * @returns {Promise<Object>} - The API response.
 */
function fetchAudioSpeechesUsage(options) {
    return fetchUsage('audio_speeches', options);
}

/**
 * Fetch audio_transcriptions usage.
 * @param {Object} options - The query parameters.
 * @returns {Promise<Object>} - The API response.
 */
function fetchAudioTranscriptionsUsage(options) {
    return fetchUsage('audio_transcriptions', options);
}

/**
 * Fetch costs data.
 * @param {Object} options - The query parameters for the request.
 * @returns {Promise<Object>} - The API response for costs data.
 */
async function fetchCostsData(options = {}) {
    try {
        const params = constructCostsQueryParams(options);
        const response = await apiClient.get('/costs', { params });
        return response.data;
    } catch (error) {
        if (error.response) {
            console.log(error.response.data);
            throw new Error(`API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            throw new Error(`Request Error: ${error.message}`);
        }
    }
}

module.exports = {
    fetchCompletionsUsage,
    fetchEmbeddingsUsage,
    fetchImagesUsage,
    fetchAudioSpeechesUsage,
    fetchAudioTranscriptionsUsage,
    fetchCostsData,
};
