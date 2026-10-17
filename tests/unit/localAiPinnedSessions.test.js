const { spawnSync } = require('child_process');

const suite = process.env.LOCAL_AI_GATEWAY_SOURCE && process.env.LOCAL_AI_PROTOCOL_PYTHON ? describe : describe.skip;
suite('Gateway 6375910 same-live-Site-coordinator restart contract (CPU only)', () => {
  let evidence;
  beforeAll(() => {
    const result = spawnSync(process.env.LOCAL_AI_PROTOCOL_PYTHON,
      ['tests/helpers/localAiPinnedSessions.py', process.env.LOCAL_AI_GATEWAY_SOURCE],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr);
    evidence = JSON.parse(result.stdout);
  }, 35000);

  test('uses the exact shipped commit, real session capability and reader-4 journal', () => {
    expect(evidence.gateway_commit).toBe('637591024b691ad733469f51cc73d8b7e501a1f5');
    expect(evidence.capabilities).toMatchObject({ session_capability_version: 1, ledger_min_reader_version: 4,
      features: { exclusive_batch_sessions: true } });
    expect(evidence.reader_version).toBe(4);
    expect(evidence.pre_restart).toEqual({ state: 'held', docker_stops: ['synthetic-mpnet'], warming_calls: 0 });
  });

  test('restart fences a live coordinator despite positive lease and hard budgets', () => {
    expect(evidence.restart).toMatchObject({ state: 'recovery_required', dispatch_allowed: false,
      generation: 1, hard_deadline_unchanged: true });
    expect(evidence.restart.lease_remaining_seconds).toBeGreaterThan(100);
    expect(evidence.restart.hard_remaining_seconds).toBeGreaterThan(280);
  });

  test('refreshing the epoch cannot renew recovery_required', () => {
    expect(evidence.stale_epoch).toMatchObject({ status: 409, code: 'batch_gateway_epoch_changed' });
    expect(evidence.fresh_epoch_renew).toMatchObject({ status: 409, code: 'batch_session_expired' });
  });

  test('truthful live-coordinator recovery is rejected; same identity is not takeover', () => {
    expect(evidence.truthful_recovery).toMatchObject({ status: 409, code: 'coordinator_termination_required' });
    expect(evidence.same_id_recovery).toMatchObject({ status: 409, code: 'new_coordinator_and_token_required' });
  });

  test('exact mutation replay returns current blocked state without reviving ownership', () => {
    expect(evidence.renew_replay).toMatchObject({ status: 200, state: 'recovery_required', replayed: true,
      mutation_outcome: { state: 'held', generation: 1 }, lease_unchanged: true });
    expect(evidence.acquire_replay).toMatchObject({ status: 202, state: 'recovery_required', replayed: true,
      mutation_outcome: { state: 'acquiring', generation: 1 } });
  });

  test('new dispatch and close remain blocked; passive reconciliation preserves the run', () => {
    expect(evidence.new_run).toMatchObject({ status: 409, code: 'gpu_batch_session_busy', retry_after: '15' });
    expect(evidence.close).toMatchObject({ status: 409, code: 'batch_session_not_held' });
    expect(evidence.passive_reconciliation).toEqual({ state: 'recovery_required', dispatch_allowed: false,
      run_unchanged: true, warming_calls: 0 });
  });

  test('owned stop is accepted before release; verified final cleanup alone requests warming', () => {
    expect(evidence.stop).toMatchObject({ status: 200, state: 'stopping' });
    expect(evidence.release).toEqual({ state: 'released', cleanup: 'verified', generation: 1,
      dispatch_allowed: false, warming_calls: 1, docker_stops: ['synthetic-mpnet'], run_status: 'stopped' });
    expect(evidence.released_renew).toMatchObject({ status: 409, code: 'batch_session_released' });
    expect(evidence.stop_replay).toMatchObject({ status: 200, state: 'released', replayed: true });
  });
});
