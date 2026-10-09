// Feature-owned private records must never be exposed by the generic admin viewer.
const PRIVATE_DATABASE_COLLECTIONS = new Set(['commonsdiaries']);
module.exports = { PRIVATE_DATABASE_COLLECTIONS };
