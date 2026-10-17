const { rejected, verifyReceipt, resolvedRetry } = require('../../services/localAi/admissionRetry');
const run = { _id: 'run', wire: { mode: 'manual', not_before: '2026-10-17T00:00:00Z', deadline: '2026-10-17T04:59:58Z' } };
const receipt = { id: 'run', ...run.wire, status: 'open', operations: [] };
test('only exact immutable receipts acknowledge admission, not operation acceptance', () => {
  expect(() => verifyReceipt(run, receipt)).not.toThrow();
  for (const change of [{ id: 'other' }, { mode: 'automatic' }, { deadline: '2026-10-17T05:00:00Z' }, { status: 'invented' }, { operations: null }, { not_before: 'bad' }]) {
    expect(() => verifyReceipt(run, { ...receipt, ...change })).toThrow('gateway_run_mismatch');
  }
});
test('transport uncertainty, generic 404 and conflict are not nonacceptance evidence', () => {
  expect(rejected({ code: 'invalid_manual_deadline', gatewayResponse: true, httpStatus: 422 })).toBe(true);
  for (const error of [{ code: 'gateway_unreachable' }, { code: 'not_found', gatewayResponse: true, httpStatus: 404 }, { code: 'immutable_run_conflict', gatewayResponse: true, httpStatus: 409 }]) expect(rejected(error)).toBe(false);
});
test.each(['gateway_not_proven_idle', 'storage_quota', 'persistence_unavailable', 'batch_disabled', 'cancel_active'])('even a tagged admission %s deferral is not erased', reason => {
  const nextAttemptAt = new Date();
  expect(resolvedRetry({ activeRun: run._id, reason, nextAttemptAt, retry: { stage: 'run_admission', runId: run._id, reason, nextAttemptAt } }, run)).toBe(false);
});
test('intervening stop, changed delay or suppression remains untouched', () => {
  const nextAttemptAt = new Date();
  const control = { activeRun: run._id, reason: 'invalid_manual_deadline', nextAttemptAt,
    retry: { stage: 'run_admission', runId: run._id, reason: 'invalid_manual_deadline', nextAttemptAt } };
  expect(resolvedRetry(control, run)).toBe(true);
  expect(resolvedRetry({ ...control, stopIntent: { runId: run._id, mode: 'cancel_active' } }, run)).toBe(false);
  expect(resolvedRetry({ ...control, nextAttemptAt: new Date(+nextAttemptAt + 1) }, run)).toBe(false);
  expect(resolvedRetry(control, { ...run, stopMode: 'finish_current' })).toBe(false);
});
