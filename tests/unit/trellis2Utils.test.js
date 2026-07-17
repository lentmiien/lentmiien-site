const {
  DEFAULT_TRELLIS2_PARAMETERS,
  buildTrellis2OwnerQuery,
  buildVisibleTrellis2JobsQuery,
  isTrellis2JobOwner,
  normalizeTrellis2Parameters,
  randomAssetFileName,
  validateGlbHeader,
} = require('../../utils/trellis2');

describe('TRELLIS.2 utilities', () => {
  test('normalizes an empty form to the documented API defaults', () => {
    expect(normalizeTrellis2Parameters({})).toEqual(DEFAULT_TRELLIS2_PARAMETERS);
  });

  test('normalizes custom fields and uses the last checkbox value', () => {
    expect(normalizeTrellis2Parameters({
      seed: '42',
      resolution: '1024',
      preprocess_image: ['false', 'true'],
      sparse_structure_steps: '20',
      sparse_structure_guidance: '6.5',
      shape_steps: '18',
      shape_guidance: '8',
      texture_steps: '16',
      texture_guidance: '1.25',
      decimation_target: '250000',
      texture_size: '4096',
      remesh: ['false'],
    })).toEqual({
      seed: 42,
      resolution: 1024,
      preprocessImage: true,
      sparseStructureSteps: 20,
      sparseStructureGuidance: 6.5,
      shapeSteps: 18,
      shapeGuidance: 8,
      textureSteps: 16,
      textureGuidance: 1.25,
      decimationTarget: 250000,
      textureSize: 4096,
      remesh: false,
    });
  });

  test.each([
    [{ resolution: '768' }, 'Resolution must be one of'],
    [{ seed: '-1' }, 'Seed must be at least 0'],
    [{ texture_size: '512' }, 'Texture size must be one of'],
    [{ shape_steps: '2.5' }, 'Shape steps must be an integer'],
    [{ remesh: 'sometimes' }, 'Remesh must be true or false'],
  ])('rejects invalid generation parameters', (input, expectedMessage) => {
    expect(() => normalizeTrellis2Parameters(input)).toThrow(expectedMessage);
  });

  test('creates 256-bit random asset names with only the requested extension', () => {
    const first = randomAssetFileName('.glb');
    const second = randomAssetFileName('.glb');
    expect(first).toMatch(/^[a-f0-9]{64}\.glb$/);
    expect(second).toMatch(/^[a-f0-9]{64}\.glb$/);
    expect(second).not.toBe(first);
    expect(() => randomAssetFileName('../glb')).toThrow('safe file extension');
  });

  test('builds owner and visibility filters from the authenticated user id', () => {
    const user = { _id: { toString: () => 'user-123' }, name: 'Lennart' };
    expect(buildTrellis2OwnerQuery(user)).toEqual({ 'owner.id': 'user-123' });
    expect(buildVisibleTrellis2JobsQuery(user)).toEqual({
      $or: [{ 'owner.id': 'user-123' }, { shared: true }],
    });
  });

  test('checks ownership by immutable user id before username', () => {
    const job = { owner: { id: 'owner-1', name: 'same-name' } };
    expect(isTrellis2JobOwner(job, { _id: { toString: () => 'owner-1' }, name: 'other' })).toBe(true);
    expect(isTrellis2JobOwner(job, { _id: { toString: () => 'owner-2' }, name: 'same-name' })).toBe(false);
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
