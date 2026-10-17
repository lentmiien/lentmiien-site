const { problem } = require('./policy');
// These codes are emitted before save by the pinned Gateway run validator.
// A timeout, generic HTTP error or 404 is never evidence of nonacceptance.
const REJECTIONS = new Set(['invalid_manual_deadline', 'invalid_run_bounds', 'outside_automatic_window', 'utc_timestamp_required']);
const RUN_STATUSES = new Set(['open', 'ready', 'running', 'stopping', 'drained', 'needs_review', 'stopped', 'expired']);
function verifyReceipt(run, remote) {
  if (!remote || remote.id !== run._id || remote.mode !== run.wire.mode
    || !RUN_STATUSES.has(remote.status) || !Array.isArray(remote.operations)
    || +new Date(remote.not_before) !== +new Date(run.wire.not_before)
    || +new Date(remote.deadline) !== +new Date(run.wire.deadline)) throw problem('gateway_run_mismatch', 503);
}
function rejected(error) { return error.gatewayResponse === true && error.httpStatus === 422 && REJECTIONS.has(error.code); }
function resolvedRetry(control, run) {
  if (run.stopMode || control.stopIntent?.runId === run._id || control.activeRun !== run._id) return false;
  if (control.retry) return control.retry.stage === 'run_admission' && control.retry.runId === run._id
    && (REJECTIONS.has(control.reason) || ['gateway_unreachable', 'gateway_run_mismatch'].includes(control.reason))
    && control.retry.reason === control.reason && +new Date(control.retry.nextAttemptAt) === +control.nextAttemptAt;
  // Pre-fix records have no stage. Migrate only validator-specific failures,
  // never generic transport, quota, busy/health or operation/stop failures.
  return REJECTIONS.has(control.reason);
}
module.exports = { verifyReceipt, rejected, resolvedRetry };
