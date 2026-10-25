const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { build } = require('../../scripts/build-jma-warning-diagnostic');
const { parseJmaAlert, PARSER_VERSION } = require('../../utils/disasterJmaParser');
const { classifyWarning } = require('../../utils/disasterJmaReadiness');
const { warningEvidence } = require('../../utils/disasterLocalEvidence');
const reconstructed = require('../fixtures/jma/reconstructedWarnings');
const code = fs.readFileSync(path.join(__dirname, '../../documentation/diagnostics/jma-warning-v3.js'), 'utf8');
const now = '2026-10-24T23:54:00Z';
function inputs() {
  const records = Array.from({ length: 49 }, (_, i) => {
    const fixture = reconstructed.cases[i < 48 ? i % 3 : 3];
    const alert = parseJmaAlert({ xmlText: reconstructed.xml(fixture), entry: { id: `https://example.test/${i}_${fixture.id}` } });
    alert.localWarningCheck = { version: `${PARSER_VERSION}:warning-readiness-v2`, resolved: i === 48 };
    return { pending: i < 48, candidateAt: fixture.at, alert };
  });
  return { records, now, expectedPending: records.filter(r => r.pending).map(r => r.alert.sourceUrl),
    feedHealth: { at: '2026-10-24T23:53:19Z', warningFeedsPresent: true, warningFeedErrors: 0, warningPendingOverflow: false } };
}
function diagnostic() {
  // Every external capability is absent; attempts to use one fail immediately.
  const context = vm.createContext({ console: undefined }, { codeGeneration: { strings: false, wasm: false } });
  return vm.runInContext(code, context, { timeout: 1000 });
}
const json = value => JSON.parse(JSON.stringify(value));
test('pasteable artifact matches exact current source and has no external effects', () => {
  expect(code).toBe(build());
  expect(code).not.toMatch(/\b(?:process|fetch|setTimeout|setInterval|console)\s*[.(]/);
  const input = inputs(); const before = json(input);
  const result = diagnostic()(input);
  expect(json(input)).toEqual(before);
  expect(result).toMatchObject({ suppliedPending: 48, completeSelection: true, unresolved: 0,
    projectedWarningReady: true, projectedLocalState: 'active', projectedActiveCodes: ['14', '15'] });
  for (const [i, row] of input.records.entries()) {
    expect(result.results[i]).toMatchObject(classifyWarning(row.alert));
    expect(result.results[i].localCoverage).toBe(warningEvidence(row.alert)?.coverage ?? null);
  }
});
test('diagnostic checks exact pending membership and fails closed on missing projected bodies', () => {
  for (const defect of ['missing-row', 'duplicate-row', 'missing-body', 'bad-kind']) {
    const input = inputs();
    if (defect === 'missing-row') input.records.shift();
    if (defect === 'duplicate-row') input.records[0] = input.records[1];
    if (defect === 'missing-body') { input.records[0].identity = input.expectedPending[0]; input.records[0].alert = null; }
    if (defect === 'bad-kind') input.records[0].alert.raw.Body.Warning[1].Item[0].Kind = { Status: '発表' };
    expect(diagnostic()(input).projectedWarningReady).toBe(false);
  }
});
test('pure projection requires fresh health and local evidence; historical deferred never substitutes for pending resolution', () => {
  for (const patch of [{ warningFeedErrors: 1 }, { warningFeedsPresent: false }, { warningPendingOverflow: true }, { at: '2026-10-24T22:00:00Z' }]) {
    const input = inputs(); Object.assign(input.feedHealth, patch);
    expect(diagnostic()(input).projectedLocalState).toBe('stale');
  }
  const input = inputs(); input.now = '2026-10-25T05:08:00Z'; input.feedHealth.at = input.now;
  expect(diagnostic()(input).projectedLocalState).toBe('stale');
});
test('pure replay supports genuine clear, conservative empty-ID bodyless correction and equal-order conflicts', () => {
  const input = inputs(); const local = input.records.at(-1);
  const clear = structuredClone(local); clear.alert.reportAt = new Date('2026-10-24T23:50:00Z');
  clear.alert.controlAt = clear.alert.reportAt;
  clear.alert.raw.Body.Warning[1].Item[0].Kind = { Status: '発表警報・注意報はなし' };
  input.records.push(clear);
  expect(diagnostic()(input).projectedLocalState).toBe('clear');
  const conflict = structuredClone(clear); conflict.alert.raw.Body.Warning[1].Item[0].Kind = { Code: '15', Status: '発表' };
  input.records.push(conflict);
  expect(diagnostic()(input).projectedLocalState).toBe('stale');
  input.records.pop();
  const correction = structuredClone(clear); correction.alert.infoType = '訂正'; correction.alert.eventId = '';
  delete correction.alert.raw.Body;
  input.records.push(correction);
  expect(diagnostic()(input)).toMatchObject({ unresolved: 1, projectedWarningReady: false, projectedLocalState: 'stale' });
});
