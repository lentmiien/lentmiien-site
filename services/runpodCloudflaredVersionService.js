const { RunpodCloudflaredCatalog, RoleModel } = require('../database');
const logger = require('../utils/logger');
const { hasCapabilities } = require('../utils/authorization');
const { RUNPOD_CAPABILITIES, RUNPOD_ROLE_CAPABILITY_BUNDLES } = require('../utils/runpodAuthorizationPolicy');
const {
  CLOUDFLARED_VERSION_OPTIONS,
  CLOUDFLARED_VERSION_PATTERN,
  DEFAULT_CLOUDFLARED_VERSION,
  MAX_CLOUDFLARED_RELEASES,
  cloudflaredRelease,
} = require('./runpodCloudflaredCatalog');

const CATALOG_ID = 'cloudflared';
const initialCatalog = () => ({
  defaultVersion: DEFAULT_CLOUDFLARED_VERSION,
  releases: CLOUDFLARED_VERSION_OPTIONS.map((version) => {
    const release = cloudflaredRelease(version);
    return { version, sha256: release.sha256 };
  }),
});

function catalogError(code, status = 400) {
  const error = new Error('The Cloudflare Tunnel catalog operation could not be completed.');
  error.code = code;
  error.status = status;
  return error;
}

function normalizeVersion(value) {
  if (typeof value !== 'string' || value.length > 12 || !CLOUDFLARED_VERSION_PATTERN.test(value)) {
    throw catalogError('RUNPOD_INPUT_INVALID');
  }
  return value;
}

function catalogForUse(document) {
  const source = document || initialCatalog();
  const releases = source.releases;
  if (!Array.isArray(releases) || !releases.length || releases.length > MAX_CLOUDFLARED_RELEASES
    || new Set(releases.map((release) => release.version)).size !== releases.length
    || !releases.some((release) => release.version === source.defaultVersion)) {
    throw catalogError('RUNPOD_CLOUDFLARED_CATALOG_INVALID', 503);
  }
  try {
    return {
      defaultVersion: source.defaultVersion,
      releases: releases.map(({ version, sha256 }) => {
        // Stored rows must have a checksum; never fall back for a malformed row.
        const release = cloudflaredRelease(normalizeVersion(version), sha256 ?? null);
        return { version: release.version, sha256: release.sha256 };
      }).sort((left, right) => right.version.localeCompare(left.version, 'en', { numeric: true })),
    };
  } catch (_) {
    throw catalogError('RUNPOD_CLOUDFLARED_CATALOG_INVALID', 503);
  }
}

class RunpodCloudflaredVersionService {
  constructor({ model = RunpodCloudflaredCatalog, roleModel = RoleModel, appLogger = logger } = {}) {
    this.model = model;
    this.roleModel = roleModel;
    this.logger = appLogger;
  }

  async getCatalog() {
    try {
      return catalogForUse(await this.model.findById(CATALOG_ID, null, { maxTimeMS: 5000 }).lean());
    } catch (error) {
      this.logger.error('Cloudflare Tunnel version catalog could not be loaded', {
        category: 'runpod_management', metadata: { operation: 'cloudflared_catalog_read' },
      });
      throw catalogError('RUNPOD_CLOUDFLARED_CATALOG_UNAVAILABLE', 503);
    }
  }

  async resolveRelease(version) {
    if (version !== undefined) normalizeVersion(version);
    const catalog = await this.getCatalog();
    const selected = catalog.releases.find((release) => release.version === (version ?? catalog.defaultVersion));
    if (!selected) throw catalogError('RUNPOD_CLOUDFLARED_VERSION_MISSING', 409);
    return cloudflaredRelease(selected.version, selected.sha256);
  }

  async mutate(action, input, principal) {
    if (!await hasCapabilities(principal, [RUNPOD_CAPABILITIES.cloudflareVersionsManage], {
      roleModel: this.roleModel, roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES,
    })) throw catalogError('RUNPOD_FORBIDDEN', 403);
    if (!['add', 'delete', 'default'].includes(action)) throw catalogError('RUNPOD_INPUT_INVALID');
    const allowed = action === 'add' ? ['version', 'sha256', '_csrf'] : ['version', '_csrf'];
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some((key) => !allowed.includes(key))) throw catalogError('RUNPOD_INPUT_INVALID');
    const version = normalizeVersion(input.version);
    const sha256 = action === 'add' && typeof input.sha256 === 'string' && input.sha256.length === 64
      ? input.sha256.toLowerCase() : null;
    if (action === 'add') cloudflaredRelease(version, sha256);
    const catalog = await this.getCatalog();
    const exists = catalog.releases.some((release) => release.version === version);
    if (action === 'add' && exists) throw catalogError('RUNPOD_CLOUDFLARED_VERSION_EXISTS', 409);
    if (action === 'add' && catalog.releases.length >= MAX_CLOUDFLARED_RELEASES) {
      throw catalogError('RUNPOD_CLOUDFLARED_CATALOG_FULL', 409);
    }
    if (action !== 'add' && !exists) throw catalogError('RUNPOD_CLOUDFLARED_VERSION_MISSING', 409);
    if (action === 'delete' && version === catalog.defaultVersion) {
      throw catalogError('RUNPOD_CLOUDFLARED_DEFAULT_REQUIRED', 409);
    }
    try {
      // Seed only once, on a mutation. The fixed _id makes concurrent initialization safe.
      try {
        await this.model.updateOne({ _id: CATALOG_ID }, { $setOnInsert: initialCatalog() }, {
          upsert: true, runValidators: true, maxTimeMS: 5000,
        });
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
      let filter = { _id: CATALOG_ID, 'releases.version': version };
      let update;
      if (action === 'add') {
        filter = { _id: CATALOG_ID, 'releases.version': { $ne: version },
          [`releases.${MAX_CLOUDFLARED_RELEASES - 1}`]: { $exists: false } };
        update = { $push: { releases: { version, sha256 } } };
      } else if (action === 'delete') {
        filter.defaultVersion = { $ne: version };
        update = { $pull: { releases: { version } } };
      } else {
        update = { $set: { defaultVersion: version } };
      }
      const updated = await this.model.findOneAndUpdate(filter, update, {
        new: true, runValidators: true, maxTimeMS: 5000,
      }).lean();
      if (!updated) throw catalogError('RUNPOD_CLOUDFLARED_CATALOG_CONFLICT', 409);
      return catalogForUse(updated);
    } catch (error) {
      if (error?.status === 409) throw error;
      this.logger.error('Cloudflare Tunnel version catalog could not be saved', {
        category: 'runpod_management', metadata: { operation: `cloudflared_catalog_${action}` },
      });
      throw catalogError('RUNPOD_CLOUDFLARED_CATALOG_UNAVAILABLE', 503);
    }
  }
}

module.exports = {
  RunpodCloudflaredVersionService,
  runpodCloudflaredVersionService: new RunpodCloudflaredVersionService(),
  initialCatalog,
};
