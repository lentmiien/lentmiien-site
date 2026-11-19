const { Types } = require('mongoose');
const { createHash } = require('crypto');
const { Group, Scan } = require('../../models/document_vault');
const User = require('../../models/useraccount');
const logger = require('../../utils/logger');
const { MAX_PAGES, MAX_BATCH, INTAKE, PAGE_SIZE, VaultError, validId, sameId } = require('./policy');
const { enqueue, syncNextJob, canRead, canManage, isFiled } = require('./workflow');
const { validateScan } = require('./scans');

const missing = () => new VaultError(404, 'Document not found.');
const operatorScope = id => ({ $or: [{ ownerId: id }, { uploaderId: id }] });
const readerScope = id => ({ $or: [{ ownerId: id }, { viewerIds: id }] });
function pageScope(pageId, userId, manage = false) {
  if (!validId(pageId)) throw missing();
  const pending = { $elemMatch: { _id: pageId, state: { $ne: 'stored' }, filedAt: null } };
  const roles = [
    { ownerId: userId },
    { uploaderId: userId, pages: pending },
  ];
  if (!manage) roles.push({ viewerIds: userId, pages: { $elemMatch: { _id: pageId, state: 'stored' } } });
  return { state: 'ready', 'pages._id': pageId, $or: roles };
}

// Replay just the synchronous mutation against a fresh version on conflicts.
// Provider calls and other side effects always take place outside this loop.
async function mutate(filter, change) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const group = await Group.findOne(filter);
    if (!group) throw missing();
    change(group);
    syncNextJob(group);
    try {
      await group.save();
      return group;
    } catch (error) {
      if (error.name !== 'VersionError') throw error;
    }
  }
  throw new VaultError(409, 'The group is being updated. Try again.');
}

async function directory() {
  return User.find({}).select('_id name').sort({ name: 1 }).lean();
}
async function discardUpload(id) {
  const group = await Group.findOneAndUpdate({ _id: id, state: { $in: ['uploading', 'discarding'] } }, { state: 'discarding' });
  if (!group) return;
  await Scan.deleteMany({ groupId: id });
  await Group.deleteOne({ _id: id, state: 'discarding' });
}
async function cleanInterruptedUploads() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const abandoned = await Group.find({ state: { $in: ['uploading', 'discarding'] }, updatedAt: { $lt: cutoff } })
    .select('_id').limit(16).lean();
  for (const group of abandoned) await discardUpload(group._id);
  if (abandoned.length) logger.warning('Removed interrupted Document vault uploads', { category: 'document_vault', metadata: { count: abandoned.length } });
}
async function upload(actorId, ownerId, viewers, files, uploadKey) {
  if (typeof uploadKey !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(uploadKey)) {
    throw new VaultError(422, 'Open a fresh upload form.');
  }
  if (!validId(ownerId) || !Array.isArray(viewers) || viewers.length > 100 || !viewers.every(validId)) {
    throw new VaultError(422, 'Select the owner and viewers from the account list.');
  }
  const ids = [...new Set([ownerId, ...viewers].map(id => id.toLowerCase()))];
  if (await User.countDocuments({ _id: { $in: ids } }) !== ids.length) throw new VaultError(422, 'One of the selected accounts is unavailable.');
  if (!files?.length || files.length > MAX_PAGES) throw new VaultError(422, 'Choose one to twelve page scans.');
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_BATCH) throw new VaultError(413, 'The batch exceeds 32 MiB.');
  const manifest = files.map(file => [
    file.originalname, file.mimetype, createHash('sha256').update(file.buffer).digest('hex'),
  ]);
  const viewerIds = ids.slice(1).sort();
  const uploadDigest = createHash('sha256').update(JSON.stringify([ids[0], viewerIds, manifest])).digest('hex');
  const lookup = () => Group.findOne({ uploaderId: actorId, uploadKey }).select('state uploadDigest pages._id').lean();
  function previousUpload(previous) {
    if (previous?.uploadDigest !== uploadDigest) throw new VaultError(409, 'This form was used for a different batch. Open a new upload form.');
    if (previous.state !== 'ready') throw new VaultError(409, 'This upload is still being received. Try again shortly.');
    return String(previous.pages[0]._id);
  }
  const previous = await lookup();
  if (previous) return previousUpload(previous);
  if (await Group.countDocuments({ uploaderId: actorId, $or: [{ state: 'uploading' }, { nextJobAt: { $ne: null } }] }).limit(100) >= 100) {
    throw new VaultError(429, 'Your intake queue is full. Try again after some batches have finished.');
  }
  const group = new Group({ uploaderId: actorId, ownerId, viewerIds, uploadKey, uploadDigest });
  for (const file of files) {
    const filename = await validateScan(file);
    group.pages.push({ filename });
    enqueue(group, 'ocr', actorId, group.pages.at(-1)._id, true, INTAKE);
  }
  try { await group.save(); }
  catch (error) {
    if (error.code === 11000) return previousUpload(await lookup());
    throw error;
  }
  try {
    await Scan.insertMany(group.pages.map((page, index) => ({
      _id: page._id, groupId: group._id, mime: files[index].mimetype, bytes: files[index].buffer,
    })));
    // Only this atomic publication makes the entire batch visible and runnable.
    const published = await Group.updateOne({ _id: group._id, state: 'uploading' },
      { $set: { state: 'ready', nextJobAt: group.jobs[0].queuedAt } });
    if (!published.matchedCount) throw new Error('Upload expired before publication.');
  } catch (error) {
    try { await discardUpload(group._id); }
    catch { logger.error('Document vault upload cleanup deferred until recovery', { category: 'document_vault' }); }
    throw error;
  }
  return String(group.pages[0]._id);
}

