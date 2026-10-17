// Never copy messages, stacks, paths, server replies, or arbitrary error fields.
const operations = new WeakMap();
const classes = new Map([
  ['TypeError', 'type_error'], ['ReferenceError', 'reference_error'],
  ['MongooseError', 'mongoose_error'], ['ValidationError', 'validation_error'],
  ['CastError', 'cast_error'], ['MongoServerError', 'mongo_server_error'],
  ['MongoWriteConcernError', 'mongo_write_concern_error'],
  ['MongoNetworkError', 'mongo_network_error'], ['MongoNetworkTimeoutError', 'mongo_network_timeout'],
  ['MongoServerSelectionError', 'mongo_server_selection_error'],
]);
const systemCodes = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'EINVAL', 'ENOTDIR', 'EISDIR', 'EROFS', 'EMFILE', 'ENFILE', 'EEXIST', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']);
const syscalls = new Set(['open', 'mkdir', 'read', 'write', 'fsync', 'rename', 'unlink', 'stat', 'lstat', 'realpath', 'connect']);
const reasonCodes = new Set(['admission_index_invalid', 'coordinator_fenced', 'job_changed', 'active_manifest_missing',
  'gateway_protocol_unavailable', 'gateway_unreachable', 'batch_auth_unconfigured', 'invalid_gateway_origin',
  'gateway_operation_mismatch', 'source_access_revoked', 'manifest_incomplete', 'persistence_unavailable',
  'invalid_manual_deadline', 'invalid_run_bounds', 'outside_automatic_window', 'utc_timestamp_required',
  'gateway_clock_uncertain', 'gateway_clock_window_uncertain', 'manual_budget_expired',
  'gateway_run_mismatch', 'gateway_accepted_run_missing', 'immutable_run_conflict', 'immutable_operation_conflict',
  'batch_disabled', 'batch_unauthorized', 'storage_quota', 'run_not_open', 'run_expired',
  'run_operation_limit', 'replacement_not_safe', 'invalid_retry_of', 'rejected_run_bounds_expired']);
async function operation(name, action) {
  try { return await action(); }
  catch (error) {
    if (error && typeof error === 'object' && !operations.has(error)) operations.set(error, name);
    throw error;
  }
}
function errorDiagnostic(error, fallbackOperation) {
  const result = { operation: operations.get(error) || fallbackOperation, reasonClass: classes.get(error?.name) || 'unexpected_error' };
  if (Number.isInteger(error?.code)) result.mongoCode = error.code;
  if (systemCodes.has(error?.code)) { result.systemCode = error.code; result.reasonClass = 'system_error'; }
  if (syscalls.has(error?.syscall)) result.syscall = error.syscall;
  if (reasonCodes.has(error?.code)) { result.reasonCode = error.code; result.reasonClass = 'application_error'; }
  if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) result.httpStatus = error.httpStatus;
  return result;
}
module.exports = { operation, errorDiagnostic };
