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
    const summary = {
      entry_date: `${sd.getFullYear()}-${sd.getMonth() > 8 ? (sd.getMonth()+1) : '0' + (sd.getMonth()+1)}-${sd.getDate() > 9 ? sd.getDate() : '0' + sd.getDate()}`
    };

    // Fetch Completions Usage
    const completionsData = await fetchCompletionsUsage(options);
    console.log('Completions Usage:', JSON.stringify(completionsData, null, 2));
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
    console.log('Embeddings Usage:', JSON.stringify(embeddingsData, null, 2));
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
    console.log('Images Usage:', JSON.stringify(imagesData, null, 2));
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
    console.log('Audio Speeches Usage:', JSON.stringify(audioSpeechesData, null, 2));
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
    console.log('Audio Transcriptions Usage:', JSON.stringify(audioTranscriptionsData, null, 2));
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

    console.log(summary);
  } catch (error) {
    console.error('Error fetching usage data:', error.message);
  }
}

main();
