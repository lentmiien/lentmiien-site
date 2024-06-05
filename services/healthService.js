// const mongoose = require('mongoose');
// const HealthEntry = new mongoose.Schema({
//   dateOfEntry: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
//   basicData: { type: Map, of: String },
//   medicalRecord: { type: Map, of: String },
//   diary: [String] // each entry is a String representing chat3 entry ID
// });
// module.exports = mongoose.model('healthentry', HealthEntry);

class HealthService {
  constructor(HealthEntry) {
    this.HealthEntry = HealthEntry;
  }

  /**
   * @returns All health log entries
   */
  async getAll() {
    const entries = await this.HealthEntry.find();
    return entries;
  }

  /**
   * @param {*} start in format YYYY-MM-DD
   * @param {*} end in format YYYY-MM-DD
   * @returns array of entries in date range
   */
  async getInRange(start, end) {
    const entries = await this.HealthEntry.find();
    return entries.filter(d => d.dateOfEntry >= start && d.dateOfEntry <= end);
  }
}

module.exports = HealthService;
