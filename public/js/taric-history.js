/* Private review UI. All source/AI text is rendered as plain text. */
(() => {
  const $ = id => document.getElementById(id);
  const base = '/admin/taric/history';
  let current = null; let preview = null; let next = null; let listSnapshot = null; let previewEpoch = 0; let listEpoch = 0;
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const showStatus = text => { $('status').textContent = text; };
  const invalidate = () => { previewEpoch++; preview = null; $('download').disabled = true; $('preview-content').replaceChildren(); };
  async function api(path, body) {
    const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content }, body: JSON.stringify(body) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(response.status === 409 ? 'Snapshot changed. Reload the request or preview again before saving/downloading.' : `${response.status}: ${data.error || 'History unavailable; try again after database recovery.'}`); }
    return response;
  }
  function pairs(container, values) { const dl = el('dl'); for (const [key, value] of Object.entries(values)) { dl.append(el('dt', key), el('dd', value ?? 'Not captured')); } container.append(dl); }
  function details(container, title, text) { const d = el('details'); d.append(el('summary', title), el('pre', text || 'Not captured')); container.append(d); }
  function activeFilters() { return Object.fromEntries([...new FormData($('filters'))].filter(([, v]) => v !== '')); }
  function selection() { return { mode: $('selection-mode').value, limit: Number($('selection-limit').value), perCode: Number($('selection-cap').value) }; }
  async function load(cursor) {
    const epoch = ++listEpoch; $('stats').replaceChildren(); $('requests').replaceChildren(); $('next').hidden = true;
    $('detail').hidden = true; current = null;
    invalidate(); showStatus('Loading scoped request history…');
    const filters = activeFilters(); if (cursor) { filters.cursor = cursor; if (listSnapshot) filters.snapshot = listSnapshot; }
    const query = new URLSearchParams(filters);
    history.replaceState(null, '', base + (query.size ? `?${query}` : ''));
    const data = await (await api(`/data?${query}`)).json(); if (epoch !== listEpoch) return; next = data.next; listSnapshot = data.snapshot;
    $('stats').replaceChildren();
    const s = data.stats;
    const cards = { 'Cases (live + archived)': s.total, 'Live requests': s.live, 'Archived reviewed sources': s.archived, Pending: s.pending, Terminal: s.terminal, 'Final feedback (live/captured)': s.feedback, 'Verified labels (live/archived)': s.verified, 'Verified but ineligible': s.verifiedIneligible, 'Candidate eligible': s.eligible, 'Eligible distinct codes': s.codeCoverage };
    for (const [key, value] of Object.entries(cards)) { const card = el('div', undefined, 'card'); card.append(el('strong', String(value)), el('span', key)); $('stats').append(card); }
    for (const [decision, v] of Object.entries(s.decisions)) $('stats').append(el('div', `${decision}: ${v.count} / ${v.denominator} final feedback`, 'card'));
    $('stats').append(el('div', `Errors: ${Object.entries(s.errors).map(([k, v]) => `${k}: ${v}`).join('; ') || 'none'}`, 'card'));
    $('requests').replaceChildren();
    if (!data.rows.length) $('requests').append(el('p', 'No requests match these filters.'));
    for (const r of data.rows) {
      const card = el('article'); card.append(el('h3', r.inputs.descriptive_name || 'Category not captured'));
      pairs(card, { 'Created (UTC)': r.createdAt, 'Mode / state': `${r.mode} / ${r.state}`, JAN: r.inputs.jan, 'Original HS': r.inputs.input_hs_code,
        'Full item name': r.facts.name || 'Missing evidence', 'Accepted predictor suggestion': r.suggestion ? `${r.suggestion.code} — ${r.suggestion.description || ''}` : 'None',
        'Final human choice': r.feedback ? `${r.feedback.code} (${r.feedback.decision})` : 'Awaiting feedback',
        'Reviewed label': r.review?.target || 'Not reviewed',
        'Review / eligibility': `${r.reviewStatus}${r.stale ? ' (stale)' : ''} / ${r.eligible ? 'candidate eligible' : r.reasons.join(', ')}` });
      const button = el('button', `Review request ${r.id}`); button.type = 'button'; button.addEventListener('click', () => run(() => openDetail(r.id))); card.append(button); $('requests').append(card);
    }
    $('next').hidden = !next; showStatus(`${data.rows.length} shown; ${s.total} requests in the filtered population.`);
  }
  async function openDetail(id) {
    const r = await (await api(`/${id}`)).json(); current = r;
    const container = $('detail-content'); container.replaceChildren();
    pairs(container, { 'Request ID': r.id, 'Created / finished (UTC)': `${r.createdAt} / ${r.finishedAt || 'pending'}`, 'Mode / status': `${r.mode} / ${r.state}`,
      'Request application source': 'Unknown (not persisted)', JAN: r.inputs.jan, 'Item code': r.inputs.item_code,
      'Descriptive category': r.inputs.descriptive_name, 'Original HS6': r.inputs.input_hs_code, 'Full item name': r.facts.name || 'Missing evidence — label review can still be recorded',
      'Predictor suggestion': r.suggestion ? `${r.suggestion.code} — ${r.suggestion.description || ''} (accepted by request validation, not independently verified)` : 'None',
      'Rejected diagnostic candidate': r.diagnostic ? `${r.diagnostic.code} — ${r.diagnostic.description || ''} — UNVALIDATED` : 'None',
      'Error / stage': `${r.error || 'none'} / ${r.errorStage || 'not captured'}`,
      'Final human feedback': r.feedback ? `${r.feedback.code} (${r.feedback.decision}) at ${r.feedback.createdAt}` : 'Awaiting feedback; model proposal is not a human choice',
      'Adapter / template': `${r.provenance.adapter || 'not captured'} / ${r.provenance.template || 'not captured'}`,
      'Model/runtime identity': r.provenance.identity,
      'Catalog version': r.provenance.catalogVersion,
      'Benchmark / run': `${r.provenance.benchmark || 'not captured'} / ${r.provenance.run || 'not captured'}`,
      'Evidence source / resolution': `${r.evidence.provenance.source || 'not captured'} / ${r.evidence.provenance.resolution || 'not captured'}`,
      'Evidence timestamp (UTC)': r.evidence.provenance.fetched_at,
      'Current review / target': `${r.reviewStatus} / ${r.review?.target || 'none'}`,
      'Review actor / time (UTC)': r.review ? `${r.review.actor} / ${r.review.at}` : 'Unreviewed',
      'Review note': r.review?.note,
      'Approved description': r.review?.approvedDescription,
      'Source storage': r.sourceStorage === 'archived_review' ? 'Archived canonical reviewed source (raw request expired/deleted)' : 'Live request',
      'Review freshness': r.stale ? 'STALE — source changed or archived without final feedback binding; verification unavailable until resolved' : r.sourceStorage === 'archived_review' ? 'Bound immutable final feedback at verification; archived, not live revalidation' : 'Current source snapshot',
      'Source warnings': r.warnings.join('; '),
      'Export candidate eligibility': r.eligible ? 'Eligible code-only source candidate; final formatter pending' : r.reasons.join(', '),
      'Review revision / source hash': `${r.revision} / ${r.sourceHash}` });
    const copy = el('button', 'Copy request ID'); copy.type = 'button'; copy.addEventListener('click', () => run(async () => { await navigator.clipboard.writeText(r.id); showStatus('Request ID copied.'); })); container.append(copy);
    const inspect = el('a', 'Private case JSON'); inspect.href = `${base}/${r.id}`; container.append(inspect);
    details(container, 'Captured specifications (whitespace preserved)', r.facts.specifications);
    details(container, 'Captured factual details', r.facts.details);
    pairs(container, Object.fromEntries(['remarks', 'brand', 'seriesTitle', 'characterName', 'releaseDate'].map(k => [k, r.facts[k]])));
    container.append(el('p', r.targetInTestCatalog ? 'Default/current target is in the training-derived test catalog. Membership is not legal verification.' : 'Default/current target is outside or absent from the test catalog. A well-formed human-verified code is permitted; membership is not legal truth.', 'warning'));
    const audit = el('details'); audit.append(el('summary', `Review audit — ${r.audit.length} revisions`));
    for (const a of r.audit) { const entry = el('article'); pairs(entry, { Revision: a.revision, Status: a.status, Target: a.target, 'Approved description': a.approvedDescription, 'Reviewer ID': a.actor, 'Review time (UTC)': a.at, Note: a.note, 'Bound source hash': a.sourceHash, 'Feedback ID': a.feedbackId, Correction: String(a.correction) }); audit.append(entry); }
    container.append(audit);
    $('review-target').value = r.feedback?.code || r.suggestion?.code || '';
    $('review-status').value = r.reviewStatus === 'unreviewed' ? 'verified' : r.reviewStatus;
    $('approved-description').value = ''; $('review-note').value = '';
    $('confirm-target').checked = false; $('correction').checked = false;
    $('save-review').disabled = ['queued', 'running'].includes(r.state);
    $('detail').hidden = false; $('detail').focus();
  }
  async function run(fn) { try { await fn(); } catch (error) { showStatus(error.message); } }
  const initial = new URLSearchParams(location.search);
  for (const [key, value] of initial) { const control = $('filters').elements.namedItem(key); if (control) control.value = value; }
  $('filters').addEventListener('submit', event => { event.preventDefault(); run(() => load()); });
  $('filters').addEventListener('input', invalidate);
  $('next').addEventListener('click', () => run(() => load(next)));
  $('review-form').addEventListener('submit', event => {
    event.preventDefault(); if (!current) return;
    run(async () => {
      $('save-review').disabled = true;
      try {
        await api(`/${current.id}/review`, { expectedRevision: current.revision, expectedSourceHash: current.sourceHash,
          status: $('review-status').value, target: $('review-target').value || null, confirmTarget: $('confirm-target').checked,
          correction: $('correction').checked, approvedDescription: $('approved-description').value || null, note: $('review-note').value });
        const savedId = current.id; await load(); await openDetail(savedId); showStatus('Explicit review revision saved. Original feedback is unchanged.');
      } finally { $('save-review').disabled = false; }
    });
  });
  for (const id of ['selection-mode', 'selection-limit', 'selection-cap']) $(id).addEventListener('input', invalidate);
  $('preview').addEventListener('click', () => run(async () => {
    invalidate(); const epoch = previewEpoch; const input = { filters: activeFilters(), options: selection() };
    const result = await (await api('/preview', input)).json(); if (epoch !== previewEpoch) return; preview = { input, result };
    const container = $('preview-content');
    pairs(container, { Profile: result.profile, Algorithm: result.algorithm, Available: result.summary.available, Eligible: result.summary.eligible, Selected: result.summary.selected, Excluded: result.summary.excluded, 'Selected groups': result.summary.groups, 'Excluded by primary reason': JSON.stringify(result.summary.excludedByReason), 'Selected per code': JSON.stringify(result.summary.perCode), 'Selected per group': JSON.stringify(result.summary.perGroup), 'Snapshot hash': result.snapshotHash });
    details(container, 'Selection decisions (request IDs and reasons)', result.skipped.map(r => `${r.id}: ${r.reasons.join(', ')}`).join('\n'));
    details(container, 'Selected requests / targets / description readiness', result.candidates.map(r => `${r.requestId}: ${r.targetCode}; ${r.approvedDescription ? 'explicit description approved' : 'description missing; final formatter pending'}`).join('\n'));
    $('download').disabled = result.summary.selected === 0; showStatus('Preview complete. Download revalidates this exact snapshot before creating a private immutable manifest.');
  }));
  $('download').addEventListener('click', () => run(async () => {
    if (!preview) return; $('download').disabled = true;
    const response = await api('/download', { ...preview.input, expectedSnapshotHash: preview.result.snapshotHash });
    const blob = await response.blob(); const url = URL.createObjectURL(blob);
    const link = el('a'); link.href = url; link.download = /filename="([a-z0-9-]+\.jsonl)"/.exec(response.headers.get('content-disposition'))?.[1] || 'taric-candidates.jsonl';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    invalidate(); showStatus('Private manifest frozen and candidate JSONL downloaded. This is not a final training dataset.');
  }));
  $('theme').addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; });
  listSnapshot = initial.get('snapshot');
  run(() => load(initial.get('cursor')));
})();
