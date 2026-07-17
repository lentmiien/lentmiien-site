const {
  DEFAULT_PIXAL3D_PARAMETERS,
  buildPixal3dOwnerQuery,
  buildVisiblePixal3dJobsQuery,
  isPixal3dJobOwner,
  normalizePixal3dParameters,
  randomAssetFileName,
  validateGlbHeader,
} = require('../../utils/pixal3d');

describe('Pixal3D utilities', () => {
  test('normalizes an empty form to the documented API defaults', () => {
    expect(normalizePixal3dParameters({})).toEqual(DEFAULT_PIXAL3D_PARAMETERS);
  });

  test('normalizes every custom multipart field and uses the last checkbox value', () => {
    expect(normalizePixal3dParameters({
      seed: '123',
      resolution: '1536',
      preprocess_image: ['false', 'true'],
      fov_degrees: '35.5',
      mesh_scale: '1.25',
      extend_pixel: '-12',
      sparse_structure_steps: '18',
      sparse_structure_guidance: '8.5',
      sparse_structure_guidance_rescale: '0.8',
      shape_steps: '20',
      shape_guidance: '9',
      shape_guidance_rescale: '0.6',
      texture_steps: '16',
      texture_guidance: '2.25',
      texture_guidance_rescale: '0.2',
      max_num_tokens: '60000',
      decimation_target: '25000',
      texture_size: '4096',
      dc_resolution: '192',
      smooth_iterations: '3',
      fill_holes: ['false'],
    })).toEqual({
      seed: 123,
      resolution: 1536,
      preprocessImage: true,
      fovDegrees: 35.5,
      meshScale: 1.25,
      extendPixel: -12,
      sparseStructureSteps: 18,
      sparseStructureGuidance: 8.5,
      sparseStructureGuidanceRescale: 0.8,
      shapeSteps: 20,
      shapeGuidance: 9,
      shapeGuidanceRescale: 0.6,
      textureSteps: 16,
      textureGuidance: 2.25,
      textureGuidanceRescale: 0.2,
      maxNumTokens: 60000,
      decimationTarget: 25000,
      textureSize: 4096,
      dcResolution: 192,
      smoothIterations: 3,
      fillHoles: false,
    });
  });

  test.each([0, 5, 120])('accepts documented camera FOV boundary %s', (fovDegrees) => {
    expect(normalizePixal3dParameters({ fov_degrees: String(fovDegrees) }).fovDegrees).toBe(fovDegrees);
  });

  test.each([10000, 1000000])('accepts decimation target boundary %i', (decimationTarget) => {
    expect(normalizePixal3dParameters({
      decimation_target: String(decimationTarget),
    }).decimationTarget).toBe(decimationTarget);
  });

  test.each([
    [{ resolution: '512' }, 'Resolution must be one of'],
    [{ seed: '-1' }, 'Seed must be at least 0'],
    [{ fov_degrees: '4.99' }, 'Camera FOV must be 0'],
    [{ fov_degrees: '121' }, 'Camera FOV must be at most 120'],
    [{ mesh_scale: '0.24' }, 'Mesh scale must be at least 0.25'],
    [{ extend_pixel: '129' }, 'Extend pixel must be at most 128'],
    [{ sparse_structure_guidance_rescale: '1.01' }, 'rescale must be at most 1'],
    [{ max_num_tokens: '8191' }, 'Maximum token count must be at least 8192'],
    [{ decimation_target: '9999' }, 'Decimation target must be at least 10000'],
    [{ decimation_target: '1000001' }, 'Decimation target must be at most 1000000'],
    [{ texture_size: '512' }, 'Texture size must be one of'],
    [{ dc_resolution: '200' }, 'Dual-contouring resolution must be one of'],
    [{ smooth_iterations: '2.5' }, 'Smooth iterations must be an integer'],
    [{ fill_holes: 'sometimes' }, 'Fill holes must be true or false'],
  ])('rejects invalid generation parameters', (input, expectedMessage) => {
    expect(() => normalizePixal3dParameters(input)).toThrow(expectedMessage);
  });

  test('creates 256-bit random asset names with only the requested extension', () => {
    const first = randomAssetFileName('.glb');
    const second = randomAssetFileName('.glb');
    expect(first).toMatch(/^[a-f0-9]{64}\.glb$/);
    expect(second).toMatch(/^[a-f0-9]{64}\.glb$/);
    expect(second).not.toBe(first);
    expect(() => randomAssetFileName('../glb')).toThrow('safe file extension');
  });

  test('builds owner and shared-job visibility filters from the authenticated user id', () => {
    const user = { _id: { toString: () => 'user-123' }, name: 'Lennart' };
    expect(buildPixal3dOwnerQuery(user)).toEqual({ 'owner.id': 'user-123' });
    expect(buildVisiblePixal3dJobsQuery(user)).toEqual({
      $or: [{ 'owner.id': 'user-123' }, { shared: true }],
    });
  });

  test('checks ownership by immutable user id before username', () => {
    const job = { owner: { id: 'owner-1', name: 'same-name' } };
    expect(isPixal3dJobOwner(job, { _id: { toString: () => 'owner-1' }, name: 'other' })).toBe(true);
    expect(isPixal3dJobOwner(job, { _id: { toString: () => 'owner-2' }, name: 'same-name' })).toBe(false);
  });

  test('validates the GLB v2 signature and declared file size', () => {
    const header = Buffer.alloc(12);
    header.write('glTF', 0, 'ascii');
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(128, 8);
    expect(validateGlbHeader(header, 128)).toEqual({ version: 2, declaredLength: 128 });

    expect(() => validateGlbHeader(header, 127)).toThrow('length does not match');
    header.write('nope', 0, 'ascii');
    expect(() => validateGlbHeader(header, 128)).toThrow('valid GLB signature');
  });
});
