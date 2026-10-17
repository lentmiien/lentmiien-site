#!/usr/bin/env node
// Local trusted administration only. Secrets are printed only for explicit token issuance.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { service } = require('../services/localAi');
const Role = require('../models/role');
const User = require('../models/useraccount');
const logger = require('../utils/logger');
const Turn = require('../models/codex_turn');
const DURABLE = { writeConcern: { w: 'majority', j: true } };
const { CAP, ID, problem } = require('../services/localAi/policy');
async function main(argv) {
  const [command, actor, subject, argument, proof] = argv;
  let actorId = actor;
  if (!['rollback-check', 'initialize', 'initialize-by-name', 'grant-capability', 'issue-token', 'revoke-token', 'reconcile-activity', 'fence-coordinator'].includes(command)) throw problem('invalid_admin_command', 400);
  if (command === 'initialize-by-name' && (argv.length !== 2 || typeof actor !== 'string'
    || !actor.trim() || actor.length > 100 || /[\x00-\x1f\x7f]/.test(actor))) throw problem('invalid_admin_name', 400);
  await mongoose.connect(process.env.MONGOOSE_URL, { serverSelectionTimeoutMS: 10000, bufferCommands: false });
  if (command === 'initialize-by-name') {
    // Names are not unique in the legacy schema. Fail closed on any duplicate,
    // including a non-admin duplicate; never normalize or match a display name.
    const users = await User.find({ name: actor }).collation({ locale: 'simple' }).select('_id').limit(2).lean();
    if (users.length !== 1) throw problem('admin_name_not_unique', 403);
    actorId = String(users[0]._id);
  }
  const principal = await service.principal(actorId, null, CAP.manage);
  if (command === 'initialize-by-name' && (principal?.type_user !== 'admin' || principal.name !== actor)) throw problem('validated_admin_required', 403);
  await service.initialize();
  if (command === 'rollback-check') {
    const result = await require('../services/localAi/compatibility').assertRollbackCompatible(service.db, subject);
    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (command === 'initialize' || command === 'initialize-by-name') {
    await service.reconcileCapacity();
    process.stdout.write('Local AI indexes ready; safe terminal admission slots reconciled; all history retained.\n');
  } else if (command === 'grant-capability') {
    if (![CAP.use, CAP.manage, CAP.importShared, 'chat.conversation.read', 'chat.conversation.write'].includes(argument)) throw problem('unsupported_capability');
    const user = await User.findById(subject).select('name').lean();
    if (!user) throw problem('user_not_found', 404);
    await Role.updateOne({ name: user.name, type: 'user' }, { $addToSet: { permissions: argument } }, { upsert: true });
    process.stdout.write('Capability granted.\n');
  } else if (command === 'fence-coordinator') {
    if (!ID.test(subject) || argument !== '--old-coordinator-terminated' || proof !== 'CONFIRMED') throw problem('operator_must_prove_old_coordinator_terminated');
    const result = await service.db.Control.updateOne({ _id: 'scheduler', holder: subject }, {
      $set: { holder: null, leaseUntil: new Date(0), ownerHost: null, ownerPid: null, ownerProcessStart: null }, $inc: { fence: 1 },
    });
    if (!result.matchedCount) throw problem('coordinator_changed', 409);
    process.stdout.write('Terminated coordinator fenced; existing manifest retained.\n');
  } else if (command === 'issue-token') {
    const token = await service.issueToken(subject, argument || 'local-tool', 30, proof === '--shared-import' ? [CAP.use, CAP.importShared] : [CAP.use]);
    process.stdout.write(JSON.stringify(token) + '\n');
  } else if (command === 'revoke-token') {
    if (!ID.test(subject)) throw problem('invalid_token_id');
    const result = await service.db.Token.updateOne({ _id: subject }, { $set: { revokedAt: new Date() } });
    process.stdout.write(JSON.stringify({ revoked: result.matchedCount === 1 }) + '\n');
  } else {
    if (argument !== '--old-coordinator-and-agent-terminated' || proof !== 'CONFIRMED') throw problem('operator_must_prove_old_coordinator_and_entire_agent_tree_terminated');
    const turn = await Turn.findById(subject).lean();
    if (!turn?.batchActivity) throw problem('activity_not_found', 404);
    const association = turn.batchActivity;
    const list = await service.gateway.request('GET', '/batch/activities');
    const remote = list.activities.find(a => a.id === association.id);
    if (!remote) throw problem('activity_missing_do_not_assume_released', 409);
    if (remote.status === 'active') {
      // New coordinator is deterministic across lost recovery replies. Never steal merely stale ownership.
      const coordinator = `reconcile_${association.id}`;
      let generation = remote.generation;
      if (remote.coordinator_id !== coordinator) {
        const recovered = await service.gateway.request('POST', `/batch/activities/${association.id}/recover`, {
          coordinator_id: coordinator, generation, previous_coordinator_terminated: true,
        });
        generation = recovered.generation;
      }
      await Turn.updateOne({ _id: subject }, { $set: { batchActivity: { ...association, coordinatorId: coordinator, generation, terminationProven: true, state: 'release_pending' } } }, DURABLE);
      await service.gateway.request('POST', `/batch/activities/${association.id}/release`, { coordinator_id: coordinator, generation, agent_terminated: true });
    }
    await Turn.updateOne({ _id: subject }, { $set: { 'batchActivity.state': 'released', 'batchActivity.terminationProven': true } }, DURABLE);
    process.stdout.write('Activity release reconciled.\n');
  }
  logger.notice('Local AI administration completed', { category: 'local_ai', metadata: { command, actorId } });
}
function reportFailure(error) {
  // Driver/provider errors can contain credentials or account input, even in code.
  const safeCodes = new Set(['invalid_admin_command', 'invalid_admin_name', 'admin_name_not_unique', 'validated_admin_required',
    'rollback_requires_site_phase2', 'rollback_requires_site_phase1', 'invalid_rollback_target',
    'unauthorized', 'forbidden', 'unsupported_capability', 'user_not_found', 'invalid_token_id', 'invalid_token_request',
    'operator_must_prove_old_coordinator_terminated', 'coordinator_changed',
    'operator_must_prove_old_coordinator_and_entire_agent_tree_terminated', 'activity_not_found',
    'activity_missing_do_not_assume_released', 'batch_auth_unconfigured', 'invalid_gateway_origin', 'gateway_unreachable']);
  const code = safeCodes.has(error?.code) ? error.code : 'administration_failed';
  logger.error('Local AI administration failed', { category: 'local_ai', metadata: { code } });
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
}
if (require.main === module) main(process.argv.slice(2)).catch(reportFailure).finally(() => mongoose.disconnect()).catch(reportFailure);
module.exports = { main, reportFailure };
