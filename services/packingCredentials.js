const { createServiceCredentials } = require('./serviceCredentialService');
const { CAPABILITIES, ROLE_BUNDLES } = require('../utils/smallestBoxPolicy');
module.exports = createServiceCredentials({ namespace: 'packing', capabilities: [CAPABILITIES.read, CAPABILITIES.run],
  ownerCapabilities: [CAPABILITIES.read, CAPABILITIES.run, CAPABILITIES.api], roleCapabilityBundles: ROLE_BUNDLES });
