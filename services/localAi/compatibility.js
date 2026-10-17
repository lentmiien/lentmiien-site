const { problem } = require('./policy');
async function assertRollbackCompatible(db, target) {
  if (!['v1', 'phase1'].includes(target)) throw problem('invalid_rollback_target');
  if ((db.Session && await db.Session.exists({})) || (db.SessionRequest && await db.SessionRequest.exists({}))) throw problem('rollback_requires_site_sessions', 409);
  // Inspect retained content as well as unfinished work. Flags and successful
  // ACKs do not make an older reader understand a newer record or private file.
  const workflow = await db.Job.exists({ $or: [{ type: 'comfy.workflow' }, { 'result.artifacts.0': { $exists: true } }] });
  const budgets = await db.Run.exists({ 'wire.operation_budgets': { $exists: true } });
  const outputs = await db.OutputQuota.exists({ 'allocations.0': { $exists: true } });
  if (workflow || budgets || outputs) throw problem('rollback_requires_site_phase2', 409);
  if (target === 'v1' && (await db.Input.exists({}) || await db.Job.exists({ schemaVersion: 2 }) || await db.Run.exists({ 'wire.schema_version': 2 }))) throw problem('rollback_requires_site_phase1', 409);
  return { compatible: true, target };
}
module.exports = { assertRollbackCompatible };
