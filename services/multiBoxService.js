const axios = require('axios');
const Jobs = require('../models/packing_job');
const logger = require('../utils/logger');
const { catalogService, problem } = require('./smallestBoxCatalogService');
const { requestSchema, jobIdSchema } = require('../utils/multiBoxValidation');
const { CUSHION_DENSITY_KG_PER_M3 } = require('./smallestBoxService');

const MAX_BOX_VALUE = 1e12;
function configuredOrigin(value = process.env.MULTI_BOX_PACKING_URL || 'http://192.168.0.20:8094') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid multi-box worker origin');
  return url.origin;
}
function convertBoxes(containers) {
  return containers.filter(box => box.maxLoadWeight > 0).map(box => ({
    id: box.id, width: box.w / 10, height: box.h / 10, depth: box.d / 10,
    max_weight: box.maxLoadWeight, max_value: MAX_BOX_VALUE,
    emptyWeight: box.emptyWeight, tags: box.tags || [],
  }));
}
function addWeightEstimates(result, snapshot) {
  const nonnegative = value => Number.isFinite(value) && value >= 0;
  const dimensions = value => Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && n > 0);
  if (!result || !Array.isArray(result.boxes) || result.boxes.length > 500
    || !Array.isArray(result.unplaced) || result.unplaced.length > 500 || !result.stats
    || !['inputItems', 'packedItems', 'fill'].every(key => nonnegative(result.stats[key]))
    || result.unplaced.some(item => typeof item.id !== 'string' || typeof item.reason !== 'string')
    || result.units?.dimensions !== 'cm') throw new Error('Invalid packing result');
  const catalog = new Map(snapshot.map(box => [box.id, box]));
  let count = result.unplaced.length;
  const boxes = result.boxes.map(box => {
    const definition = catalog.get(box.type);
    if (!definition || !dimensions(box.dimensions)
      || !box.dimensions.every(n => Number.isFinite(n) && n > 0 && n <= 100000)
      || !['contentVolume', 'weight', 'value', 'usableVolume', 'reservedVolume'].every(key => nonnegative(box[key]))
      || !Array.isArray(box.items) || box.items.some(item => typeof item.id !== 'string'
        || !dimensions(item.dimensions) || !nonnegative(item.weight) || typeof item.soft !== 'boolean')
      || !Array.isArray(box.fallbackReasons) || box.fallbackReasons.some(reason => typeof reason !== 'string')) throw new Error('Invalid packed box');
    count += box.items.length;
    if (count > 500) throw new Error('Too many packed items');
    const emptyVolumeCm3 = Math.max(0, box.dimensions.reduce((a, b) => a * b, 1) - box.contentVolume);
    const estimatedCushionWeight = emptyVolumeCm3 * CUSHION_DENSITY_KG_PER_M3 / 1e6;
    return { ...box, weightEstimate: {
      itemWeight: box.weight, emptyBoxWeight: definition.emptyWeight, emptyVolumeCm3,
      estimatedCushionWeight, estimatedShipmentWeight: box.weight + definition.emptyWeight + estimatedCushionWeight,
      maxLoadWeight: definition.maxLoadWeight,
      exceedsMaxLoadWeight: box.weight + estimatedCushionWeight > definition.maxLoadWeight,
    } };
  });
  return { ...result, boxes, cushionDensityKgPerM3: CUSHION_DENSITY_KG_PER_M3 };
}
function createMultiBoxService({ catalog = catalogService, jobs = Jobs, http = axios, log = logger,
  origin = configuredOrigin, now = () => Date.now() } = {}) {
  let endpoint;
  try { endpoint = configuredOrigin(origin()); }
  catch (error) {
    log.error('Multi-box worker configuration invalid; set MULTI_BOX_PACKING_URL to an HTTP(S) origin', { category: 'binpacking_multi' });
    throw error;
  }
  let inFlight = 0;
  const reportedFailures = new Set();
  async function call(method, path, data) {
    if (inFlight >= 4) throw problem('BUSY', 429, 'The packing service is busy. Try again shortly.');
    inFlight += 1;
    try {
      return (await http.request({ method, url: endpoint + path, data,
        timeout: 15000, maxRedirects: 0, maxContentLength: 8 * 1024 * 1024,
        maxBodyLength: 256 * 1024 })).data;
    } finally { inFlight -= 1; }
  }
  function validateJob(data, expectedId) {
    if (!jobIdSchema.safeParse(data?.jobId).success || (expectedId && data.jobId !== expectedId)
      || !['queued', 'running', 'completed', 'failed'].includes(data.status)) throw new Error('Invalid packing job');
    // Do not forward provider URLs or arbitrary failure messages.
    const job = { jobId: data.jobId, status: data.status, queuePosition: data.queuePosition,
      createdAt: data.createdAt, startedAt: data.startedAt, finishedAt: data.finishedAt,
      expiresAt: data.expiresAt, attempts: data.attempts, progress: data.progress };
    if (data.status === 'failed') {
      job.error = { code: 'PACKING_FAILED', message: 'The packing computation failed. Review the input or try again.' };
      if (!reportedFailures.has(data.jobId)) {
        // A failed job can be polled repeatedly by API clients; report it once per process.
        if (reportedFailures.size >= 1000) reportedFailures.delete(reportedFailures.values().next().value);
        reportedFailures.add(data.jobId);
        log.warning('Multi-box computation failed; check worker health and execution limits', {
          category: 'binpacking_multi', metadata: { jobId: data.jobId },
        });
      }
    }
    return job;
  }
  async function containers() {
    const data = await catalog.read();
    return { containers: convertBoxes(data.containers), revision: data.revision, units: { dimensions: 'cm', weight: 'kg' },
      excludedContainers: data.containers.filter(box => box.maxLoadWeight === 0).length };
  }
  async function submit(ownerId, input) {
    const request = requestSchema.parse(input);
    const available = await containers();
    const selected = request.boxIds ? available.containers.filter(box => request.boxIds.includes(box.id)) : available.containers;
    if (!selected.length || (request.boxIds && selected.length !== request.boxIds.length)) {
      throw problem('BOX_SELECTION', 400, 'Select at least one eligible shared box. Reload if the catalog changed.');
    }
    if (selected.some(box => [box.width, box.height, box.depth].some(n => n < 0.01 || n > 100000))) {
      throw problem('BOX_DIMENSIONS', 400, 'Selected box dimensions must be between 0.01 and 100000 cm. Update the shared catalog.');
    }
    const snapshot = selected.map(box => ({ id: box.id, emptyWeight: box.emptyWeight, maxLoadWeight: box.max_weight }));
    const data = await call('POST', '/api/jobs', { items: request.items, options: request.options,
      boxes: selected.map(({ emptyWeight, tags, ...box }) => box) });
    const job = validateJob(data);
    await jobs.create({ _id: job.jobId, ownerId, boxes: snapshot, expiresAt: new Date(now() + 8 * 86400000) });
    if (job.status === 'completed') job.result = addWeightEstimates(data.result, snapshot);
    return job;
  }
  async function poll(ownerId, id) {
    const missing = () => problem('JOB_NOT_FOUND', 404, 'Packing job not found or expired.');
    if (!jobIdSchema.safeParse(id).success) throw missing();
    const record = await jobs.findOne({ _id: id, ownerId, expiresAt: { $gt: new Date(now()) } }).lean();
    if (!record) throw missing();
    let data;
    try { data = await call('GET', '/api/jobs/' + id); }
    catch (error) { if (error.response?.status === 404) throw missing(); throw error; }
    const job = validateJob(data, id);
    if (job.status === 'completed') job.result = addWeightEstimates(data.result, record.boxes);
    return job;
  }
  return { containers, submit, poll };
}
module.exports = { createMultiBoxService, convertBoxes, addWeightEstimates, configuredOrigin, MAX_BOX_VALUE };
