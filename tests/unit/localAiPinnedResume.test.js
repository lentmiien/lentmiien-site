const { spawnSync } = require('child_process');
const suite = process.env.LOCAL_AI_GATEWAY_SOURCE && process.env.LOCAL_AI_PROTOCOL_PYTHON ? describe : describe.skip;
suite('Gateway e20a437 same-coordinator resume and multi-cohort fence (CPU)', () => {
  let evidence;
  beforeAll(() => {
    const result = spawnSync(process.env.LOCAL_AI_PROTOCOL_PYTHON, ['tests/helpers/localAiPinnedResume.py', process.env.LOCAL_AI_GATEWAY_SOURCE], { encoding: 'utf8', timeout: 30000 });
    if (result.status !== 0) throw new Error(result.stderr);
    evidence = JSON.parse(result.stdout);
  }, 35000);
  test('pins the fixed source and retains original deadlines and generation on resume', () => {
    expect(evidence.gateway_commit).toBe('e20a437775bcf292d062d987c7850cd7d63a2a1a');
    expect(evidence.resume).toMatchObject({ status: 200, state: 'held', generation: 1, lease_unchanged: true, hard_unchanged: true, dispatch_allowed: true });
  });
  test('unexpired recovery is incomplete, not expired; stale epoch remains rejected', () => {
    expect(evidence.fresh_epoch_renew).toMatchObject({ status: 409, code: 'batch_session_recovery_incomplete' });
    expect(evidence.stale_epoch).toMatchObject({ status: 409, code: 'batch_gateway_epoch_changed' });
  });
  test('resumes once per key and renews separately', () => {
    expect(evidence.resume_replay).toMatchObject({ status: 200, state: 'held', replayed: true });
    expect(evidence.separate_renew).toMatchObject({ status: 200, state: 'held' });
  });
  test('three contiguous cohorts retain one acquisition without intermediate warming', () => {
    expect(evidence.cohorts).toEqual({ runs: 3, warming_calls: 0, docker_stops: ['synthetic-mpnet'] });
  });
  test('old resume replay after another restart reports current blocked state', () => {
    expect(evidence.second_restart_old_replay).toMatchObject({ state: 'recovery_required', replayed: true, dispatch_allowed: false, mutation_outcome: { state: 'held' } });
    expect(evidence.second_resume).toMatchObject({ status: 200, state: 'held' });
  });
  test('only verified final release requests warming once', () => {
    expect(evidence.stop).toMatchObject({ status: 200, state: 'stopping' });
    expect(evidence.release).toMatchObject({ state: 'released', cleanup: 'verified', warming_calls: 1, generation: 1 });
  });
  test('ordinary jobs and stale reservation release are fenced while CPU routes stay available', () => {
    expect(evidence.busy_contract).toMatchObject({ status: 409, code: 'gpu_batch_session_busy', retry_after: '15' });
    expect(evidence.stale_legacy_release).toMatchObject({ status: 409, code: 'gpu_batch_session_busy' });
    expect(evidence.new_codex).toMatchObject({ status: 409, code: 'gpu_batch_session_busy' });
    expect(evidence.cpu_routes).toEqual([200, 200]);
  });
  test('live-coordinator termination assertions remain invalid and release is permanent', () => {
    expect(evidence.truthful_recovery).toMatchObject({ status: 409, code: 'coordinator_termination_required' });
    expect(evidence.same_id_recovery).toMatchObject({ status: 409, code: 'new_coordinator_and_token_required' });
    expect(evidence.released_renew).toMatchObject({ status: 409, code: 'batch_session_released' });
  });
});
