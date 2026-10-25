// Included inside the generated expression; this file does not run by itself.
const { VERSION, REASONS, classifyWarning, needsWarningCheck, bulletinId } = modules['./disasterJmaReadiness'];
const { warningEvidence, productOf, date } = modules['./disasterLocalEvidence'];
const { order, freshness } = modules['./summaryOrdering'];
return function diagnoseJmaWarnings({ records, now, feedHealth, expectedPending }) {
  // records = [{ pending: boolean, candidateAt: ISO|null, alert: projectedDocument }]
  // Include every pending identity, even when its body lookup returned no record.
  // candidateAt comes from stored pending.updatedAt (or the archived entryUpdatedAt).
  if (!Array.isArray(records) || records.length > 512 || !date(now)) throw new Error('Invalid bounded diagnostic input');
  const at = new Date(now);
  const results = records.map((row, index) => {
    const alert = row.alert || {};
    const check = classifyWarning(alert);
    const candidate = row.pending === true || needsWarningCheck({ id: alert.sourceId, url: alert.sourceUrl, updatedAt: row.candidateAt }, at);
    return { index, pending: row.pending === true, candidate, bulletinId: bulletinId(alert),
      oldVersion: alert.localWarningCheck?.version || null, oldResolved: alert.localWarningCheck?.resolved ?? null,
      ...check, local: warningEvidence(alert) };
  });
  // Replay local evidence in the application's exact revision order. This is
  // projected evidence only, NOT a claim that live summary CAS writes succeeded.
  let local = null; let revision = ''; let signature = '';
  const ordered = records.map((row, index) => ({ row, index, revision: order(row.alert?.reportAt,
    row.alert?.controlAt || row.alert?.reportAt, row.alert?.serial, /訂正|取消/.test(row.alert?.infoType || '')) }))
    .sort((a, b) => a.revision.localeCompare(b.revision));
  for (const item of ordered) {
    const alert = item.row.alert || {}; const result = results[item.index];
    let next = result.local;
    if (!next && ['VPWW53', 'VPWW54'].includes(productOf(alert)) && /取消|訂正/.test(alert.infoType || '') &&
      alert.eventId && !result.resolved && local?.eventId === alert.eventId) next = { ...local, at: date(alert.reportAt), coverage: false };
    if (!next) continue;
    const data = { ...next }; delete data.product;
    const nextSignature = JSON.stringify(data);
    if (item.revision === revision && signature !== nextSignature) { local = { ...local, coverage: false }; signature = 'conflict'; }
    else if (item.revision > revision) { local = next; signature = nextSignature; revision = item.revision; }
  }
  const pendingCount = results.filter(r => r.pending).length;
  const suppliedIds = records.filter(row => row.pending === true).map(row => row.identity || row.alert?.sourceUrl || row.alert?.sourceId);
  const completeSelection = Array.isArray(expectedPending) && pendingCount === expectedPending.length &&
    new Set(suppliedIds).size === pendingCount && new Set(expectedPending).size === pendingCount &&
    expectedPending.every(id => typeof id === 'string' && suppliedIds.includes(id));
  const unresolved = results.filter(r => r.candidate && !r.resolved).length;
  const gates = completeSelection && feedHealth?.warningFeedsPresent === true && feedHealth?.warningFeedErrors === 0 &&
    feedHealth?.warningPendingOverflow === false && freshness(feedHealth?.at, at, 45 * 60000) === 'fresh';
  const ready = gates && unresolved === 0;
  const known = ready && local?.coverage && freshness(local.at, at, 6 * 3600000) === 'fresh';
  const active = local?.hazards.filter(h => h.active) || [];
  const reasons = Object.fromEntries(REASONS.map(reason => [reason, results.filter(r => r.reason === reason).length]).filter(([, n]) => n));
  return { version: VERSION, completeSelection, suppliedPending: pendingCount, unresolved, reasons,
    projectedWarningReady: ready, projectedLocalState: known ? active.length ? 'active' : 'clear' : local ? 'stale' : 'unavailable',
    projectedActiveCodes: known ? active.map(h => h.code) : [], local,
    results: results.map(({ local: evidence, ...result }) => ({ ...result, localCoverage: evidence?.coverage ?? null,
      localActiveCodes: evidence?.hazards.filter(h => h.active).map(h => h.code) || [] })) };
};
