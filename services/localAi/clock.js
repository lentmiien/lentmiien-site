const { problem, windowAt } = require('./policy');
const HOUR = 3600000;
const MAX_RTT = 2000;
const MAX_AGE = 5000;
const MAX_SKEW = 120000;
// HTTP Date is whole seconds; Uvicorn refreshes its default header once a second.
// Enclose both quantization and header refresh, plus network transit. This is a
// bounded clock estimate, not proof against arbitrary clock steps or bad proxies.
function clockEvidence(headers, sent, received, elapsed, monotonic) {
  const date = headers?.date;
  const parsed = typeof date === 'string' ? Date.parse(date) : NaN;
  const cache = String(headers?.['cf-cache-status'] || '').toUpperCase();
  if (!Number.isFinite(parsed) || new Date(parsed).toUTCString() !== date
    || ![sent, received, monotonic].every(Number.isFinite)
    || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > MAX_RTT
    || Math.abs(received - sent - elapsed) > 250
    || Math.abs(parsed - received) > MAX_SKEW
    || (headers?.age !== undefined && String(headers.age) !== '0')
    || (cache && !['DYNAMIC', 'BYPASS', 'MISS'].includes(cache))
    || /hit/i.test(String(headers?.['x-cache'] || ''))) throw problem('gateway_clock_uncertain', 503);
  return { lower: parsed - 1000, upper: parsed + 2000 + elapsed, received, monotonic };
}
function boundedRunWire(mode, localNow, evidence, monotonic, manualDeadline, anchoredDeadline) {
  const age = monotonic - evidence?.monotonic;
  if (!evidence || !Number.isFinite(age) || age < 0 || age > MAX_AGE
    || !Number.isFinite(+localNow) || !Number.isFinite(evidence.received)
    || !Number.isFinite(evidence.lower) || !Number.isFinite(evidence.upper)
    || evidence.upper < evidence.lower || evidence.upper - evidence.lower > MAX_RTT + 3000
    || Math.abs(+localNow - evidence.received - age) > 250) throw problem('gateway_clock_uncertain', 503);
  const lower = evidence.lower + age, upper = evidence.upper + age;
  const lowWindow = windowAt(new Date(lower)), highWindow = windowAt(new Date(upper));
  let deadline;
  if (mode === 'automatic') {
    const localWindow = windowAt(localNow);
    if (!localWindow.inside || !lowWindow.inside || !highWindow.inside
      || lowWindow.key !== highWindow.key || localWindow.key !== lowWindow.key) throw problem('gateway_clock_window_uncertain', 503);
    deadline = +lowWindow.end - 1000;
  } else {
    const lowCutoff = lower < +lowWindow.end ? +lowWindow.end : +lowWindow.end + 86400000;
    const highCutoff = upper < +highWindow.end ? +highWindow.end : +highWindow.end + 86400000;
    if (lowCutoff !== highCutoff) throw problem('gateway_clock_window_uncertain', 503);
    const remaining = +manualDeadline - +localNow;
    if (!Number.isFinite(remaining) || remaining <= 0) throw problem('manual_budget_expired', 409);
    // The first anchor accounts for time already spent waiting since the click.
    // Persist it across cohorts/restarts; never rebase that budget to a later now.
    const budget = anchoredDeadline ? +anchoredDeadline : lower + Math.min(5 * HOUR, remaining) - 1000;
    deadline = Math.min(+manualDeadline, budget, lower + 5 * HOUR - 1000, lowCutoff - 1000);
  }
  if (!Number.isFinite(deadline) || deadline <= upper + 5000) throw problem('gateway_clock_window_uncertain', 503);
  return { mode, not_before: new Date(upper).toISOString(), deadline: new Date(deadline).toISOString() };
}
module.exports = { clockEvidence, boundedRunWire };
