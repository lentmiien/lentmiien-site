class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRateRatio = sampleRate / 24000; // Calculate the ratio for downsampling
    this._buffer = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0]; // Assuming mono input

      // Downsample the audio data to 24kHz
      const downsampledData = this.downsampleBuffer(channelData, sampleRate, 24000);

      // Send the downsampled audio data to the main thread
      this.port.postMessage(downsampledData);
    }
    return true;
  }

  downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (outputSampleRate === inputSampleRate) {
      return buffer;
    }
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }
}

registerProcessor('audio-processor', AudioProcessor);