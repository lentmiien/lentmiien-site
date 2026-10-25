const { date, warningEvidence } = require('./disasterLocalEvidence');
const { PARSER_VERSION } = require('./disasterJmaParser');
const { array, text, municipalityWarnings, municipalityProblem, MUNICIPAL_REASONS } = require('./disasterJmaMunicipality');
const VERSION = `${PARSER_VERSION}:warning-readiness-v3`;
const REASONS = Object.freeze([...MUNICIPAL_REASONS, 'missing_metadata', 'different_product',
  'unknown_bulletin_status', 'non_operational_status', 'unknown_product', 'bulletin_retraction',
  'local_coverage', 'unknown_local_state', 'nonlocal_municipalities', 'ambiguous_local_code']);
const WINDOW_MS = 6 * 3600000;
const MAX_PENDING = 512;

function potentialWarning(entry) {
  // A recognized different product cannot update the VPWW53/54 warning slot.
  const code = `${entry.id || ''} ${entry.url || ''}`.match(/(?:^|[\/_\s-])(V[A-Z]{3}\d{2})(?=[_.\s/-]|$)/)?.[1];
  return !code || ['VPWW53', 'VPWW54'].includes(code);
}

function needsWarningCheck(entry, now) {
  const at = date(entry.updatedAt);
  return potentialWarning(entry) && (!at || +at >= +now - WINDOW_MS);
}

function priority(entry, now) {
  if (!needsWarningCheck(entry, now)) return 2;
  // Hints only affect scheduling. They never establish/exclude local coverage.
  return /神奈川|横浜/.test(`${entry.title || ''} ${entry.author || ''}`) ? 0 : 1;
}

function classifyWarning(alert) {
  const result = (resolved, reason) => ({ version: VERSION, resolved, reason });
  if (!alert?.raw?.Head || !alert.raw.Control || !date(alert.reportAt) || !date(alert.controlAt)) return result(false, 'missing_metadata');
  if (!potentialWarning({ id: alert.sourceId, url: alert.sourceUrl })) return result(true, 'different_product');
  if (!alert.status || !['発表', '訂正', '取消'].includes(alert.infoType)) return result(false, 'unknown_bulletin_status');
  if (alert.status !== '通常') return result(['訓練', '試験'].includes(alert.status), 'non_operational_status');
  if (!/(?:^|[\/_\s-])VPWW(?:53|54)(?=[_.\s/-]|$)/.test(`${alert.sourceId} ${alert.sourceUrl}`)) return result(false, 'unknown_product');
  const warnings = municipalityWarnings(alert.raw);
  const problem = municipalityProblem(warnings);
  if (problem) return result(false, problem);
  if (alert.infoType === '取消') return result(false, 'bulletin_retraction');
  const evidence = warningEvidence(alert);
  if (evidence) return result(evidence.coverage, evidence.coverage ? 'local_coverage' : 'unknown_local_state');
  // Only parsed municipality codes can establish a different region. Unknown
  // products, bodyless corrections/retractions and ambiguous areas stay unresolved.
  const nonlocal = warnings.every(w => array(w.Item).every(item => array(item.Area).every(a =>
    !['1410011', '1410000'].includes(text(a.Code)))));
  return result(nonlocal, nonlocal ? 'nonlocal_municipalities' : 'ambiguous_local_code');
}
const warningResolved = alert => classifyWarning(alert).resolved;

function bulletinId(entry) {
  // Only a public JMA filename, never a URL/query, arbitrary title or raw body.
  return `${entry.sourceId || entry.id || ''} ${entry.sourceUrl || entry.url || ''}`
    .match(/(?:^|[\s/])(\d{14}_\d+_V[A-Z]{3}\d{2}_\d{6}\.xml)(?=$|[\s?#])/)?.[1] || null;
}

function warningFeedKind(url) {
  try {
    const name = new URL(url).pathname.split('/').pop();
    if (name === 'extra.xml') return 'current';
    if (name === 'extra_l.xml') return 'long';
    if (['eqvol.xml', 'eqvol_l.xml'].includes(name)) return 'irrelevant';
  } catch (_) { /* Unknown sources cannot certify warning feed coverage. */ }
  return 'unknown';
}

module.exports = { VERSION, REASONS, WINDOW_MS, MAX_PENDING, needsWarningCheck, priority, classifyWarning, warningResolved, warningFeedKind, bulletinId };
