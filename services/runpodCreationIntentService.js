const { randomUUID } = require('crypto');
const Intent = require('../models/runpod_creation_intent');
const logger = require('../utils/logger');
const { RunpodApiError } = require('./runpodApiV2Service');
const CORRELATION_ENV = 'LENTMIIEN_CREATION_OPERATION';
const RECOVERY_LEASE_MS = 10 * 60_000;

class RunpodCreationIntentService {
  constructor({ model = Intent, appLogger = logger, now = () => new Date() } = {}) {
    this.model = model;
    this.logger = appLogger;
    this.now = now;
    this.active = new Set();
  }

  async begin(kind, name, intendedStopAt = null) {
    const token = randomUUID();
    const intent = { _id: kind, token, providerName: kind === 'volume'
      ? `${name.slice(0, 80)}-${token}` : name, providerId: null,
    intendedStopAt, cleanupRequestedAt: null, state: 'pending', startedAt: this.now() };
    try {
      const record = await this.model.findOneAndUpdate(
        { _id: kind, state: 'resolved' }, { $set: intent },
        { upsert: true, new: true, runValidators: true }
      );
      if (!record) throw new Error('Intent was not persisted');
      this.active.add(token);
      return intent;
    } catch (error) {
      if (error.code === 11000) throw new RunpodApiError(
        'A previous Runpod creation is pending or unknown. Reconcile its exact operation before creating another resource.',
        { code: 'RUNPOD_CREATION_UNRESOLVED', status: 409 }
      );
      this.logger.error('Runpod creation intent could not be persisted; billable request blocked', {
        category: 'runpod_management', metadata: { resourceKind: kind },
      });
      throw new RunpodApiError('Runpod creation safeguards could not be saved.', { code: 'RUNPOD_INTENT_PERSIST_FAILED' });
    }
  }

  payload(intent, input) {
    return intent._id === 'pod'
      ? { ...input, env: { ...input.env, [CORRELATION_ENV]: intent.token } }
      : { ...input, name: intent.providerName };
  }

  async update(intent, fields) {
    const result = await this.model.updateOne({ _id: intent._id, token: intent.token }, { $set: fields });
    if (result?.matchedCount !== 1) throw new Error('Creation intent changed');
  }

  async observed(intent, resource) {
    if (!resource?.id) throw new Error('Creation response missing ID');
    await this.update(intent, { providerId: resource.id });
    intent.providerId = resource.id;
  }

  async complete(intent) {
    await this.update(intent, { state: 'resolved' });
    this.active.delete(intent.token);
  }

  async failed(intent, error) {
    this.active.delete(intent.token);
    // A received rejection is definitive; timeouts, malformed success, 5xx and
    // local persistence errors are not. Never resubmit the original mutation.
    const rejected = !intent.providerId && ([400, 401, 402, 403, 404, 409, 413, 422, 429].includes(error?.status)
      || ['RUNPOD_COOLDOWN', 'RUNPOD_QUEUE_FULL', 'RUNPOD_BUDGET_EXCEEDED'].includes(error?.code));
    try { await this.update(intent, { state: rejected ? 'resolved' : 'unknown' }); }
    catch (_) { /* The durable pending record still blocks new creations. */ }
    if (!rejected) this.logger.error('Runpod resource creation outcome unknown; reconciliation required', {
      category: 'runpod_management', metadata: { resourceKind: intent._id, operationId: intent.token },
    });
  }

  pending() {
    return this.model.find({ state: { $ne: 'resolved' } }).limit(2).lean();
  }

  matches(intent, resource) {
    return intent._id === 'pod' ? resource?.env?.[CORRELATION_ENV] === intent.token
      : resource?.name === intent.providerName;
  }

  async reconcile({ runpodService, podModel, networkVolumeModel }) {
    for (const intent of await this.pending()) {
      if (this.active.has(intent.token) || (intent.state === 'pending'
        && this.now() - new Date(intent.startedAt) < RECOVERY_LEASE_MS)) continue;
      try {
        const pod = intent._id === 'pod';
        const list = () => pod ? runpodService.listPods() : runpodService.listNetworkVolumes({ priority: 0 });
        const get = (id) => pod ? runpodService.getPod(id) : runpodService.getNetworkVolume(id);
        const confirmedAbsent = async (id) => {
          try { await get(id); return false; } catch (error) {
            if (error.status !== 404) throw error;
            return !(await list()).some((r) => r.id === id);
          }
        };
        const resources = await list();
        const matches = resources.filter((r) => this.matches(intent, r));
        if (matches.length === 0 && intent.providerId && !resources.some((r) => r.id === intent.providerId)) {
          try {
            const known = await get(intent.providerId);
            if (known.id === intent.providerId && this.matches(intent, known)) matches.push(known);
          } catch (error) {
            if (error.status !== 404) throw error;
          }
        }
        if (matches.length !== 1) {
          if (matches.length === 0 && intent.providerId && intent.cleanupRequestedAt
            && !resources.some((r) => r.id === intent.providerId) && await confirmedAbsent(intent.providerId)) {
            await this.complete(intent);
          }
          // No match with an unknown ID is not proof of failure; eventual provider
          // creation may still finish. Keep blocking until operator reconciliation.
          continue;
        }
        const resource = matches[0];
        if (intent.providerId && intent.providerId !== resource.id) continue;
        const model = pod ? podModel : networkVolumeModel;
        const local = await model.findOne({ [pod ? 'providerPodId' : 'providerNetworkVolumeId']: resource.id }).lean();
        if (local && local.recordOrigin === 'managed') {
          if (pod && !local.autoStopAt && intent.intendedStopAt) {
            const saved = await model.updateOne({ _id: local._id, autoStopAt: null }, { $set: { autoStopAt: intent.intendedStopAt } });
            if (saved?.matchedCount !== 1) continue;
          }
          await this.complete(intent);
          continue;
        }
        // Imported records do not prove creation completed locally. Roll back only
        // the exact resource carrying this persisted operation's random identifier.
        const current = await get(resource.id);
        if (current.id !== resource.id || !this.matches(intent, current)) continue;
        if (!pod) {
          const pods = await runpodService.listPods();
          if (pods.some((p) => p.mounts?.network?.some((v) => v.volumeId === resource.id))) continue;
        }
        await this.observed(intent, current);
        await this.update(intent, { cleanupRequestedAt: this.now() });
        if (pod) await runpodService.deletePod(current.id);
        else await runpodService.deleteNetworkVolume(current.id);
        if (await confirmedAbsent(current.id)) await this.complete(intent);
      } catch (error) {
        this.logger.warning('Runpod creation recovery remains pending; inspect the exact operation', {
          category: 'runpod_management', metadata: { resourceKind: intent._id, operationId: intent.token,
            errorCode: typeof error?.code === 'string' && /^RUNPOD_[A-Z_]+$/u.test(error.code) ? error.code : 'RUNPOD_RECOVERY_FAILED' },
        });
      }
    }
  }
}
module.exports = { RunpodCreationIntentService, CORRELATION_ENV, RECOVERY_LEASE_MS };
