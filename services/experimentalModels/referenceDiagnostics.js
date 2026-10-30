const { LabError, LIMITS } = require('./policy');

// Only fixed reasons and explicitly selected finite numbers cross the HTTP/log
// boundary. Never attach parser messages, filenames, headers or file contents.
const reasons = {
  empty_file: [400, 'admission', 'Choose one nonempty WAV file.'],
  mime: [400, 'admission', 'Use a WAV media type or an unspecified binary media type. Other media types are not accepted.'],
  filename: [400, 'admission', 'Use a filename of 1–200 characters without paths or control characters.'],
  extension: [400, 'admission', 'The reference filename must end in .wav.'],
  size: [413, 'admission', 'Reference WAV must be at most 6 MiB.'],
  wav_format: [422, 'content', 'Use a complete PCM16 WAV with valid RIFF sizes, chunks and sample alignment.'],
  rate: [422, 'content', 'Reference sample rate must be 16000–48000 Hz.'],
  channels: [422, 'content', 'Reference WAV must have 1 or 2 channels.'],
  duration: [422, 'content', 'Reference duration must be 1–30 seconds.'],
  parts: [413, 'receive', 'Upload exactly one file part named file, with no extra parts.'],
  interrupted: [400, 'receive', 'Reference upload was interrupted. Select the file and retry.'],
  timeout: [408, 'receive', 'Reference upload timed out. Select the file and retry.'],
};
const bounds = {
  filename: { maxCharacters: 200 }, size: { maxBytes: LIMITS.referenceBytes },
  rate: { minSampleRate: 16000, maxSampleRate: 48000 }, channels: { minChannels: 1, maxChannels: 2 },
  duration: { minSeconds: 1, maxSeconds: 30 },
};
function referenceError(reason, observed = {}) {
  const [status, stage, message] = reasons[reason];
  const error = new LabError(`reference_${reason}`, status, message);
  const numeric = { ...bounds[reason] };
  for (const key of ['bytes', 'sampleRate', 'channels', 'durationSeconds']) {
    if (Number.isFinite(observed[key]) && observed[key] >= 0) numeric[key] = observed[key];
  }
  error.diagnostic = { stage, reason, ...(Object.keys(numeric).length ? { numeric } : {}) };
  return error;
}
module.exports = { referenceError };
