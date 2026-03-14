const crypto = require('crypto');

const ALLOWED_MUTATION_KEYS = new Set([
  'id',
  'order',
  'customer',
  'tracking',
  'title',
  'comment',
  'next_deadline',
  'completed',
  'fields',
  'encryptedFields',
  'rev',
  'createdAt',
  'updatedAt',
]);

const RESERVED_DYNAMIC_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

class ApiRecordError extends Error {
  constructor(message, status = 400, code = 'bad_request', details = null) {
    super(message);
    this.name = 'ApiRecordError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class ApiRecordService {
  constructor(ApiRecordModel) {
    this.ApiRecordModel = ApiRecordModel;
  }

  static isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  static asPlainObject(value) {
    if (value instanceof Map) {
      return Object.fromEntries(value.entries());
    }

    if (ApiRecordService.isPlainObject(value)) {
      return { ...value };
    }

    return {};
  }

  canAccessEncrypted(access = {}) {
    return access.tier === 'tier2';
  }

  normalizeAccess(access = {}) {
    if (!access || (access.tier !== 'tier1' && access.tier !== 'tier2')) {
      throw new ApiRecordError('Invalid API record access context.', 500, 'invalid_access');
    }
    return access;
  }

  assertAllowedKeys(entry) {
    const invalidKeys = Object.keys(entry).filter((key) => !ALLOWED_MUTATION_KEYS.has(key));
    if (invalidKeys.length > 0) {
      throw new ApiRecordError(
        `Unsupported entry field(s): ${invalidKeys.join(', ')}.`,
        400,
        'unsupported_fields',
        { invalidKeys }
      );
    }
  }

  normalizeOptionalId(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }

  normalizeRequiredId(value) {
    const id = this.normalizeOptionalId(value);
    if (!id) {
      throw new ApiRecordError('Entry id is required for updates.', 400, 'missing_id');
    }
    return id;
  }

  normalizeRequiredRev(value) {
    if (value === undefined || value === null || value === '') {
      throw new ApiRecordError('Entry rev is required for updates.', 400, 'missing_rev');
    }

    const rev = Number(value);
    if (!Number.isInteger(rev) || rev < 0) {
      throw new ApiRecordError('Entry rev must be a non-negative integer.', 400, 'invalid_rev');
    }

    return rev;
  }

  normalizeString(value, fieldName) {
    if (value === null) {
      return null;
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }

    throw new ApiRecordError(`${fieldName} must be a string or null.`, 400, 'invalid_string', { field: fieldName });
  }

  normalizeNumber(value, fieldName) {
    if (value === null) {
      return null;
    }

    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new ApiRecordError(`${fieldName} must be a number or null.`, 400, 'invalid_number', { field: fieldName });
    }

    return number;
  }

