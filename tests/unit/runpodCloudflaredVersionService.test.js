const Catalog = require('../../models/runpod_cloudflared_catalog');
const {
  RunpodCloudflaredVersionService, initialCatalog,
} = require('../../services/runpodCloudflaredVersionService');

const admin = { name: 'catalog-admin', type_user: 'admin' };
const added = { version: '2026.11.1', sha256: 'a'.repeat(64) };

function fixture(document = initialCatalog()) {
  const state = { document: structuredClone(document), beforeUpdate: null };
  const model = {
    findById: jest.fn(() => ({ lean: async () => structuredClone(state.document) })),
    updateOne: jest.fn(async (filter, update) => {
      if (!state.document) state.document = structuredClone(update.$setOnInsert);
    }),
    findOneAndUpdate: jest.fn((filter, update) => ({ lean: async () => {
      // Emulate the small set of atomic predicates, including a concurrent writer.
      if (state.beforeUpdate) { state.beforeUpdate(); state.beforeUpdate = null; }
      const doc = state.document;
      const versionFilter = filter['releases.version'];
      if (typeof versionFilter === 'string'
        && !doc.releases.some((r) => r.version === versionFilter)) return null;
      if (versionFilter.$ne && doc.releases.some((r) => r.version === versionFilter.$ne)) return null;
      if (filter['releases.49'] && doc.releases.length >= 50) return null;
      if (filter.defaultVersion?.$ne === doc.defaultVersion) return null;
      if (update.$push) doc.releases.push(structuredClone(update.$push.releases));
      if (update.$pull) doc.releases = doc.releases.filter((r) => r.version !== update.$pull.releases.version);
      if (update.$set) Object.assign(doc, update.$set);
      return structuredClone(doc);
    } })),
  };
  const roleModel = { findOne: jest.fn().mockResolvedValue(null) };
  const appLogger = { error: jest.fn(), warning: jest.fn() };
  const service = new RunpodCloudflaredVersionService({ model, roleModel, appLogger });
  return { state, model, roleModel, appLogger, service };
}

