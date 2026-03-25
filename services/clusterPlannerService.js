const ClusterInventoryItem = require('../models/cluster_inventory_item');
const ClusterNodeType = require('../models/cluster_node_type');
const ClusterHardwareCatalogItem = require('../models/cluster_hardware_catalog_item');
const logger = require('../utils/logger');
const {
  FRAMEWORK,
  HARDWARE_CATALOG_SEED,
  INVENTORY_SEED,
  NODE_TYPE_SEED,
  RESOURCE_STATUS_INFO,
  ROLE_INFO,
  TAB_DEFINITIONS,
} = require('./data/aiClusterPlannerSeed');

const VALID_ROLES = new Set(Object.keys(ROLE_INFO));
const VALID_STATUSES = new Set(Object.keys(RESOURCE_STATUS_INFO));

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function dedupeStrings(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

function normalizeRoleList(values = []) {
  return dedupeStrings(values)
    .map((value) => value.toUpperCase())
    .filter((value) => VALID_ROLES.has(value));
}

function normalizeStringArray(values = []) {
  if (typeof values === 'string') {
    return dedupeStrings(values.split('\n'));
  }
  if (!Array.isArray(values)) {
    return [];
  }
  return dedupeStrings(values);
}

function normalizeSpecPairs(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((row) => ({
      label: String(row?.label || '').trim(),
      value: String(row?.value || '').trim(),
    }))
    .filter((row) => row.label && row.value);
}

function normalizeSpecRanges(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((row) => ({
      metric: String(row?.metric || '').trim(),
      min: String(row?.min || '').trim(),
      rec: String(row?.rec || '').trim(),
      ideal: String(row?.ideal || '').trim(),
    }))
    .filter((row) => row.metric);
}

function mapInventoryItem(doc) {
  return {
    id: String(doc._id),
    stableId: doc.stableId,
    shortName: doc.shortName || '',
    name: doc.name || '',
    nodeTypeKey: doc.nodeTypeKey || '',
    roles: Array.isArray(doc.roles) ? doc.roles : [],
    status: doc.status || 'offline',
    summary: doc.summary || '',
    hostname: doc.hostname || '',
    location: doc.location || '',
    homeLanAddress: doc.homeLanAddress || '',
    fabricAddress: doc.fabricAddress || '',
    specs: Array.isArray(doc.specs) ? doc.specs.map((spec) => ({
      label: spec.label || '',
      value: spec.value || '',
    })) : [],
    notes: Array.isArray(doc.notes) ? doc.notes : [],
    order: Number.isFinite(doc.order) ? doc.order : 0,
    updatedAt: doc.updatedAt || null,
  };
}

function mapNodeType(doc) {
  return {
    id: String(doc._id),
    stableId: doc.stableId,
    key: doc.key || '',
    code: doc.code || '',
    tabId: doc.tabId || '',
    title: doc.title || '',
    summary: doc.summary || '',
    workloads: Array.isArray(doc.workloads) ? doc.workloads : [],
    policy: Array.isArray(doc.policy) ? doc.policy : [],
    avoid: Array.isArray(doc.avoid) ? doc.avoid : [],
    software: Array.isArray(doc.software) ? doc.software : [],
    ranges: Array.isArray(doc.ranges) ? doc.ranges.map((range) => ({
      metric: range.metric || '',
      min: range.min || '',
      rec: range.rec || '',
      ideal: range.ideal || '',
    })) : [],
    hardwareRoles: Array.isArray(doc.hardwareRoles) ? doc.hardwareRoles : [],
    order: Number.isFinite(doc.order) ? doc.order : 0,
    updatedAt: doc.updatedAt || null,
  };
}

function mapHardwareItem(doc) {
  return {
    id: String(doc._id),
    stableId: doc.stableId,
    name: doc.name || '',
    vendor: doc.vendor || '',
    category: doc.category || '',
    roles: Array.isArray(doc.roles) ? doc.roles : [],
    summary: doc.summary || '',
    why: doc.why || '',
    specs: Array.isArray(doc.specs) ? doc.specs : [],
    source: doc.source || '',
    order: Number.isFinite(doc.order) ? doc.order : 0,
    updatedAt: doc.updatedAt || null,
  };
}

async function seedCollectionIfEmpty(Model, entries, label) {
  const count = await Model.countDocuments({}).exec();
  if (count > 0) {
    return false;
  }
  if (!Array.isArray(entries) || !entries.length) {
    return false;
  }
  await Model.insertMany(entries);
  logger.notice('Cluster planner seed inserted', {
    category: 'cluster_planner',
    metadata: {
      collection: label,
      count: entries.length,
    },
  });
  return true;
}

async function ensureSeedData() {
  await seedCollectionIfEmpty(ClusterNodeType, NODE_TYPE_SEED, 'cluster_node_type');
  await seedCollectionIfEmpty(ClusterHardwareCatalogItem, HARDWARE_CATALOG_SEED, 'cluster_hardware_catalog_item');
  await seedCollectionIfEmpty(ClusterInventoryItem, INVENTORY_SEED, 'cluster_inventory_item');
}

async function getState() {
  await ensureSeedData();

  const [inventoryDocs, nodeTypeDocs, hardwareDocs] = await Promise.all([
    ClusterInventoryItem.find({}).sort({ order: 1, shortName: 1, name: 1 }).lean().exec(),
    ClusterNodeType.find({}).sort({ order: 1, code: 1 }).lean().exec(),
    ClusterHardwareCatalogItem.find({}).sort({ order: 1, vendor: 1, name: 1 }).lean().exec(),
  ]);

  const inventory = inventoryDocs.map(mapInventoryItem);
  const nodeTypes = nodeTypeDocs.map(mapNodeType);
  const hardwareCatalog = hardwareDocs.map(mapHardwareItem);

  const inventoryCounts = inventory.reduce((acc, item) => {
    const key = VALID_STATUSES.has(item.status) ? item.status : 'offline';
    acc.total += 1;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {
    total: 0,
    online: 0,
    offline: 0,
    planned: 0,
    cloud: 0,
    maintenance: 0,
    retired: 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    versionLabel: 'db-backed',
    title: 'Home AI Fabric Planner',
    subtitle: 'Management tool for your current resources and planning surface for a modular, local-first home AI cluster.',
    roleInfo: ROLE_INFO,
    resourceStatusInfo: RESOURCE_STATUS_INFO,
    tabs: TAB_DEFINITIONS,
    framework: FRAMEWORK,
    inventory,
    nodeTypes,
    hardwareCatalog,
    counts: {
      inventory: inventoryCounts,
      nodeTypes: nodeTypes.length,
      hardwareCatalog: hardwareCatalog.length,
    },
  };
}

async function saveInventoryItem(payload = {}) {
  await ensureSeedData();

  const name = String(payload.name || '').trim();
  if (!name) {
    throw createHttpError(400, 'Inventory item name is required.');
  }

  const roles = normalizeRoleList(payload.roles || []);
  const nodeTypeKey = String(payload.nodeTypeKey || '').trim().toLowerCase();
  const status = String(payload.status || '').trim().toLowerCase();
  const normalizedStatus = VALID_STATUSES.has(status) ? status : 'offline';
  const specs = normalizeSpecPairs(payload.specs || []);
  const notes = normalizeStringArray(payload.notes || []);
  const order = Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0;
  const shortName = String(payload.shortName || '').trim();

  let doc;
  if (payload.id) {
    doc = await ClusterInventoryItem.findById(payload.id);
    if (!doc) {
      throw createHttpError(404, 'Inventory item not found.');
    }
  } else {
    const baseStableId = slugify(shortName || name) || `resource-${Date.now()}`;
    const candidateStableId = `cluster-resource-${baseStableId}`;
    let stableId = candidateStableId;
    let suffix = 2;
    while (await ClusterInventoryItem.exists({ stableId })) {
      stableId = `${candidateStableId}-${suffix}`;
      suffix += 1;
    }
    doc = new ClusterInventoryItem({ stableId });
  }

  doc.shortName = shortName;
  doc.name = name;
  doc.nodeTypeKey = nodeTypeKey;
  doc.roles = roles;
  doc.status = normalizedStatus;
  doc.summary = String(payload.summary || '').trim();
  doc.hostname = String(payload.hostname || '').trim();
  doc.location = String(payload.location || '').trim();
  doc.homeLanAddress = String(payload.homeLanAddress || '').trim();
  doc.fabricAddress = String(payload.fabricAddress || '').trim();
  doc.specs = specs;
  doc.notes = notes;
  doc.order = Math.max(0, order);

  await doc.save();
  return mapInventoryItem(doc.toObject());
}

async function deleteInventoryItem(id) {
  await ensureSeedData();
  const deleted = await ClusterInventoryItem.findByIdAndDelete(id);
  if (!deleted) {
    throw createHttpError(404, 'Inventory item not found.');
  }
  return { status: 'ok' };
}

async function saveNodeType(id, payload = {}) {
  await ensureSeedData();

  const doc = await ClusterNodeType.findById(id);
  if (!doc) {
    throw createHttpError(404, 'Node type not found.');
  }

  const title = String(payload.title || '').trim();
  if (!title) {
    throw createHttpError(400, 'Node type title is required.');
  }

  const ranges = normalizeSpecRanges(payload.ranges || []);
  if (!ranges.length) {
    throw createHttpError(400, 'At least one spec range row is required.');
  }

  doc.title = title;
  doc.summary = String(payload.summary || '').trim();
  doc.workloads = normalizeStringArray(payload.workloads || []);
  doc.policy = normalizeStringArray(payload.policy || []);
  doc.avoid = normalizeStringArray(payload.avoid || []);
  doc.software = normalizeStringArray(payload.software || []);
  doc.ranges = ranges;
  doc.hardwareRoles = normalizeRoleList(payload.hardwareRoles || []);

  await doc.save();
  return mapNodeType(doc.toObject());
}

async function saveHardwareItem(payload = {}) {
  await ensureSeedData();

  const name = String(payload.name || '').trim();
  if (!name) {
    throw createHttpError(400, 'Hardware name is required.');
  }

  const roles = normalizeRoleList(payload.roles || []);
  const specs = normalizeStringArray(payload.specs || []);
  const order = Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0;

  let doc;
  if (payload.id) {
    doc = await ClusterHardwareCatalogItem.findById(payload.id);
    if (!doc) {
      throw createHttpError(404, 'Hardware entry not found.');
    }
  } else {
    const baseStableId = slugify(name) || `hardware-${Date.now()}`;
    const candidateStableId = `cluster-hardware-${baseStableId}`;
    let stableId = candidateStableId;
    let suffix = 2;
    while (await ClusterHardwareCatalogItem.exists({ stableId })) {
      stableId = `${candidateStableId}-${suffix}`;
      suffix += 1;
    }
    doc = new ClusterHardwareCatalogItem({ stableId });
  }

  doc.name = name;
  doc.vendor = String(payload.vendor || '').trim();
  doc.category = String(payload.category || '').trim();
  doc.roles = roles;
  doc.summary = String(payload.summary || '').trim();
  doc.why = String(payload.why || '').trim();
  doc.specs = specs;
  doc.source = String(payload.source || '').trim();
  doc.order = Math.max(0, order);

  await doc.save();
  return mapHardwareItem(doc.toObject());
}

async function deleteHardwareItem(id) {
  await ensureSeedData();
  const deleted = await ClusterHardwareCatalogItem.findByIdAndDelete(id);
  if (!deleted) {
    throw createHttpError(404, 'Hardware entry not found.');
  }
  return { status: 'ok' };
}

module.exports = {
  deleteHardwareItem,
  deleteInventoryItem,
  ensureSeedData,
  getState,
  saveHardwareItem,
  saveInventoryItem,
  saveNodeType,
};
