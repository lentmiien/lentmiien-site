const { randomBytes } = require('crypto');

const DEFAULT_PIXAL3D_PARAMETERS = Object.freeze({
  seed: 42,
  resolution: 1024,
  preprocessImage: true,
  fovDegrees: 0,
  meshScale: 1,
  extendPixel: 0,
  sparseStructureSteps: 12,
  sparseStructureGuidance: 7.5,
  sparseStructureGuidanceRescale: 0.7,
  shapeSteps: 12,
  shapeGuidance: 7.5,
  shapeGuidanceRescale: 0.5,
  textureSteps: 12,
  textureGuidance: 1,
  textureGuidanceRescale: 0,
  maxNumTokens: 49152,
  decimationTarget: 300000,
  textureSize: 2048,
  dcResolution: 256,
  smoothIterations: 0,
  fillHoles: true,
});

const SUPPORTED_PIXAL3D_IMAGE_FORMATS = Object.freeze({
  jpeg: Object.freeze({ extension: '.jpg', mimeType: 'image/jpeg' }),
  png: Object.freeze({ extension: '.png', mimeType: 'image/png' }),
  webp: Object.freeze({ extension: '.webp', mimeType: 'image/webp' }),
});

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function lastFieldValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value[value.length - 1] : undefined;
  }
  return value;
}

function parseNumberField(body, field, label, fallback, { integer = false, min, max, choices } = {}) {
  const raw = lastFieldValue(body?.[field]);
  const value = raw === undefined || raw === null || String(raw).trim() === ''
    ? fallback
    : Number(raw);

  if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
    throw validationError(`${label} must be ${integer ? 'an integer' : 'a number'}.`);
  }
  if (Array.isArray(choices) && !choices.includes(value)) {
    throw validationError(`${label} must be one of: ${choices.join(', ')}.`);
  }
  if (min !== undefined && value < min) {
    throw validationError(`${label} must be at least ${min}.`);
  }
  if (max !== undefined && value > max) {
    throw validationError(`${label} must be at most ${max}.`);
  }
  return value;
}

function parseBooleanField(body, field, label, fallback) {
  const raw = lastFieldValue(body?.[field]);
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;

  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'off', 'no'].includes(normalized)) return false;
  throw validationError(`${label} must be true or false.`);
}