describe('database-backed Cloudflare Tunnel catalog', () => {
  test('uses initial entries without a GET write, then persists additions and reads fresh defaults', async () => {
    const f = fixture(null);
    expect(await f.service.getCatalog()).toEqual(initialCatalog());
    expect(f.model.updateOne).not.toHaveBeenCalled();
    await f.service.mutate('add', { ...added, sha256: added.sha256.toUpperCase() }, admin);
    expect(await f.service.resolveRelease(added.version)).toMatchObject(added);
    await f.service.mutate('default', { version: added.version }, admin);
    expect(await f.service.resolveRelease()).toMatchObject(added);
    await f.service.mutate('delete', { version: '2026.10.4' }, admin);
    await expect(f.service.resolveRelease('2026.10.4'))
      .rejects.toMatchObject({ code: 'RUNPOD_CLOUDFLARED_VERSION_MISSING' });
    expect((await f.service.getCatalog()).releases.map((r) => r.version)).not.toContain('2026.10.4');
    expect(f.state.document.releases).toHaveLength(2);
  });

  test.each([null, { name: 'user', type_user: 'user' }, { name: 'family', type_user: 'family' }])(
    'denies catalog writes before database work for %j', async (principal) => {
      const f = fixture();
      await expect(f.service.mutate('add', added, principal)).rejects.toMatchObject({ status: 403 });
      expect(f.model.findById).not.toHaveBeenCalled();
      expect(f.model.updateOne).not.toHaveBeenCalled();
    }
  );

  test('accepts an explicit semantic grant', async () => {
    const f = fixture();
    f.roleModel.findOne.mockResolvedValue({ permissions: ['runpod.cloudflare_versions.manage'] });
    await expect(f.service.mutate('add', added, { name: 'granted-user', type_user: 'user' }))
      .resolves.toMatchObject({ releases: expect.arrayContaining([added]) });
  });

  test.each([
    { ...added, version: '../2026.11.1' }, { ...added, version: '2026.11.1;id' },
    { ...added, version: '2026.13.1' }, { ...added, version: ['2026.11.1'] },
    { ...added, version: 'x'.repeat(2000) }, { ...added, sha256: 'a'.repeat(63) },
    { ...added, sha256: 'g'.repeat(64) }, { ...added, sha256: { $ne: null } },
    { ...added, sha256: undefined }, { ...added, downloadUrl: 'https://attacker.test' },
    { ...added, userId: 'someone-else' },
  ])('rejects malformed/extra input before database work: %j', async (input) => {
    const f = fixture();
    await expect(f.service.mutate('add', input, admin)).rejects.toMatchObject({ code: 'RUNPOD_INPUT_INVALID' });
    expect(f.model.findById).not.toHaveBeenCalled();
    expect(f.model.updateOne).not.toHaveBeenCalled();
  });

  test('rejects duplicates, deleting the default, missing versions, and full catalogs', async () => {
    const f = fixture();
    await expect(f.service.mutate('add', initialCatalog().releases[0], admin))
      .rejects.toMatchObject({ code: 'RUNPOD_CLOUDFLARED_VERSION_EXISTS' });
    await expect(f.service.mutate('delete', { version: '2026.10.4' }, admin))
      .rejects.toMatchObject({ code: 'RUNPOD_CLOUDFLARED_DEFAULT_REQUIRED' });
    await expect(f.service.mutate('default', { version: added.version }, admin))
      .rejects.toMatchObject({ code: 'RUNPOD_CLOUDFLARED_VERSION_MISSING' });
    expect(f.model.updateOne).not.toHaveBeenCalled();
    f.state.document = { defaultVersion: '2026.1.0', releases: Array.from({ length: 50 }, (_, n) => (
      { version: `2026.1.${n}`, sha256: added.sha256 }
    )) };
    await expect(f.service.mutate('add', added, admin))
      .rejects.toMatchObject({ code: 'RUNPOD_CLOUDFLARED_CATALOG_FULL' });
  });

  test.each(['add', 'default', 'delete'])('guards atomic %s against concurrent changes', async (action) => {
    const f = fixture();
    const target = action === 'add' ? added : { version: '2026.8.3' };
    f.state.beforeUpdate = () => {
      if (action === 'add') f.state.document.releases.push(added);
      if (action === 'default') f.state.document.releases.pop();
      if (action === 'delete') f.state.document.defaultVersion = target.version;
    };
    await expect(f.service.mutate(action, target, admin))
      .rejects.toMatchObject({ code: 'RUNPOD_CLOUDFLARED_CATALOG_CONFLICT' });
    const doc = f.state.document;
    expect(doc.releases.some((r) => r.version === doc.defaultVersion)).toBe(true);
    expect(new Set(doc.releases.map((r) => r.version)).size).toBe(doc.releases.length);
  });

  test('survives a concurrent singleton insert', async () => {
    const f = fixture();
    f.model.updateOne.mockRejectedValueOnce({ code: 11000 });
    await expect(f.service.mutate('add', added, admin)).resolves.toBeDefined();
    expect(f.model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'cloudflared', 'releases.version': { $ne: added.version }, 'releases.49': { $exists: false } },
      { $push: { releases: added } }, expect.objectContaining({ runValidators: true })
    );
  });

  test('database errors fail closed and log no submitted or provider data', async () => {
    const f = fixture();
    f.model.findById.mockReturnValueOnce({ lean: async () => { throw new Error('private-db-details'); } });
    await expect(f.service.resolveRelease()).rejects.toMatchObject({ status: 503 });
    f.model.updateOne.mockRejectedValueOnce(new Error('private-write-details'));
    await expect(f.service.mutate('add', added, admin)).rejects.toMatchObject({ status: 503 });
    expect(f.appLogger.error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.appLogger.error.mock.calls)).not.toMatch(/private-|aaaa/);
  });

  test.each([
    { defaultVersion: '2026.1.1', releases: [] },
    { defaultVersion: '2026.1.1', releases: [added] },
    { defaultVersion: added.version, releases: [added, added] },
    { defaultVersion: added.version, releases: [{ version: added.version }] },
  ])('rejects corrupt stored catalogs without seed fallback: %j', async (document) => {
    const f = fixture(document);
    await expect(f.service.getCatalog()).rejects.toMatchObject({ status: 503 });
    expect(f.model.updateOne).not.toHaveBeenCalled();
  });

  test('schema validates the default, duplicates, checksums and capacity', async () => {
    await expect(new Catalog(initialCatalog()).validate()).resolves.toBeUndefined();
    await expect(new Catalog({ ...initialCatalog(), defaultVersion: added.version }).validate()).rejects.toThrow();
    await expect(new Catalog({ defaultVersion: added.version, releases: [added, added] }).validate()).rejects.toThrow();
    await expect(new Catalog({ defaultVersion: added.version, releases: [{ ...added, sha256: 'invalid' }] }).validate()).rejects.toThrow();
    expect(Catalog.collection.collectionName).toBe('runpod_cloudflared_catalogs');
  });
});
