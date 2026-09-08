const { SECTIONS, NAVIGATION, allows, navigationFor } = require('./accountSurfacePolicy');
const JOB_TYPES = ['ocr', 'ocr_tts', 'asr', 'gpt_image', 'trellis2', 'pixal3d', 'prompt_to_3d', 'music', 'sora', 'bulk'];
const DEFAULT_JOBS = { types: JOB_TYPES.filter(x => !['music', 'sora', 'bulk'].includes(x)), status: 'all', scope: 'mine', dateWindow: 30 };
const list = value => Array.isArray(value) ? value.filter(x => typeof x === 'string') : [];
function normalize(settings = {}) {
  return { version: 1, sectionOrder: list(settings.sectionOrder), hiddenSections: list(settings.hiddenSections),
    collapsedSections: Array.isArray(settings.collapsedSections) ? list(settings.collapsedSections) : SECTIONS.filter(s => s.collapsed).map(s => s.id),
    jobs: { ...DEFAULT_JOBS, ...(settings.jobs || {}) } };
}
function jobTypesFor(policy, scope) {
  const map = { ocr: 'ocr', ocr_tts: 'ocr', asr: 'asr', music: 'music', sora: 'sora', bulk: 'image_gen' };
  return JOB_TYPES.filter(id => (!map[id] || policy.capabilities.includes(map[id]))
    && (scope === 'mine' ? !['music', 'sora', 'bulk'].includes(id) : ['music', 'sora', 'trellis2', 'pixal3d', 'bulk'].includes(id))
    && (id !== 'bulk' || policy.isAdmin));
}
function effective(policy, raw) {
  const settings = normalize(raw);
  const allowed = SECTIONS.filter(s => allows(policy, s)).map(s => s.id === 'accounting' && !policy.capabilities.includes('accounting') ? { ...s, href: '/budget' } : s);
  const ids = allowed.map(s => s.id);
  const only = values => list(values).filter(x => ids.includes(x));
  const order = [...new Set([...only(settings.sectionOrder), ...ids])];
  return { ...settings, sectionOrder: order, hiddenSections: only(settings.hiddenSections), collapsedSections: only(settings.collapsedSections),
    jobs: { ...settings.jobs, types: list(settings.jobs.types).filter(x => jobTypesFor(policy, settings.jobs.scope).includes(x)) },
    sections: order.map(id => allowed.find(s => s.id === id)), jobTypesByScope: { mine: jobTypesFor(policy, 'mine'), shared: jobTypesFor(policy, 'shared') }, jobTypes: jobTypesFor(policy, settings.jobs.scope) };
}
function assertObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw new Error('Invalid settings fields.');
}
function assertList(value, ids) {
  if (!Array.isArray(value) || value.length > ids.length || new Set(value).size !== value.length || value.some(x => typeof x !== 'string' || !ids.includes(x))) throw new Error('Invalid settings choices.');
}
function mergeChoices(submitted, old, all, allowed) {
  return [...submitted.filter(x => allowed.includes(x)), ...list(old).filter(x => all.includes(x) && !allowed.includes(x))];
}
function saveSettings(input, previous, policy) {
  assertObject(input, ['version', 'sectionOrder', 'hiddenSections', 'collapsedSections', 'jobs', 'reset']);
  if (input.reset === true) {
    const defaults = normalize();
    return saveSettings({ ...defaults, sectionOrder: SECTIONS.filter(s => allows(policy, s)).map(s => s.id) }, previous, policy);
  }
  if (input.version !== 1) throw new Error('Unsupported settings version.');
  const all = SECTIONS.map(s => s.id); const allowed = all.filter(id => allows(policy, SECTIONS.find(s => s.id === id)));
  const old = normalize(previous); const output = { version: 1 };
  for (const key of ['sectionOrder', 'hiddenSections', 'collapsedSections']) {
    assertList(input[key], all);
    output[key] = mergeChoices(input[key], old[key], all, allowed);
  }
  assertObject(input.jobs, ['types', 'status', 'scope', 'dateWindow']);
  assertList(input.jobs.types, JOB_TYPES);
  if (!['all', 'queued', 'running', 'completed', 'failed', 'cancelled'].includes(input.jobs.status)
    || !['mine', 'shared'].includes(input.jobs.scope) || ![7, 30, 90].includes(input.jobs.dateWindow)) throw new Error('Invalid activity filters.');
  output.jobs = { ...input.jobs, types: mergeChoices(input.jobs.types, old.jobs.types, JOB_TYPES, jobTypesFor(policy, input.jobs.scope)) };
  return output;
}
function saveNavigation(input, previous, policy) {
  assertObject(input, ['order', 'hidden', 'reset']);
  const all = NAVIGATION.map(n => n.id); const allowed = navigationFor(policy).map(n => n.id);
  const output = {};
  for (const key of ['order', 'hidden']) {
    const value = input.reset === true ? [] : input[key]; assertList(value, all);
    output[key] = mergeChoices(value, previous?.[key], all, allowed);
  }
  return output;
}
module.exports = { JOB_TYPES, DEFAULT_JOBS, normalize, effective, jobTypesFor, saveSettings, saveNavigation };
