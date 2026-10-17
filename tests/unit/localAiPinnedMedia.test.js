const { spawnSync } = require('child_process');
const sharp = require('sharp');
const { digest } = require('../../services/localAi/policy');
const { clockEvidence, boundedRunWire } = require('../../services/localAi/clock');
const { hash } = require('../../services/localAi/inputStorage');
const suite = process.env.LOCAL_AI_GATEWAY_SOURCE && process.env.LOCAL_AI_PROTOCOL_PYTHON ? describe : describe.skip;
suite('exact committed Gateway 2975356 routes and SQLite journal (CPU only)', () => {
  test('Site multipart, refs, Date-anchored cohort, fingerprint, exact/replayed seal, GET/HEAD/Range', async () => {
    const bytes = await sharp({ create: { width: 16, height: 12, channels: 3, background: 'red' } }).png().toBuffer();
    const inputId = `in_${'a'.repeat(32)}`;
    const now = Date.parse('2026-10-17T17:30:01.600Z');
    const evidence = clockEvidence({ date: 'Sat, 17 Oct 2026 17:30:00 GMT' }, now - 20, now, 20, 100);
    const run = { ...boundedRunWire('manual', new Date(now), evidence, 100, new Date(now + 3600000)), schema_version: 2, operation_ids: ['op_site'] };
    const operation = { schema_version: 2, logical_job_id: 'job_site', type: 'llm.chat', request: { model: 'gemma3:12b', messages: [{ role: 'user', content: '', images: [{ artifact_id: inputId, sha256: hash(bytes) }] }], max_tokens: 128 } };
    const result = spawnSync(process.env.LOCAL_AI_PROTOCOL_PYTHON, ['tests/helpers/localAiPinnedMedia.py', process.env.LOCAL_AI_GATEWAY_SOURCE], {
      input: JSON.stringify({ now, bytes: bytes.toString('base64'), input_id: inputId, run, operation, seal: { operations: [{ operation_id: 'op_site', request_digest: digest(operation) }] } }), encoding: 'utf8', timeout: 30000,
    });
    if (result.status !== 0) throw new Error(result.stderr);
    const answers = JSON.parse(result.stdout);
    expect(answers.upload.status).toBe(201); expect(answers.upload.body.sha256).toBe(hash(bytes));
    expect(answers.run.status).toBe(200); expect(answers.operation.status).toBe(202);
    expect(answers.run_replay).toBe(200); expect(answers.replay_reservation_unchanged).toBe(true);
    expect(answers.whole_cohort_quota).toBe(507); expect(answers.rejected_reservation_unchanged).toBe(true);
    expect(answers.operation.body.request_digest).toBe(digest(operation));
    expect(answers.incomplete_seal).toBe(409); expect(answers.seal.status).toBe(200); expect(answers.replay_seal).toBe(200);
    expect(answers.GET).toEqual({ status: 206, length: '8' }); expect(answers.HEAD).toEqual({ status: 206, length: '8' });
  });
});
