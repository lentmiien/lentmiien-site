const { fail } = require('./policy');
const { parseInput, REFERENCE_TASKS, WEVIS_TASKS, TAGS, CONTROLS } = require('./contracts');
const experiments = Object.freeze([
  { id: 'wevisone-vl', title: 'Tencent WeVisOne-VL-4B', status: 'implemented',
    failureInspection: { enabled: false, status: 'contract_pending' },
    capabilitySource: 'Passive Gateway capability check; installation is not runtime qualification.',
    warning: 'Experimental quality: the reported basic OCR test read OPEN as FEH.',
    deferred: 'No masks, matting, video, batch, segmentation or arbitrary prompts.', tasks: WEVIS_TASKS, renderer: 'wevis', serializer: 'wevis-multipart' },
  { id: 'ming-tts', title: 'Ming-3.0-TTS-0.5B', status: 'implemented',
    capabilitySource: 'Passive Gateway capability check; Ming requires server configuration.',
    warning: 'English voice design reportedly passed; other modes are not qualified here.',
    deferred: 'Reference tasks require Gateway ephemeral reference v1 and an updated Ming worker. No persistent voices are registered.',
    tasks: ['VOICE_DESIGN', 'FREEFORM', ...REFERENCE_TASKS], referenceTasks: REFERENCE_TASKS, tags: TAGS, controls: CONTROLS, renderer: 'audio', serializer: 'ming-json-or-ephemeral-multipart' },
]);
function listExperiments() { return structuredClone(experiments); }
function requireAdapter(id) {
  const model = experiments.find(value => value.id === id);
  if (!model) fail('unknown_experiment', 404, 'Experiment not found.');
  return { ...model, parse: input => parseInput(id, input), resultBytes: id === 'wevisone-vl' ? 1048576 : 6291456 };
}
module.exports = { listExperiments, requireAdapter };
