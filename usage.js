// usage.js
const logger = require('./utils/logger');
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
          logger.notice(error.response.data);
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
            logger.notice(error.response.data);
            throw new Error(`API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else {
            throw new Error(`Request Error: ${error.message}`);
        }
    }
}

async function fetchUsageSummaryForPeriod(sd, ed) {
  const options = {
    start_time: Math.round(ed.getTime()/1000) - (60*60*24),
    end_time: Math.round(ed.getTime()/1000), // Optional
    bucket_width: '1d', // Options: '1m', '1h', '1d'
    // project_ids: ['proj_1', 'proj_2'], // Optional
    // user_ids: ['user_1', 'user_2'], // Optional
    // api_key_ids: ['key_1', 'key_2'], // Optional
    // models: ['model_1', 'model_2'], // Optional
    // batch: true, // Optional: true, false
    group_by: ['model'], // Optional
    limit: 1, // Depends on bucket_width
    page: null, // For pagination
  };

  try {
    const summary = {
      entry_date: `${sd.getFullYear()}-${sd.getMonth() > 8 ? (sd.getMonth()+1) : '0' + (sd.getMonth()+1)}-${sd.getDate() > 9 ? sd.getDate() : '0' + sd.getDate()}`
    };

    // Fetch Completions Usage
    const completionsData = await fetchCompletionsUsage(options);
    // logger.notice('Completions Usage:', JSON.stringify(completionsData, null, 2));
    const completions_model_index = [];
    summary['completions'] = [];
    completionsData.data.forEach(d => {
      d.results.forEach(r => {
        const index = completions_model_index.indexOf(r.model);
        if (index >= 0) {
          summary['completions'][index].input_tokens += r.input_tokens;
          summary['completions'][index].output_tokens += r.output_tokens;
          summary['completions'][index].input_cached_tokens += r.input_cached_tokens;
          summary['completions'][index].num_model_requests += r.num_model_requests;
        } else {
          completions_model_index.push(r.model);
          summary['completions'].push({
            model: r.model,
            input_tokens: r.input_tokens,
            output_tokens: r.output_tokens,
            input_cached_tokens: r.input_cached_tokens,
            num_model_requests: r.num_model_requests,
          });
        }
      });
    });

    // Fetch Embeddings Usage
    const embeddingsData = await fetchEmbeddingsUsage(options);
    // logger.notice('Embeddings Usage:', JSON.stringify(embeddingsData, null, 2));
    const embeddings_model_index = [];
    summary['embeddings'] = [];
    embeddingsData.data.forEach(d => {
      d.results.forEach(r => {
        const index = embeddings_model_index.indexOf(r.model);
        if (index >= 0) {
          summary['embeddings'][index].input_tokens += r.input_tokens;
          summary['embeddings'][index].num_model_requests += r.num_model_requests;
        } else {
          embeddings_model_index.push(r.model);
          summary['embeddings'].push({
            model: r.model,
            input_tokens: r.input_tokens,
            num_model_requests: r.num_model_requests,
          });
        }
      });
    });

    // Fetch Images Usage
    const imagesData = await fetchImagesUsage(options);
    // logger.notice('Images Usage:', JSON.stringify(imagesData, null, 2));
    const images_model_index = [];
    summary['images'] = [];
    imagesData.data.forEach(d => {
      d.results.forEach(r => {
        const index = images_model_index.indexOf(r.model);
        if (index >= 0) {
          summary['images'][index].images += r.images;
          summary['images'][index].num_model_requests += r.num_model_requests;
        } else {
          images_model_index.push(r.model);
          summary['images'].push({
            model: r.model,
            images: r.images,
            num_model_requests: r.num_model_requests,
          });
        }
      });
    });

    // Fetch Audio Speeches Usage
    const audioSpeechesData = await fetchAudioSpeechesUsage(options);
    // logger.notice('Audio Speeches Usage:', JSON.stringify(audioSpeechesData, null, 2));
    const speeches_model_index = [];
    summary['speeches'] = [];
    audioSpeechesData.data.forEach(d => {
      d.results.forEach(r => {
        const index = speeches_model_index.indexOf(r.model);
        if (index >= 0) {
          summary['speeches'][index].characters += r.characters;
          summary['speeches'][index].num_model_requests += r.num_model_requests;
        } else {
          speeches_model_index.push(r.model);
          summary['speeches'].push({
            model: r.model,
            characters: r.characters,
            num_model_requests: r.num_model_requests,
          });
        }
      });
    });

    // Fetch Audio Transcriptions Usage
    const audioTranscriptionsData = await fetchAudioTranscriptionsUsage(options);
    // logger.notice('Audio Transcriptions Usage:', JSON.stringify(audioTranscriptionsData, null, 2));
    const transcriptions_model_index = [];
    summary['transcriptions'] = [];
    audioTranscriptionsData.data.forEach(d => {
      d.results.forEach(r => {
        const index = transcriptions_model_index.indexOf(r.model);
        if (index >= 0) {
          summary['transcriptions'][index].seconds += r.seconds;
          summary['transcriptions'][index].num_model_requests += r.num_model_requests;
        } else {
          transcriptions_model_index.push(r.model);
          summary['transcriptions'].push({
            model: r.model,
            seconds: r.seconds,
            num_model_requests: r.num_model_requests,
          });
        }
      });
    });

    // Fetch Audio Transcriptions Usage
    const costsData = await fetchCostsData(options);
    // logger.notice('Cost:', JSON.stringify(costsData, null, 2));
    summary['cost'] = 0;
    costsData.data.forEach(d => {
      d.results.forEach(r => {
        summary['cost'] += r.amount.value;
      });
    });

    return summary;
  } catch (error) {
    logger.error('Error fetching usage data:', error.message);
    return undefined;
  }
}

module.exports = {
    fetchCompletionsUsage,
    fetchEmbeddingsUsage,
    fetchImagesUsage,
    fetchAudioSpeechesUsage,
    fetchAudioTranscriptionsUsage,
    fetchCostsData,
    fetchUsageSummaryForPeriod,
};
