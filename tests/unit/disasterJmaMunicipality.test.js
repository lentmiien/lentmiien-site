const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { XMLValidator } = require('fast-xml-parser');
const { parseJmaAlert } = require('../../utils/disasterJmaParser');
const { classifyWarning, REASONS } = require('../../utils/disasterJmaReadiness');
const { warningEvidence } = require('../../utils/disasterLocalEvidence');
const { municipalKind, municipalityProblem, municipalityWarnings, array, HAZARD_NAMES, KIND_STATES } = require('../../utils/disasterJmaMunicipality');
const manifest = require('../fixtures/jma/official/manifest.json');
const parsedSamples = manifest.map(({ file, sha256 }) => {
  const bytes = fs.readFileSync(path.join(__dirname, '../fixtures/jma/official', file));
  return { file, sha256, bytes, alert: parseJmaAlert({ xmlText: bytes.toString(),
    entry: { id: `https://example.test/official_${file.match(/VPWW5[34]/)[0]}.xml` } }) };
});

test.each(parsedSamples)('unmodified official multi-level XML $file parses and resolves', ({ alert, bytes, sha256 }) => {
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  expect(XMLValidator.validate(bytes.toString())).toBe(true);
  expect(alert.raw.Body.Warning).toHaveLength(4);
  expect(municipalityWarnings(alert.raw)).toHaveLength(1);
  expect(classifyWarning(alert)).toMatchObject({ resolved: true, reason: 'nonlocal_municipalities' });
  expect(warningEvidence(alert)).toBeNull();
});

test('official corpus covers every documented municipal status; local remapping preserves every state', () => {
  const statuses = new Set();
  for (const { alert } of parsedSamples) {
    for (const item of array(municipalityWarnings(alert.raw)[0].Item)) {
      for (const kind of array(item.Kind)) statuses.add(kind.Status);
      // Deliberate test-only relocation, never presented as original local XML.
      const local = structuredClone(alert);
      local.raw.Body.Warning[3].Item = [{ ...item, Area: { Code: '1410011' } }];
      const evidence = warningEvidence(local);
      expect(evidence.coverage).toBe(true);
      expect(evidence.hazards.filter(h => h.active).map(h => h.code).sort()).toEqual(
        array(item.Kind).filter(k => municipalKind(k).state === 'active').map(k => k.Code).sort());
    }
  }
  expect([...statuses].sort()).toEqual(['発表', '継続', '特別警報から警報', '特別警報から注意報', '警報から注意報', '解除', '発表警報・注意報はなし'].sort());
});

test.each(Object.entries(HAZARD_NAMES))('valid hazard %s does not require display Name', (Code, Name) => {
  for (const Status of ['発表', '継続', '解除']) {
    expect(municipalKind({ Code, Status })).toEqual(municipalKind({ Code, Name, Status }));
    expect(municipalKind({ Code, Status }).state).toBe(Status === '解除' ? 'cancelled' : 'active');
  }
});

test.each([
  [{ Status: '発表' }, 'missing_kind_code'],
  [{ Name: '強風注意報', Status: '継続' }, 'missing_kind_code'],
  [{ Status: '解除' }, 'missing_kind_code'],
  [{ Code: '15' }, 'missing_kind_status'],
  [{ Code: '15', Status: '未知' }, 'unsupported_kind_status'],
  [{ Code: '15', Status: '取消' }, 'unsupported_kind_status'],
  [{ Code: '15', Status: '切替' }, 'unsupported_kind_status'],
  [{ Code: '99', Status: '発表' }, 'unsupported_kind_code'],
  [{ Code: '00', Name: '解除', Status: '解除' }, 'unsupported_kind_code'],
  [{ Code: '15', Name: '大雨警報', Status: '発表' }, 'kind_name_code_mismatch'],
  [{ Code: '15', Name: '警報・注意報なし', Status: '発表' }, 'kind_name_code_mismatch'],
  [{ Code: '15', Status: '特別警報から警報' }, 'kind_status_code_mismatch'],
  [{ Code: '03', Status: '警報から注意報' }, 'kind_status_code_mismatch'],
  [{ Code: '15', Status: '発表警報・注意報はなし' }, 'clear_kind_has_identifiers'],
  [{ Name: '強風注意報', Status: '発表警報・注意報はなし' }, 'clear_kind_has_identifiers'],
  [{ Status: '発表警報・注意報はなし', Condition: '浸水害' }, 'clear_kind_has_identifiers'],
  [{ Code: ['15'], Status: '継続' }, 'invalid_kind_field'],
  [{ Code: 15, Status: '継続' }, 'invalid_kind_field'],
  [{ Status: ['発表警報・注意報はなし'] }, 'invalid_kind_field'],
  [null, 'invalid_kind_field'],
])('incomplete/contradictory Kind %j remains unknown (%s)', (kind, reason) => {
  expect(municipalKind(kind)).toEqual({ state: 'unknown', reason });
  const alert = structuredClone(parsedSamples[0].alert);
  alert.raw.Body.Warning[3].Item = [{ Area: { Code: '1410011' }, Kind: [kind] }];
  expect(classifyWarning(alert)).toMatchObject({ resolved: false, reason });
  expect(warningEvidence(alert).coverage).toBe(false);
  expect(REASONS).toContain(reason);
});

