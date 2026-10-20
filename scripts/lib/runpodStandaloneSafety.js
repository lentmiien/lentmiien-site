const { randomUUID } = require('crypto');

// Standalone workflows have no MongoDB intent gate. Emit exact correlation BEFORE
// submission so a lost response/crash can be reconciled without replaying creates.
function withStandaloneCreationReporting(service, { stdout, stderr }) {
  const wrapped = Object.create(service);
  wrapped.standaloneUnresolvedCreates = new Set();
  for (const [method, kind] of [['createPod', 'pod'], ['createNetworkVolume', 'volume']]) {
    wrapped[method] = async (input) => {
      const token = randomUUID();
      const name = `${String(input.name || kind).slice(0, 80)}-${token}`;
      const payload = kind === 'pod'
        ? { ...input, env: { ...input.env, LENTMIIEN_CREATION_OPERATION: token } }
        : { ...input, name };
      stdout(`Standalone ${kind} operation ${token}; exact correlation: ${kind === 'pod' ? `env.LENTMIIEN_CREATION_OPERATION=${token}` : `name=${name}`}. Save this before proceeding; there is no durable application gate.`);
      wrapped.standaloneUnresolvedCreates.add(kind);
      try {
        const resource = await service[method](payload);
        if (!/^[A-Za-z0-9_-]{1,128}$/u.test(resource?.id || '')) throw new Error('Invalid resource ID');
        stdout(`Standalone ${kind} operation ${token} observed provider ID ${resource.id}. Cleanup must be verified for this exact ID.`);
        wrapped.standaloneUnresolvedCreates.delete(kind);
        return resource;
      } catch (error) {
        const rejected = [400, 401, 402, 403, 404, 409, 413, 422, 429].includes(error?.status)
          || ['RUNPOD_COOLDOWN', 'RUNPOD_QUEUE_FULL', 'RUNPOD_BUDGET_EXCEEDED'].includes(error?.code);
        if (rejected) wrapped.standaloneUnresolvedCreates.delete(kind);
        stderr(rejected
          ? `Standalone ${kind} operation ${token} was rejected or deferred; no automatic create retry.`
          : `URGENT: standalone ${kind} operation ${token} has an UNKNOWN outcome and may be billing. Do not rerun creation. Reconcile the exact correlation above in Runpod, involving support if no resource is visible; absence alone does not prove failure.`);
        throw error;
      }
    };
  }
  return wrapped;
}

module.exports = { withStandaloneCreationReporting };
