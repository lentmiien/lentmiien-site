// example.js
const {
  fetchCompletionsUsage,
  fetchEmbeddingsUsage,
  fetchImagesUsage,
  fetchAudioSpeechesUsage,
  fetchAudioTranscriptionsUsage,
} = require('./usage');

async function main() {
  const d = new Date();
  const sd = new Date(d.getFullYear(), d.getMonth(), d.getDate()-1, 0, 0, 0, 0);
  const ed = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const options = {
    start_time: Math.round(sd.getTime()/1000),
    end_time: Math.round(ed.getTime()/1000), // Optional
    bucket_width: '1d', // Options: '1m', '1h', '1d'
    // project_ids: ['proj_1', 'proj_2'], // Optional
    // user_ids: ['user_1', 'user_2'], // Optional
    // api_key_ids: ['key_1', 'key_2'], // Optional
    // models: ['model_1', 'model_2'], // Optional
    // batch: true, // Optional: true, false
    group_by: ['model'], // Optional
    limit: 2, // Depends on bucket_width
    page: null, // For pagination
  };

  try {
    // Fetch Completions Usage
    const completionsData = await fetchCompletionsUsage(options);
    console.log('Completions Usage:', JSON.stringify(completionsData, null, 2));

    // Fetch Embeddings Usage
    const embeddingsData = await fetchEmbeddingsUsage(options);
    console.log('Embeddings Usage:', JSON.stringify(embeddingsData, null, 2));

    // Fetch Images Usage
    const imagesData = await fetchImagesUsage(options);
    console.log('Images Usage:', JSON.stringify(imagesData, null, 2));

    // Fetch Audio Speeches Usage
    const audioSpeechesData = await fetchAudioSpeechesUsage(options);
    console.log('Audio Speeches Usage:', JSON.stringify(audioSpeechesData, null, 2));

    // Fetch Audio Transcriptions Usage
    const audioTranscriptionsData = await fetchAudioTranscriptionsUsage(options);
    console.log('Audio Transcriptions Usage:', JSON.stringify(audioTranscriptionsData, null, 2));
  } catch (error) {
    console.error('Error fetching usage data:', error.message);
  }
}

main();
