const { date, warningEvidence } = require('./disasterLocalEvidence');
const { PARSER_VERSION } = require('./disasterJmaParser');
const VERSION = `${PARSER_VERSION}:warning-readiness-v1`;
const WINDOW_MS = 6 * 3600000;
const MAX_PENDING = 512;
const array = x => x == null ? [] : Array.isArray(x) ? x : [x];
const text = x => typeof x === 'object' ? x?.['#text'] || '' : String(x || '');

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

function warningResolved(alert) {
  if (!alert?.raw?.Head || !alert.raw.Control || !date(alert.reportAt) || !date(alert.controlAt)) return false;
  if (!potentialWarning({ id: alert.sourceId, url: alert.sourceUrl })) return true;
  if (!alert.status || !['発表', '訂正', '取消'].includes(alert.infoType)) return false;
  if (alert.status !== '通常') return ['訓練', '試験'].includes(alert.status);
  const evidence = warningEvidence(alert);
  if (evidence) return evidence.coverage;
  const municipalityWarnings = array(alert.raw.Body?.Warning)
    .filter(w => /市町村|二次細分/.test(text(w['@_type'])));
  // Only parsed municipality codes can establish a different region. Unknown
  // products, bodyless corrections/retractions and ambiguous areas stay unresolved.
  return /VPWW(?:53|54)/.test(`${alert.sourceId} ${alert.sourceUrl}`) && municipalityWarnings.length > 0 &&
    municipalityWarnings.every(w => array(w.Item).length > 0 && array(w.Item).every(item =>
      array(item.Area).length > 0 && array(item.Area).every(a =>
        /^\d{7}$/.test(text(a.Code)) && !['1410011', '1410000'].includes(text(a.Code)))));
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

module.exports = { VERSION, WINDOW_MS, MAX_PENDING, needsWarningCheck, priority, warningResolved, warningFeedKind };
