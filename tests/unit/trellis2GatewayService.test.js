const {
  buildGenerationFormFields,
  containerIsRunning,
  containerIsUnhealthy,
  extractDetail,
  extractGenerationResponseMetadata,
} = require('../../services/trellis2GatewayService');
const { DEFAULT_TRELLIS2_PARAMETERS } = require('../../utils/trellis2');

describe('Trellis2GatewayService helpers', () => {
  test('maps application parameter names to the gateway multipart contract', () => {
    expect(buildGenerationFormFields(DEFAULT_TRELLIS2_PARAMETERS)).toEqual({
      seed: 0,
      resolution: 512,
      preprocess_image: true,
      sparse_structure_steps: 12,
      sparse_structure_guidance: 7.5,
      shape_steps: 12,
      shape_guidance: 7.5,
      texture_steps: 12,
      texture_guidance: 1,
      decimation_target: 500000,
      texture_size: 2048,
      remesh: true,
    });
  });

  test('extracts binary-response metadata from case-insensitive headers', () => {
    expect(extractGenerationResponseMetadata({
      'X-Job-Id': 'gateway-job-id',
      'x-generation-seconds': '120.5',
      'X-Export-Seconds': '14.2',
      'x-peak-vram-mib': '7368',
      'content-type': 'model/gltf-binary',
    })).toEqual({
      gatewayJobId: 'gateway-job-id',
      generationSeconds: 120.5,
      exportSeconds: 14.2,
      peakVramMiB: 7368,
      contentType: 'model/gltf-binary',
    });
  });

  test('does not turn missing numeric headers into zeroes', () => {
    expect(extractGenerationResponseMetadata({})).toEqual({
      gatewayJobId: null,
      generationSeconds: null,
      exportSeconds: null,
      peakVramMiB: null,
      contentType: 'model/gltf-binary',
    });
  });

  test('extracts gateway detail from a buffered JSON error body', () => {
    expect(extractDetail(Buffer.from('{"detail":"The model is busy"}'))).toBe('The model is busy');
  });

  test.each([
    [{ running: true }, true],
    [{ state: 'running' }, true],
    [{ container: { status: 'healthy' } }, true],
    [{ running: false, state: 'stopped' }, false],
  ])('normalizes container running state', (state, expected) => {
    expect(containerIsRunning(state)).toBe(expected);
  });

  test.each([
    [{ health: { ok: false } }, true],
    [{ health: { status: 'unhealthy' } }, true],
    [{ health: { ok: true, status: 'ok' } }, false],
    [{ state: 'running' }, false],
  ])('detects an explicitly unhealthy container', (state, expected) => {
    expect(containerIsUnhealthy(state)).toBe(expected);
  });
});