async function list(section, userId, { q = '', offset = 0, filters = {} } = {}) {
  const principal = new Types.ObjectId(String(userId));
  const archive = section === 'archive';
  const scope = archive ? readerScope(principal) : operatorScope(principal);
  const pipeline = [{ $match: { state: 'ready', ...scope } }];
  const options = { maxTimeMS: 5000 };
  if (section === 'queue') {
    // One row represents the group job. Link it through a page the operator
    // can still manage, even after some of the other pages have been filed.
    pipeline.push({ $set: { anchor: { $arrayElemAt: [{ $filter: {
      input: '$pages', as: 'p', cond: { $or: [{ $eq: ['$ownerId', principal] }, { $not: ['$$p.filedAt'] }] },
    } }, 0] } } });
  }
  pipeline.push({ $unwind: { path: '$pages', includeArrayIndex: 'position' } });
  if (!archive) pipeline.push({ $match: { $or: [{ ownerId: principal }, { 'pages.filedAt': null }] } });
  let stateProjection = '$pages.state';
  if (section === 'queue') {
    const groupRow = { $and: [{ $in: ['$summaryState', ['queued', 'failed']] }, { $eq: ['$pages._id', '$anchor._id'] }] };
    pipeline.push({ $match: { $or: [
      { 'pages.state': { $in: ['ocr', 'chat', 'failed'] } },
      { 'pages.state': 'approved', summaryState: 'waiting' }, { $expr: groupRow },
    ] } });
    stateProjection = { $cond: [groupRow, 'group', '$pages.state'] };
  } else {
    pipeline.push({ $match: { 'pages.state': archive ? 'stored' : 'review' } });
  }
  if (archive) {
    const match = {};
    if (filters.dateFrom || filters.dateTo) {
      const date = { $type: 'string' };
      if (filters.dateFrom) date.$gte = filters.dateFrom;
      if (filters.dateTo) date.$lte = filters.dateTo;
      match['pages.documentDate'] = date;
    }
    for (const key of ['yearLabel', 'folderId', 'groupLabel']) {
      if (filters[key]) {
        match['pages.physical.decision'] = 'keep';
        match['pages.physical.' + key] = filters[key];
        options.collation = { locale: 'en', strength: 2 };
      }
    }
    if (Object.keys(match).length) pipeline.push({ $match: match });
  }
  if (archive && q) {
    const literal = new RegExp(RegExp.escape(q), 'i');
    const strings = ['pages.title', 'pages.description', 'description', 'pages.tags', 'pages.englishText', 'pages.ocrText',
      'pages.documentDate', 'pages.currency', 'pages.physical.yearLabel', 'pages.physical.folderId', 'pages.physical.groupLabel'];
    const terms = strings.map(key => ({ [key]: literal }));
    if (/^-?\d+(\.\d+)?$/.test(q)) terms.push({ 'pages.totalAmount': Number(q) });
    pipeline.push({ $match: { $or: terms } });
  }
  const rows = await Group.aggregate([...pipeline,
    { $sort: { _id: archive ? -1 : 1, position: 1 } }, { $skip: offset }, { $limit: PAGE_SIZE + 1 },
    { $project: { _id: '$pages._id', groupId: '$_id', position: 1, title: '$pages.title', filename: '$pages.filename', date: '$pages.documentDate',
      description: '$pages.description', tags: '$pages.tags', state: stateProjection, issue: '$pages.issue', failedStage: '$pages.failedStage',
      summaryState: 1, totalAmount: '$pages.totalAmount', currency: '$pages.currency', physical: '$pages.physical' } },
  ]).option(options);
  return { rows: rows.slice(0, PAGE_SIZE), more: rows.length > PAGE_SIZE };
}

async function detail(pageId, userId, review = false) {
  const group = await Group.findOne(pageScope(pageId, userId)).lean();
  if (!group) throw missing();
  const page = group.pages.find(p => sameId(p._id, pageId));
  const manage = canManage(group, page, userId);
  if (!manage || !review) delete page.failedReply;
  const accounts = await User.find({ _id: { $in: manage ? [group.ownerId, ...group.viewerIds] : [group.ownerId] } }).select('_id name').lean();
  const name = id => accounts.find(u => sameId(u._id, id))?.name || 'Unavailable account';
  return {
    page, manage, filed: isFiled(page), ownerName: name(group.ownerId),
    viewers: manage ? group.viewerIds.map(name) : [],
    summary: group.description, summaryState: group.summaryState, summaryIssue: group.summaryIssue,
    failedSummaryReply: manage && review && group.pages.every(p => canRead(group, p, userId)) ? group.failedSummaryReply : undefined,
    descriptionRevision: group.descriptionRevision, pageCount: group.pages.length,
    position: group.pages.indexOf(page) + 1,
    siblings: group.pages.flatMap((p, index) => canRead(group, p, userId) ? [
      { id: String(p._id), number: index + 1, title: p.title || p.filename, current: sameId(p._id, pageId) },
    ] : []),
  };
}
async function image(pageId, userId) {
  const group = await Group.findOne(pageScope(pageId, userId)).select('_id').lean();
  if (!group) throw missing();
  const scan = await Scan.findOne({ _id: pageId, groupId: group._id }).select('+bytes');
  if (!scan) throw new Error('Missing archived scan.');
  return scan;
}
module.exports = { upload, directory, list, detail, image, mutate, pageScope, cleanInterruptedUploads };