test('XML text wrappers and boundary whitespace preserve exact status-only clear', () => {
  expect(municipalKind({ Status: { '#text': ' \n発表警報・注意報はなし\t' } })).toMatchObject({ state: 'clear' });
  expect(municipalKind({ Status: '発表警報・注意報はなし（予定）' }).state).toBe('unknown');
  expect(KIND_STATES).toEqual(['active', 'cancelled', 'clear', 'unknown']);
});

test.each(['same-item', 'sibling-item', 'sibling-block', 'same-code-cancelled', 'clear-cancelled'])('contradictory local states fail closed across %s', mode => {
  const alert = structuredClone(parsedSamples[0].alert);
  const first = { Area: { Code: '1410011' }, Kind: [{ Code: '15', Status: '発表' }] };
  const second = { Area: { Code: '1410011' }, Kind: [{ Status: '発表警報・注意報はなし' }] };
  if (mode === 'same-code-cancelled') second.Kind = [{ Code: '15', Status: '解除' }];
  if (mode === 'clear-cancelled') first.Kind[0].Status = '解除';
  alert.raw.Body.Warning[3].Item = [first];
  if (mode === 'same-item') first.Kind.push(...second.Kind);
  else if (mode === 'sibling-block') alert.raw.Body.Warning.push({ '@_type': '市町村等', Item: second });
  else alert.raw.Body.Warning[3].Item.push(second);
  expect(classifyWarning(alert)).toMatchObject({ resolved: false, reason: 'conflicting_municipality_states' });
  expect(warningEvidence(alert).coverage).toBe(false);
});

test('different municipalities may be active, cancelled and clear in the same bulletin', () => {
  const alert = structuredClone(parsedSamples[0].alert);
  alert.raw.Body.Warning[3].Item = [
    { Area: { Code: '1410011' }, Kind: [{ Code: '14', Status: '継続' }, { Code: '15', Status: '発表' }, { Code: '20', Status: '解除' }] },
    { Area: { Code: '1410012' }, Kind: { Status: '発表警報・注意報はなし' } },
    { Area: { Code: '1310100' }, Kind: { Code: '03', Status: '解除' } },
  ];
  expect(classifyWarning(alert).resolved).toBe(true);
  expect(warningEvidence(alert).hazards.filter(h => h.active).map(h => h.code)).toEqual(['14', '15']);
  expect(municipalityProblem(municipalityWarnings(alert.raw))).toBeNull();
});

test('LastKind and NextKinds never certify current active or clear evidence', () => {
  const kind = { Code: '15', Status: '解除', LastKind: { Code: '35', Name: '暴風特別警報' },
    NextKinds: { NextKind: { Code: '05', Name: '暴風警報' } } };
  expect(municipalKind(kind)).toMatchObject({ state: 'cancelled', code: '15' });
  delete kind.Code;
  expect(municipalKind(kind).state).toBe('unknown');
});

test.each(['1410011', '1310100'])('whole-bulletin retraction with a body stays unresolved for %s', Code => {
  const alert = structuredClone(parsedSamples[0].alert);
  alert.infoType = '取消'; alert.eventId = '';
  alert.raw.Body.Warning[3].Item = [{ Area: { Code }, Kind: { Status: '発表警報・注意報はなし' } }];
  expect(classifyWarning(alert)).toMatchObject({ resolved: false, reason: 'bulletin_retraction' });
  if (Code === '1410011') expect(warningEvidence(alert).coverage).toBe(false);
});
