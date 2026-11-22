const { sameId, VaultError, REVIEW } = require('./policy');

const EDIT_WINDOW = 90 * 86400000;
const generatedFields = ['ocrText', 'englishText', 'documentDate', 'title', 'tags', 'description', 'totalAmount', 'currency'];
const isFiled = page => page.state === 'stored';
const isOperator = (group, id) => sameId(group.ownerId, id) || sameId(group.uploaderId, id);
const canManage = (group, page, id) => sameId(group.ownerId, id)
  || (sameId(group.uploaderId, id) && !page.filedAt && !isFiled(page));
const canRead = (group, page, id) => canManage(group, page, id)
  || (isFiled(page) && group.viewerIds.some(viewer => sameId(viewer, id)));

function enqueue(group, kind, actorId, pageId = null, thenClassify = false, authority = REVIEW) {
  group.jobs.push({ kind, actorId, pageId, thenClassify, authority, queuedAt: new Date() });
}
function syncNextJob(group) {
  group.nextJobAt = group.jobs[0]?.queuedAt ?? null;
}

function filePage(page) {
  page.state = 'stored';
  page.filedAt ||= new Date();
}
function publishSummary(group, description) {
  group.description = description;
  if (!group.pages.some(page => page.beforeRedo)) group.beforeRedoDescription = undefined;
  group.failedSummaryReply = undefined;
  group.summaryIssue = null;
  group.summaryState = 'ready';
  for (const page of group.pages) {
    if (page.state === 'approved') filePage(page);
  }
}
// All pages share one ACL. Replace queued summaries whenever any input changes.
// A running summary can finish, but its retired job ID can no longer publish.
function refreshSummary(group, actorId, authority = REVIEW) {
  group.jobs = group.jobs.filter(job => job.kind !== 'group');
  group.descriptionRevision++;
  if (group.pages.some(p => p.filedAt || isFiled(p))) {
    group.beforeRedoDescription ||= group.description || undefined;
    if (group.beforeRedoDescription && group.pages.some(p => filingLocked(group, p))) {
      publishSummary(group, group.beforeRedoDescription);
      return;
    }
  }
  group.description = null;
  group.summaryIssue = null;
  group.summaryState = 'waiting';
  if (!group.pages.every(page => ['review', 'approved', 'stored'].includes(page.state) && page.description)) return;
  if (group.pages.length === 1) {
    publishSummary(group, group.pages[0].description);
    return;
  }
  group.summaryState = 'queued';
  enqueue(group, 'group', actorId, null, false, authority);
}
function checkRevision(actual, submitted) {
  if (!Number.isSafeInteger(submitted) || actual !== submitted) {
    throw new VaultError(409, 'This page has changed. Reload it to see the latest version.');
  }
}
function filingLocked(group, page) {
  const uploaded = group.createdAt || group._id.getTimestamp();
  return Boolean(page.filedAt || isFiled(page)) && Date.now() >= uploaded.getTime() + EDIT_WINDOW;
}
function requireEditable(group, page) {
  if (filingLocked(group, page)) throw new VaultError(409, 'This filed document is locked 90 days after upload.');
}
function reviewPage(group, page, actorId, revision, fields, summaryEdit) {
  requireEditable(group, page);
  checkRevision(page.revision, revision);
  if (page.state !== 'review') throw new VaultError(409, 'This page is no longer awaiting review.');
  if (summaryEdit) {
    for (const sibling of group.pages) requireEditable(group, sibling);
    checkRevision(group.descriptionRevision, summaryEdit.revision);
    if (group.pages.length < 2 || group.summaryState !== 'ready') throw new VaultError(409, 'The group description has changed. Reload this page.');
    if (typeof summaryEdit.text !== 'string' || !summaryEdit.text.trim() || summaryEdit.text.length > 3000) {
      throw new VaultError(422, 'Use 1–3000 characters for the English group description.');
    }
  }
  const changed = fields.description !== page.description;
  page.set(fields);
  page.beforeRedo = undefined;
  page.duplicateReviewedAt = new Date();
  page.duplicateThrough = undefined;
  page.duplicateAfter = undefined;
  page.duplicateStatus = 'checking';
  page.state = 'approved';
  page.revision++;
  if (summaryEdit) {
    group.descriptionRevision++;
    publishSummary(group, summaryEdit.text.trim());
  } else if (changed) refreshSummary(group, actorId);
  else if (group.summaryState === 'ready') {
    filePage(page);
    if (!group.pages.some(p => p.beforeRedo)) group.beforeRedoDescription = undefined;
  }
}
function editLocation(group, page, revision, physical) {
  requireEditable(group, page);
  checkRevision(page.revision, revision);
  if (!isFiled(page) || page.physical?.decision !== 'keep') throw new VaultError(409, 'Only a filed page kept in storage has a location to edit.');
  page.set({ physical });
  page.revision++;
}
function redoPage(group, page, actorId, revision, mode) {
  requireEditable(group, page);
  checkRevision(page.revision, revision);
  if (!['review', 'approved', 'stored', 'failed'].includes(page.state)) throw new VaultError(409, 'This page is already queued.');
  if (!['ocr', 'chat', 'both'].includes(mode)) throw new VaultError(422, 'Choose which work to redo.');
  if (mode === 'chat' && page.ocrText == null) throw new VaultError(422, 'Run OCR first.');
  if (isFiled(page)) {
    const original = page.toObject();
    page.beforeRedo = Object.fromEntries(generatedFields.map(key => [key, original[key]]));
  }
  page.state = mode === 'chat' ? 'chat' : 'ocr';
  page.issue = null;
  page.failedStage = null;
  page.revision++;
  enqueue(group, page.state, actorId, page._id, mode === 'both' || !page.description);
  refreshSummary(group, actorId);
}
function redoGroup(group, actorId, revision) {
  for (const page of group.pages) requireEditable(group, page);
  checkRevision(group.descriptionRevision, revision);
  if (group.pages.length < 2 || !['ready', 'failed'].includes(group.summaryState)) {
    throw new VaultError(409, 'The group description is waiting for its inputs or is already queued.');
  }
  refreshSummary(group, actorId);
}

