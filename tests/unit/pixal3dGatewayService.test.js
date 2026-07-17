const {
  buildGenerationFormFields,
  containerIsRunning,
  containerIsUnhealthy,
  extractDetail,
  extractGenerationResponseMetadata,
} = require('../../services/pixal3dGatewayService');
const { DEFAULT_PIXAL3D_PARAMETERS } = require('../../utils/pixal3d');

describe('Pixal3dGatewayService helpers', () => {
  test('maps every application parameter to the gateway multipart contract', () => {
    expect(buildGenerationFormFields(DEFAULT_PIXAL3D_PARAMETERS)).toEqual({
      seed: 42,
      resolution: 1024,
      preprocess_image: true,
      fov_degrees: 0,
      mesh_scale: 1,
      extend_pixel: 0,
      sparse_structure_steps: 12,
      sparse_structure_guidance: 7.5,
      sparse_structure_guidance_rescale: 0.7,
      shape_steps: 12,
      shape_guidance: 7.5,
      shape_guidance_rescale: 0.5,
      texture_steps: 12,
      texture_guidance: 1,
      texture_guidance_rescale: 0,
      max_num_tokens: 49152,
      decimation_target: 300000,
      texture_size: 2048,
      dc_resolution: 256,
      smooth_iterations: 0,
      fill_holes: true,
    });
  });

  test('extracts live binary-response metadata from case-insensitive headers', () => {
    expect(extractGenerationResponseMetadata({
      'X-Job-Id': 'gateway-job-id',
      'x-generation-seconds': '41.213',
      'X-Export-Seconds': '5.127',
      'x-peak-vram-mib': '19574',
      'X-Actual-Resolution': '1024',
      'x-camera-fov-degrees': '44.498',
      'X-Worker-Recycle': 'true',
      'content-type': 'model/gltf-binary',
    })).toEqual({
      gatewayJobId: 'gateway-job-id',
      generationSeconds: 41.213,
      exportSeconds: 5.127,
      peakVramMiB: 19574,
      actualResolution: 1024,
      cameraFovDegrees: 44.498,
      workerRecycle: true,
      contentType: 'model/gltf-binary',
    });
  });

  test('keeps absent numeric and boolean headers as null', () => {
    expect(extractGenerationResponseMetadata({})).toEqual({
      gatewayJobId: null,
      generationSeconds: null,
      exportSeconds: null,
      peakVramMiB: null,
      actualResolution: null,
      cameraFovDegrees: null,
      workerRecycle: null,
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
