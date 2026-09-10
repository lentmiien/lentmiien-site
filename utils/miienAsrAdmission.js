const { MiienError } = require('../services/miienChatService');

class MiienAsrAdmissionError extends MiienError {
  constructor(stage, code) {
    super(503, 'Recording/transcription could not start. Try recording again shortly or type instead.');
    this.stage = stage;
    this.code = code;
  }
}

function validAdmissionIndexes(indexes) {
  const exactKey = (index, field) => index?.key && Object.keys(index.key).length === 1 && index.key[field] === 1;
  if (!Array.isArray(indexes) || indexes.some(index => !index ||
    Object.hasOwn(index, 'expireAfterSeconds') || index.sparse === true || Object.hasOwn(index, 'partialFilterExpression'))) return false;
  // MongoDB may omit unique on the built-in _id index: uniqueness is inherent.
  return indexes.some(index => index.name === '_id_' && exactKey(index, '_id') && index.unique !== false) &&
    indexes.some(index => index.name === 'principalId_1' && exactKey(index, 'principalId') && index.unique === true);
}

async function requireAsrAdmission(slots) {
  if (slots.db.readyState !== 1 || !slots.db.db) {
    throw new MiienAsrAdmissionError('database', 'asr_database_not_ready');
  }
  let indexes;
  try {
    // Read actual metadata on each admission; never trust schema declarations or
    // Model.init's cached promise. No DDL, synchronization or record deletion.
    indexes = await slots.collection.listIndexes({ maxTimeMS: 5000, timeoutMS: 5000 }).toArray();
  } catch (_) {
    throw new MiienAsrAdmissionError('indexes', 'asr_index_check_failed');
  }
  if (!validAdmissionIndexes(indexes)) {
    throw new MiienAsrAdmissionError('indexes', 'asr_indexes_unsafe');
  }
  if (slots.db.readyState !== 1 || !slots.db.db) {
    throw new MiienAsrAdmissionError('database', 'asr_database_not_ready');
  }
}

module.exports = { MiienAsrAdmissionError, requireAsrAdmission, validAdmissionIndexes };
