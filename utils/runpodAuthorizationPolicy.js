const RUNPOD_CAPABILITIES = Object.freeze({
  catalogRead: 'runpod.catalog.read',
  billingRead: 'runpod.billing.read',
});

const RUNPOD_READ_CAPABILITIES = Object.freeze(Object.values(RUNPOD_CAPABILITIES));

// These are capability bundles, not route-role shortcuts. Individual users can
// also receive both semantic capabilities through the existing role store.
const RUNPOD_ROLE_CAPABILITY_BUNDLES = Object.freeze({
  admin: RUNPOD_READ_CAPABILITIES,
  family: Object.freeze([]),
  user: Object.freeze([]),
  other: Object.freeze([]),
});

module.exports = {
  RUNPOD_CAPABILITIES,
  RUNPOD_READ_CAPABILITIES,
  RUNPOD_ROLE_CAPABILITY_BUNDLES,
};