  normalizeBoolean(value, fieldName) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no'].includes(normalized)) {
        return false;
      }
    }

    throw new ApiRecordError(`${fieldName} must be a boolean.`, 400, 'invalid_boolean', { field: fieldName });
  }

  parseDate(value, fieldName, options = {}) {
    const { allowNull = false } = options;

    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      if (allowNull) {
        return null;
      }
      throw new ApiRecordError(`${fieldName} must be a valid date.`, 400, 'invalid_date', { field: fieldName });
    }

    const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new ApiRecordError(`${fieldName} must be a valid date.`, 400, 'invalid_date', { field: fieldName });
    }

    return parsed;
  }

  assertDynamicPayloadObject(value, fieldName) {
    if (value === undefined) {
      return;
    }

    if (!ApiRecordService.isPlainObject(value)) {
      throw new ApiRecordError(`${fieldName} must be an object.`, 400, 'invalid_object', { field: fieldName });
    }
  }

  normalizeDynamicKey(key, parentField) {
    const normalizedKey = String(key).trim();

    if (!normalizedKey) {
      throw new ApiRecordError(`${parentField} keys must be non-empty strings.`, 400, 'invalid_dynamic_key', { field: parentField });
    }

    if (normalizedKey.includes('.') || normalizedKey.startsWith('$') || normalizedKey.includes('\0')) {
      throw new ApiRecordError(
        `${parentField} keys may not contain '.', '\$' prefixes, or null bytes.`,
        400,
        'invalid_dynamic_key',
        { field: parentField, key: normalizedKey }
      );
    }

    if (RESERVED_DYNAMIC_KEYS.has(normalizedKey)) {
      throw new ApiRecordError(
        `${parentField} key ${normalizedKey} is not allowed.`,
        400,
        'invalid_dynamic_key',
        { field: parentField, key: normalizedKey }
      );
    }

    return normalizedKey;
  }

  normalizeEncryptedValue(key, value) {
    if (!ApiRecordService.isPlainObject(value)) {
      throw new ApiRecordError('Encrypted field values must be objects.', 400, 'invalid_encrypted_field', { key });
    }

    const version = Number(value.v);
    if (!Number.isInteger(version) || version < 1) {
      throw new ApiRecordError('Encrypted field version must be a positive integer.', 400, 'invalid_encrypted_field', { key });
    }

    return {
      v: version,
      alg: this.requireNonEmptyString(value.alg, 'alg', key),
      kid: this.requireNonEmptyString(value.kid, 'kid', key),
      iv: this.requireNonEmptyString(value.iv, 'iv', key),
      tag: this.requireNonEmptyString(value.tag, 'tag', key),
      ct: this.requireNonEmptyString(value.ct, 'ct', key),
    };
  }

  requireNonEmptyString(value, fieldName, key) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ApiRecordError(
        `Encrypted field ${fieldName} must be a non-empty string.`,
        400,
        'invalid_encrypted_field',
        { field: fieldName, key }
      );
    }

    return value.trim();
  }

  resolveCreateTimestamps(entry, now) {
    const createdAt = this.parseDate(entry.createdAt, 'createdAt');
    const updatedAt = this.parseDate(entry.updatedAt, 'updatedAt');
    const fallback = new Date(now.getTime());

    if (!createdAt && !updatedAt) {
      return { createdAt: fallback, updatedAt: fallback };
    }

    return {
      createdAt: createdAt || updatedAt,
      updatedAt: updatedAt || createdAt,
    };
  }

  resolveUpdateTimestamp(entry, now) {
    const updatedAt = this.parseDate(entry.updatedAt, 'updatedAt');
    return updatedAt || new Date(now.getTime());
  }

  buildCreateDynamicObject(value, fieldName, options = {}) {
    const { encrypted = false } = options;

    if (value === undefined) {
      return {};
    }

    this.assertDynamicPayloadObject(value, fieldName);

    const output = {};
    Object.entries(value).forEach(([rawKey, rawValue]) => {
      const key = this.normalizeDynamicKey(rawKey, fieldName);
      if (rawValue === null) {
        return;
      }

      output[key] = encrypted ? this.normalizeEncryptedValue(key, rawValue) : rawValue;
    });

    return output;
  }

  applyUpdateDynamicPatch(setOps, unsetOps, rootField, value, options = {}) {
    const { encrypted = false } = options;

    if (value === undefined) {
      return;
    }

    this.assertDynamicPayloadObject(value, rootField);

    Object.entries(value).forEach(([rawKey, rawValue]) => {
      const key = this.normalizeDynamicKey(rawKey, rootField);
      if (rawValue === null) {
        unsetOps[`${rootField}.${key}`] = 1;
        return;
      }

      setOps[`${rootField}.${key}`] = encrypted ? this.normalizeEncryptedValue(key, rawValue) : rawValue;
    });
  }

  hasDynamicKeys(value) {
    return ApiRecordService.isPlainObject(value) && Object.keys(value).length > 0;
  }

  buildCreatePayload(entry, access, now) {
    this.assertDynamicPayloadObject(entry.fields, 'fields');
    this.assertDynamicPayloadObject(entry.encryptedFields, 'encryptedFields');

    if (!this.canAccessEncrypted(access) && this.hasDynamicKeys(entry.encryptedFields)) {
      throw new ApiRecordError(
        'Tier 1 users may not create or modify encryptedFields.',
        403,
        'encrypted_fields_forbidden'
      );
    }

    const payload = {
      _id: crypto.randomUUID(),
      order: null,
      customer: null,
      tracking: null,
      title: null,
      comment: null,
      next_deadline: null,
      completed: false,
      fields: this.buildCreateDynamicObject(entry.fields, 'fields'),
      encryptedFields: this.canAccessEncrypted(access)
        ? this.buildCreateDynamicObject(entry.encryptedFields, 'encryptedFields', { encrypted: true })
        : {},
      rev: 0,
      ...this.resolveCreateTimestamps(entry, now),
    };

    if (Object.prototype.hasOwnProperty.call(entry, 'order')) {
      payload.order = this.normalizeNumber(entry.order, 'order');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'customer')) {
      payload.customer = this.normalizeString(entry.customer, 'customer');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'tracking')) {
      payload.tracking = this.normalizeString(entry.tracking, 'tracking');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'title')) {
      payload.title = this.normalizeString(entry.title, 'title');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'comment')) {
      payload.comment = this.normalizeString(entry.comment, 'comment');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'next_deadline')) {
      payload.next_deadline = this.parseDate(entry.next_deadline, 'next_deadline', { allowNull: true });
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'completed')) {
      payload.completed = this.normalizeBoolean(entry.completed, 'completed');
    }

    return payload;
  }

  buildUpdateOperation(entry, access, now) {
    this.assertDynamicPayloadObject(entry.fields, 'fields');
    this.assertDynamicPayloadObject(entry.encryptedFields, 'encryptedFields');

    if (!this.canAccessEncrypted(access) && this.hasDynamicKeys(entry.encryptedFields)) {
      throw new ApiRecordError(
        'Tier 1 users may not create or modify encryptedFields.',
        403,
        'encrypted_fields_forbidden'
      );
    }

    const setOps = {
      updatedAt: this.resolveUpdateTimestamp(entry, now),
    };
    const unsetOps = {};

    if (Object.prototype.hasOwnProperty.call(entry, 'order')) {
      setOps.order = this.normalizeNumber(entry.order, 'order');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'customer')) {
      setOps.customer = this.normalizeString(entry.customer, 'customer');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'tracking')) {
      setOps.tracking = this.normalizeString(entry.tracking, 'tracking');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'title')) {
      setOps.title = this.normalizeString(entry.title, 'title');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'comment')) {
      setOps.comment = this.normalizeString(entry.comment, 'comment');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'next_deadline')) {
      setOps.next_deadline = this.parseDate(entry.next_deadline, 'next_deadline', { allowNull: true });
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'completed')) {
      setOps.completed = this.normalizeBoolean(entry.completed, 'completed');
    }
    if (Object.prototype.hasOwnProperty.call(entry, 'createdAt')) {
      setOps.createdAt = this.parseDate(entry.createdAt, 'createdAt');
    }

    this.applyUpdateDynamicPatch(setOps, unsetOps, 'fields', entry.fields);
    this.applyUpdateDynamicPatch(setOps, unsetOps, 'encryptedFields', entry.encryptedFields, { encrypted: true });

    const updateOperation = {
      $inc: { rev: 1 },
      $set: setOps,
    };

    if (Object.keys(unsetOps).length > 0) {
      updateOperation.$unset = unsetOps;
    }

    return updateOperation;
  }

  async executeQuery(query) {
    if (!query) {
      return query;
    }

    if (typeof query.exec === 'function') {
      return query.exec();
    }

    return query;
  }

  serializeEntry(record, access) {
    const source = record && typeof record.toObject === 'function'
      ? record.toObject({ flattenMaps: true })
      : { ...record };

    const response = {
      id: source.id || source._id,
      order: source.order ?? null,
      customer: source.customer ?? null,
      tracking: source.tracking ?? null,
      title: source.title ?? null,
      comment: source.comment ?? null,
      next_deadline: source.next_deadline ?? null,
      completed: typeof source.completed === 'boolean' ? source.completed : false,
      fields: ApiRecordService.asPlainObject(source.fields),
      rev: Number.isInteger(source.rev) ? source.rev : 0,
      createdAt: source.createdAt ?? null,
      updatedAt: source.updatedAt ?? null,
    };

    if (this.canAccessEncrypted(access)) {
      response.encryptedFields = ApiRecordService.asPlainObject(source.encryptedFields);
    }

    return response;
  }

  async createEntry(entry, access, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const payload = this.buildCreatePayload(entry, access, now);
    const record = new this.ApiRecordModel(payload);
    await record.save();
    return this.serializeEntry(record, access);
  }

  async updateEntry(entry, access, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const id = this.normalizeRequiredId(entry.id);
    const rev = this.normalizeRequiredRev(entry.rev);
    const updateOperation = this.buildUpdateOperation(entry, access, now);

    let query = this.ApiRecordModel.findOneAndUpdate(
      { _id: id, rev },
      updateOperation,
      {
        new: true,
        runValidators: true,
      }
    );

    if (query && typeof query.lean === 'function') {
      query = query.lean();
    }

    const updated = await this.executeQuery(query);
    if (updated) {
      return this.serializeEntry(updated, access);
    }

    let existingQuery = this.ApiRecordModel.findOne({ _id: id });
    if (existingQuery && typeof existingQuery.lean === 'function') {
      existingQuery = existingQuery.lean();
    }

    const existing = await this.executeQuery(existingQuery);
    if (!existing) {
      throw new ApiRecordError(`Entry ${id} was not found.`, 404, 'not_found', { id });
    }

    throw new ApiRecordError(
      `Revision mismatch for entry ${id}. Current rev is ${existing.rev}.`,
      409,
      'rev_conflict',
      {
        id,
        currentRev: existing.rev,
        providedRev: rev,
      }
    );
  }

  async upsertSingle(entry, access, options = {}) {
    if (!ApiRecordService.isPlainObject(entry)) {
      throw new ApiRecordError('Each batch item must be an object.', 400, 'invalid_entry');
    }

    this.assertAllowedKeys(entry);

    const id = this.normalizeOptionalId(entry.id);
    if (!id) {
      return {
        status: 'created',
        entry: await this.createEntry(entry, access, options),
      };
    }

    return {
      status: 'updated',
      entry: await this.updateEntry({ ...entry, id }, access, options),
    };
  }

  async upsertBatch(entries, access, options = {}) {
    const normalizedAccess = this.normalizeAccess(access);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new ApiRecordError('At least one entry is required.', 400, 'empty_batch');
    }

    const now = options.now instanceof Date ? options.now : new Date();
    const results = [];
    const summary = {
      created: 0,
      updated: 0,
      failed: 0,
    };

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const entryId = ApiRecordService.isPlainObject(entry) ? this.normalizeOptionalId(entry.id) : null;

      try {
        const result = await this.upsertSingle(entry, normalizedAccess, { now });
        summary[result.status] += 1;
        results.push({
          ok: true,
          index,
          status: result.status,
          id: result.entry.id,
          entry: result.entry,
        });
      } catch (error) {
        const normalizedError = error instanceof ApiRecordError
          ? error
          : new ApiRecordError(error.message || 'Unexpected error while processing entry.', 500, 'internal_error');

        summary.failed += 1;
        results.push({
          ok: false,
          index,
          status: 'error',
          id: entryId,
          code: normalizedError.code,
          message: normalizedError.message,
          ...(normalizedError.details ? { details: normalizedError.details } : {}),
        });
      }
    }

    return {
      success: summary.failed === 0,
      summary,
      results,
    };
  }

  escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  pickFirstDefined(source = {}, keys = []) {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        return source[key];
      }
    }
    return undefined;
  }

  applyDateRange(query, fieldName, filters, fromKeys, toKeys) {
    const fromValue = this.pickFirstDefined(filters, fromKeys);
    const toValue = this.pickFirstDefined(filters, toKeys);

    if (fromValue === undefined && toValue === undefined) {
      return;
    }

    const range = {};
    if (fromValue !== undefined) {
      range.$gte = this.parseDate(fromValue, `${fieldName}From`);
    }
    if (toValue !== undefined) {
      range.$lte = this.parseDate(toValue, `${fieldName}To`);
    }

    if (range.$gte && range.$lte && range.$gte.getTime() > range.$lte.getTime()) {
      throw new ApiRecordError(`${fieldName} range is invalid.`, 400, 'invalid_date_range', { field: fieldName });
    }

    query[fieldName] = range;
  }

  buildFetchQuery(filters = {}) {
    const query = {};

    const id = this.normalizeOptionalId(filters.id || filters.recordId);
    if (id) {
      query._id = id;
    }

    const title = this.pickFirstDefined(filters, ['title']);
    if (title !== undefined) {
      query.title = new RegExp(this.escapeRegex(String(title).trim()), 'i');
    }

    const customer = this.pickFirstDefined(filters, ['customer']);
    if (customer !== undefined) {
      query.customer = new RegExp(this.escapeRegex(String(customer).trim()), 'i');
    }

    const order = this.pickFirstDefined(filters, ['order']);
    if (order !== undefined) {
      query.order = this.normalizeNumber(order, 'order');
    }

    const completed = this.pickFirstDefined(filters, ['completed']);
    if (completed !== undefined) {
      query.completed = this.normalizeBoolean(completed, 'completed');
    }

    this.applyDateRange(query, 'createdAt', filters, ['createdAtFrom', 'createdFrom'], ['createdAtTo', 'createdTo']);
    this.applyDateRange(query, 'updatedAt', filters, ['updatedAtFrom', 'updatedFrom'], ['updatedAtTo', 'updatedTo']);
    this.applyDateRange(
      query,
      'next_deadline',
      filters,
      ['next_deadlineFrom', 'nextDeadlineFrom', 'deadlineFrom'],
      ['next_deadlineTo', 'nextDeadlineTo', 'deadlineTo']
    );

    return query;
  }

  async fetchEntries(filters = {}, access = {}) {
    const normalizedAccess = this.normalizeAccess(access);
    const query = this.buildFetchQuery(filters);

    let findQuery = this.ApiRecordModel.find(query);
    if (findQuery && typeof findQuery.sort === 'function') {
      findQuery = findQuery.sort({ order: 1, next_deadline: 1, updatedAt: -1, _id: 1 });
    }
    if (findQuery && typeof findQuery.lean === 'function') {
      findQuery = findQuery.lean();
    }

    const records = await this.executeQuery(findQuery);
    const data = Array.isArray(records)
      ? records.map((record) => this.serializeEntry(record, normalizedAccess))
      : [];

    return {
      count: data.length,
      data,
    };
  }

  hasEncryptedFields(record) {
    return Object.keys(ApiRecordService.asPlainObject(record?.encryptedFields)).length > 0;
  }

  async deleteEntry(id, access = {}) {
    const normalizedAccess = this.normalizeAccess(access);
    const recordId = this.normalizeRequiredId(id);

    let findQuery = this.ApiRecordModel.findOne({ _id: recordId });
    if (findQuery && typeof findQuery.lean === 'function') {
      findQuery = findQuery.lean();
    }

    const existing = await this.executeQuery(findQuery);
    if (!existing) {
      throw new ApiRecordError(`Entry ${recordId} was not found.`, 404, 'not_found', { id: recordId });
    }

    if (!this.canAccessEncrypted(normalizedAccess) && this.hasEncryptedFields(existing)) {
      throw new ApiRecordError(
        'Tier 1 users may not delete entries that contain encryptedFields.',
        403,
        'encrypted_fields_forbidden',
        { id: recordId }
      );
    }

    const deletion = await this.executeQuery(this.ApiRecordModel.deleteOne({ _id: recordId }));
    if (deletion && typeof deletion.deletedCount === 'number' && deletion.deletedCount < 1) {
      throw new ApiRecordError(`Entry ${recordId} was not found.`, 404, 'not_found', { id: recordId });
    }

    return {
      id: recordId,
      deleted: this.serializeEntry(existing, normalizedAccess),
    };
  }
}

module.exports = ApiRecordService;
module.exports.ApiRecordError = ApiRecordError;
