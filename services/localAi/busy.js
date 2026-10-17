const MESSAGE = 'The GPU is reserved by a local AI batch session. Try again after the session releases it.';
function sessionBusy(error) {
  return (error?.httpStatus || error?.response?.status || error?.status) === 409
    && (error.code === 'gpu_batch_session_busy' || error.response?.data?.detail?.code === 'gpu_batch_session_busy'
      || error.responseBody?.detail?.code === 'gpu_batch_session_busy');
}
function retryMs(error) {
  const seconds = Number(error.retryAfter || error.response?.headers?.['retry-after'] || error.responseHeaders?.['retry-after']);
  return Math.max(1000, Math.min(1800000, (Number.isFinite(seconds) && seconds > 0 ? seconds : 15) * 1000));
}
module.exports = { MESSAGE, sessionBusy, retryMs };
