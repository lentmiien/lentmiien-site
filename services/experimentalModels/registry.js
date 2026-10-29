const { fail } = require('./policy');

// Public metadata is deliberately constructed here; never serialize an adapter,
// environment, HTTP client, request headers or provider exception to the browser.
const experiments = Object.freeze([
  Object.freeze({ id: 'wevisone-vl', title: 'Tencent WeVisOne-VL-4B', status: 'contract_pending',
    capabilitySource: 'Awaiting verified Gateway contract; no discovery request made.',
    warning: 'Experimental quality: the reported basic OCR test read OPEN as FEH.',
    deferred: 'Masks, matting and streaming are deferred.', fields: [], renderer: null, serializer: null }),
  Object.freeze({ id: 'ming-tts', title: 'Ming-3.0-TTS-0.5B', status: 'contract_pending',
    capabilitySource: 'Awaiting verified Gateway contract; no discovery request made.',
    warning: 'English voice design reportedly passed; other modes are not validated here.',
    deferred: 'Voice cloning, reference audio and voice lifecycle require the full contract.', fields: [], renderer: null, serializer: null }),
]);
function listExperiments() { return experiments.map(value => ({ ...value, fields: [...value.fields] })); }
function requireAdapter(id) {
  if (!experiments.some(value => value.id === id)) fail('unknown_experiment', 404, 'Experiment not found.');
  fail('contract_pending', 503, 'Model runs are unavailable until the Gateway contract is verified and implemented.');
}
module.exports = { listExperiments, requireAdapter };
