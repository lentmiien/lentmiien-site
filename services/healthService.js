// const mongoose = require('mongoose');
// const HealthEntry = new mongoose.Schema({
//   dateOfEntry: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
//   basicData: { type: Map, of: String },
//   medicalRecord: { type: Map, of: String },
//   diary: [String] // each entry is a String representing chat3/4 entry ID
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

  /**
   * When updating an entry, old data will be replaced with input data (enabling creating, updating and deleting key-value pairs)
   * @param {*} date date of entry to update, or create new if not existing
   * @param {*} basic basic data (key - value pairs) to save
   * @param {*} medical medical data (key - value pairs) to save
   * @param {*} diary diary entries (message ids comma separated string) to save as array
   * @returns new/updated entry
   */
  async updateEntry(date, basic, medical, diary) {
    if (!isValidDate(date)) {
      throw new Error("Invalid date format. Expected format is YYYY-MM-DD.");
    }
  
    try {
      // Attempt to find an existing entry by date
      let entry = await this.HealthEntry.findOne({ dateOfEntry: date });
  
      if (entry) {
        // Update existing entry
        entry.basicData = basic;
        entry.medicalRecord = medical;
        entry.diary = diary.split(',').map(item => item.trim());
      } else {
        // Create new entry
        entry = new this.HealthEntry({
          dateOfEntry: date,
          basicData: basic,
          medicalRecord: medical,
          diary: diary.split(',').map(item => item.trim())
        });
      }
  
      // Save the entry (new or updated)
      await entry.save();
  
      return entry;
    } catch (error) {
      throw new Error(`Error updating or creating entry: ${error.message}`);
    }
  }
}

// Utility function to check if the date string matches the format YYYY-MM-DD
const isValidDate = (dateStr) => {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
};

module.exports = HealthService;