// Redos can still be queued or awaiting a second review at the deadline.
function restoreExpired(group) {
  // A legacy redo may predate saved checkpoints. Never publish an unreviewed
  // classification as a replacement for an unavailable filed version.
  const expired = group.pages.filter(page => !isFiled(page) && filingLocked(group, page)
    && (page.beforeRedo || page.state === 'approved'));
  const frozenSummary = group.beforeRedoDescription && group.pages.some(page => filingLocked(group, page));
  if (!expired.length && !frozenSummary) return;
  for (const page of expired) {
    if (page.beforeRedo) {
      for (const key of generatedFields) page.set(key, page.beforeRedo[key]);
    }
    page.beforeRedo = undefined;
    page.failedReply = undefined;
    page.failedStage = null;
    page.issue = null;
    page.state = 'stored';
    page.revision++;
  }
  group.jobs = group.jobs.filter(job => !expired.some(page => sameId(page._id, job.pageId)));
  refreshSummary(group, group.ownerId);
  syncNextJob(group);
}

function finishJob(group, id, outcome, result) {
  restoreExpired(group);
  const job = group.jobs.id(id);
  if (job) {
    group.jobs.pull(id);
    const page = job.pageId && group.pages.id(job.pageId);
    if (outcome !== 'success') {
      if (page) {
        page.state = 'failed';
        page.failedStage = job.kind;
        page.issue = outcome;
        if (job.kind === 'chat' && result) page.failedReply = result;
        page.revision++;
      } else {
        group.summaryState = 'failed';
        group.summaryIssue = outcome;
        if (result) group.failedSummaryReply = result;
      }
    } else if (job.kind === 'group') {
      publishSummary(group, result.description);
    } else {
      page.revision++;
      if (job.kind === 'ocr') {
        page.ocrText = result;
        page.state = job.thenClassify ? 'chat' : 'review';
        if (job.thenClassify) enqueue(group, 'chat', job.actorId, page._id, false, job.authority);
      } else {
        page.set(result);
        page.failedReply = undefined;
        page.state = 'review';
      }
      if (page.state === 'review') refreshSummary(group, job.actorId, job.authority);
    }
  }
  // This receipt lets a restarted worker release the global slot exactly once.
  // No provider input, output or temporary job is retained in the receipt.
  group.lastJob = { jobId: id, outcome };
  syncNextJob(group);
}

module.exports = { refreshSummary, EDIT_WINDOW, restoreExpired, filingLocked, isFiled, isOperator, canManage, canRead, enqueue, syncNextJob, reviewPage, editLocation, redoPage, redoGroup, finishJob };
