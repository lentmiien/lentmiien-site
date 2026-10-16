const { randomUUID } = require('crypto');
const Turn = require('../../models/codex_turn');
const { Gateway, config } = require('./gateway');
const { problem } = require('./policy');
const DURABLE = { writeConcern: { w: 'majority', j: true } };
const logger = require('../../utils/logger');
class CodexActivity {
  constructor({ gateway = new Gateway(), turnModel = Turn } = {}) { this.gateway = gateway; this.Turn = turnModel; }
  async begin(turnId, coordinatorId) {
    if (!config().enabled) return null;
    // Registration is deliberately before any reservation or local model launch, and fails closed.
    const association = { id: `codex_${randomUUID()}`, coordinatorId, generation: 1, state: 'registering' };
    const turn = await this.Turn.findOneAndUpdate({ _id: turnId, batchActivity: null }, { $set: { batchActivity: association } }, { returnDocument: 'after', ...DURABLE }).lean();
    if (!turn) throw problem('codex_activity_requires_reconciliation', 409);
    const activity = await this.gateway.request('PUT', `/batch/activities/${association.id}`, { coordinator_id: coordinatorId });
    if (activity.status !== 'active' || activity.coordinator_id !== coordinatorId || activity.generation !== 1) throw problem('activity_owner_conflict', 409);
    await this.Turn.updateOne({ _id: turnId, 'batchActivity.id': association.id }, { $set: { 'batchActivity.state': 'active' } }, DURABLE);
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await this.gateway.request('POST', `/batch/activities/${association.id}/heartbeat`, { coordinator_id: coordinatorId, generation: 1 });
      } catch (error) {
        logger.warning('Codex batch activity heartbeat failed; ownership remains held', { category: 'local_ai', metadata: { turnId, code: error.code || 'unavailable' } });
      } finally { busy = false; }
    }, 30000);
    timer.unref?.();
    return { ...association, timer, turnId };
  }
  async finish(activity, terminationProven) {
    if (!activity) return;
    clearInterval(activity.timer);
    if (!terminationProven) {
      await this.Turn.updateOne({ _id: activity.turnId, 'batchActivity.id': activity.id }, { $set: { 'batchActivity.state': 'needs_review' } }, DURABLE);
      logger.warning('Codex activity retained: process-tree termination needs operator proof', { category: 'local_ai', metadata: { turnId: activity.turnId, activityId: activity.id } });
      return;
    }
    // Persist proof before release; a lost response is reconciled with the activity list, never a new ID.
    await this.Turn.updateOne({ _id: activity.turnId, 'batchActivity.id': activity.id }, { $set: { 'batchActivity.terminationProven': true, 'batchActivity.state': 'release_pending' } }, DURABLE);
    await this.gateway.request('POST', `/batch/activities/${activity.id}/release`, { coordinator_id: activity.coordinatorId, generation: activity.generation, agent_terminated: true });
    await this.Turn.updateOne({ _id: activity.turnId, 'batchActivity.id': activity.id }, { $set: { 'batchActivity.state': 'released' } }, DURABLE);
  }
  async reconcileProven() {
    if (!this.gateway.configured()) return;
    const turns = await this.Turn.find({ 'batchActivity.state': 'release_pending', 'batchActivity.terminationProven': true }).limit(50).lean();
    if (!turns.length) return;
    const remote = await this.gateway.request('GET', '/batch/activities');
    for (const turn of turns) {
      const a = turn.batchActivity; const found = remote.activities.find(entry => entry.id === a.id);
      if (!found || found.generation !== a.generation || found.coordinator_id !== a.coordinatorId) continue;
      if (found.status !== 'released') await this.gateway.request('POST', `/batch/activities/${a.id}/release`, { coordinator_id: a.coordinatorId, generation: a.generation, agent_terminated: true });
      await this.Turn.updateOne({ _id: turn._id, 'batchActivity.id': a.id }, { $set: { 'batchActivity.state': 'released' } }, DURABLE);
    }
  }
}
module.exports = { CodexActivity };
