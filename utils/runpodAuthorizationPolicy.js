const RUNPOD_CAPABILITIES = Object.freeze({
  catalogRead: 'runpod.catalog.read',
  billingRead: 'runpod.billing.read',
  billingSync: 'runpod.billing.sync',
  podRead: 'runpod.pod.read',
  podCreate: 'runpod.pod.create',
  podStart: 'runpod.pod.start',
  podStop: 'runpod.pod.stop',
  podDelete: 'runpod.pod.delete',
  podSetup: 'runpod.pod.setup',
  podSync: 'runpod.pod.sync',
  templateManage: 'runpod.template.manage',
});

const RUNPOD_READ_CAPABILITIES = Object.freeze([
  RUNPOD_CAPABILITIES.catalogRead,
  RUNPOD_CAPABILITIES.billingRead,
  RUNPOD_CAPABILITIES.podRead,
]);
const RUNPOD_ADMIN_CAPABILITIES = Object.freeze(Object.values(RUNPOD_CAPABILITIES));

// These are capability bundles, not route-role shortcuts. Individual users can
// also receive both semantic capabilities through the existing role store.
const RUNPOD_ROLE_CAPABILITY_BUNDLES = Object.freeze({
  admin: RUNPOD_ADMIN_CAPABILITIES,
  family: Object.freeze([]),
  user: Object.freeze([]),
  other: Object.freeze([]),
});

module.exports = {
  RUNPOD_CAPABILITIES,
  RUNPOD_ADMIN_CAPABILITIES,
  RUNPOD_READ_CAPABILITIES,
  RUNPOD_ROLE_CAPABILITY_BUNDLES,
};