function normalizePixal3dParameters(body = {}) {
  const fovDegrees = parseNumberField(
    body,
    'fov_degrees',
    'Camera FOV',
    DEFAULT_PIXAL3D_PARAMETERS.fovDegrees,
    { min: 0, max: 120 },
  );
  if (fovDegrees !== 0 && fovDegrees < 5) {
    throw validationError('Camera FOV must be 0 for automatic estimation or between 5 and 120 degrees.');
  }

  return {
    seed: parseNumberField(body, 'seed', 'Seed', DEFAULT_PIXAL3D_PARAMETERS.seed, {
      integer: true,
      min: 0,
      max: 2147483647,
    }),
    resolution: parseNumberField(body, 'resolution', 'Resolution', DEFAULT_PIXAL3D_PARAMETERS.resolution, {
      integer: true,
      choices: [1024, 1536],
    }),
    preprocessImage: parseBooleanField(
      body,
      'preprocess_image',
      'Preprocess image',
      DEFAULT_PIXAL3D_PARAMETERS.preprocessImage,
    ),
    fovDegrees,
    meshScale: parseNumberField(body, 'mesh_scale', 'Mesh scale', DEFAULT_PIXAL3D_PARAMETERS.meshScale, {
      min: 0.25,
      max: 4,
    }),
    extendPixel: parseNumberField(body, 'extend_pixel', 'Extend pixel', DEFAULT_PIXAL3D_PARAMETERS.extendPixel, {
      integer: true,
      min: -128,
      max: 128,
    }),
    sparseStructureSteps: parseNumberField(
      body,
      'sparse_structure_steps',
      'Sparse structure steps',
      DEFAULT_PIXAL3D_PARAMETERS.sparseStructureSteps,
      { integer: true, min: 1, max: 50 },
    ),
    sparseStructureGuidance: parseNumberField(
      body,
      'sparse_structure_guidance',
      'Sparse structure guidance',
      DEFAULT_PIXAL3D_PARAMETERS.sparseStructureGuidance,
      { min: 0, max: 30 },
    ),
    sparseStructureGuidanceRescale: parseNumberField(
      body,
      'sparse_structure_guidance_rescale',
      'Sparse structure guidance rescale',
      DEFAULT_PIXAL3D_PARAMETERS.sparseStructureGuidanceRescale,
      { min: 0, max: 1 },
    ),
    shapeSteps: parseNumberField(body, 'shape_steps', 'Shape steps', DEFAULT_PIXAL3D_PARAMETERS.shapeSteps, {
      integer: true,
      min: 1,
      max: 50,
    }),
    shapeGuidance: parseNumberField(
      body,
      'shape_guidance',
      'Shape guidance',
      DEFAULT_PIXAL3D_PARAMETERS.shapeGuidance,
      { min: 0, max: 30 },
    ),
    shapeGuidanceRescale: parseNumberField(
      body,
      'shape_guidance_rescale',
      'Shape guidance rescale',
      DEFAULT_PIXAL3D_PARAMETERS.shapeGuidanceRescale,
      { min: 0, max: 1 },
    ),
    textureSteps: parseNumberField(
      body,
      'texture_steps',
      'Texture steps',
      DEFAULT_PIXAL3D_PARAMETERS.textureSteps,
      { integer: true, min: 1, max: 50 },
    ),
    textureGuidance: parseNumberField(
      body,
      'texture_guidance',
      'Texture guidance',
      DEFAULT_PIXAL3D_PARAMETERS.textureGuidance,
      { min: 0, max: 30 },
    ),
    textureGuidanceRescale: parseNumberField(
      body,
      'texture_guidance_rescale',
      'Texture guidance rescale',
      DEFAULT_PIXAL3D_PARAMETERS.textureGuidanceRescale,
      { min: 0, max: 1 },
    ),
    maxNumTokens: parseNumberField(
      body,
      'max_num_tokens',
      'Maximum token count',
      DEFAULT_PIXAL3D_PARAMETERS.maxNumTokens,
      { integer: true, min: 8192, max: 100000 },
    ),
    decimationTarget: parseNumberField(
      body,
      'decimation_target',
      'Decimation target',
      DEFAULT_PIXAL3D_PARAMETERS.decimationTarget,
      { integer: true, min: 10000, max: 1000000 },
    ),
    textureSize: parseNumberField(
      body,
      'texture_size',
      'Texture size',
      DEFAULT_PIXAL3D_PARAMETERS.textureSize,
      { integer: true, choices: [1024, 2048, 4096] },
    ),
    dcResolution: parseNumberField(
      body,
      'dc_resolution',
      'Dual-contouring resolution',
      DEFAULT_PIXAL3D_PARAMETERS.dcResolution,
      { integer: true, choices: [128, 192, 256] },
    ),
    smoothIterations: parseNumberField(
      body,
      'smooth_iterations',
      'Smooth iterations',
      DEFAULT_PIXAL3D_PARAMETERS.smoothIterations,
      { integer: true, min: 0, max: 20 },
    ),
    fillHoles: parseBooleanField(body, 'fill_holes', 'Fill holes', DEFAULT_PIXAL3D_PARAMETERS.fillHoles),
  };
}

function randomAssetFileName(extension) {
  const normalizedExtension = String(extension || '').toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(normalizedExtension)) {
    throw new Error('A safe file extension is required.');
  }
  return `${randomBytes(32).toString('hex')}${normalizedExtension}`;
}

function userIdentity(user = {}) {
  return {
    id: user?._id?.toString?.() || (typeof user?.id === 'string' ? user.id : ''),
    name: typeof user?.name === 'string' ? user.name : '',
  };
}

function buildPixal3dOwnerQuery(user) {
  const identity = userIdentity(user);
  if (identity.id) return { 'owner.id': identity.id };
  if (identity.name) return { 'owner.name': identity.name };
  return { _id: null };
}

function buildVisiblePixal3dJobsQuery(user) {
  return {
    $or: [
      buildPixal3dOwnerQuery(user),
      { shared: true },
    ],
  };
}

function isPixal3dJobOwner(job, user) {
  const identity = userIdentity(user);
  const ownerId = job?.owner?.id ? String(job.owner.id) : '';
  const ownerName = job?.owner?.name ? String(job.owner.name) : '';
  if (ownerId && identity.id) return ownerId === identity.id;
  return Boolean(ownerName && identity.name && ownerName === identity.name);
}

function validateGlbHeader(header, actualSize) {
  if (!Buffer.isBuffer(header) || header.length < 12) {
    throw new Error('The generated model is not a complete GLB file.');
  }
  if (header.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('The generated model does not have a valid GLB signature.');
  }
  const version = header.readUInt32LE(4);
  const declaredLength = header.readUInt32LE(8);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}.`);
  if (Number.isFinite(actualSize) && declaredLength !== actualSize) {
    throw new Error('The generated GLB file length does not match its header.');
  }
  return { version, declaredLength };
}

module.exports = {
  DEFAULT_PIXAL3D_PARAMETERS,
  SUPPORTED_PIXAL3D_IMAGE_FORMATS,
  buildPixal3dOwnerQuery,
  buildVisiblePixal3dJobsQuery,
  isPixal3dJobOwner,
  normalizePixal3dParameters,
  randomAssetFileName,
  userIdentity,
  validateGlbHeader,
};
