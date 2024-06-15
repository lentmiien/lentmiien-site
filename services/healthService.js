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
        entry.diary = diary.split(',').map(item => item.trim()).filter(item => item.length > 0);
      } else {
        // Create new entry
        entry = new this.HealthEntry({
          dateOfEntry: date,
          basicData: basic,
          medicalRecord: medical,
          diary: diary.split(',').map(item => item.trim()).filter(item => item.length > 0)
        });
      }
  
      // Save the entry (new or updated)
      await entry.save();
  
      return entry;
    } catch (error) {
      throw new Error(`Error updating or creating entry: ${error.message}`);
    }
  }

  /**
   * 
   * @param {*} inputDataArray array of data to append to the database, each array entry has a 'date' value, for the entry to be appended, and key-value pairs of all data to append, or update (if existing)
   * @param {*} type should be either 'basic' or 'medical', indicate the type of input data
   * @returns array of updated entries
   */
  async appendData(inputDataArray, type) {
    if (!['basic', 'medical'].includes(type)) {
      throw new Error("Invalid type. Expected 'basic' or 'medical'.");
    }
  
    const updatedEntries = [];

    const dbkey = type === 'basic' ? 'basicData' : 'medicalRecord';

    for (const { date, dataToAppend } of inputDataArray) {
      if (!isValidDate(date)) {
        throw new Error(`Invalid date format: ${date}. Expected format is YYYY-MM-DD.`);
      }
  
      try {
        let entry = await this.HealthEntry.findOne({ dateOfEntry: date });
  
        if (entry) {
          // Determine if there are any changes to the entry
          let isUpdated = false;
          for (const [key, value] of Object.entries(dataToAppend)) {
            if (entry[dbkey].get(key) !== value) {
              entry[dbkey].set(key, value);
              isUpdated = true;
            }
          }
  
          if (isUpdated) {
            await entry.save();
            updatedEntries.push(entry);
          }
        } else {
          // Create a new entry if none exists
          const newEntry = new this.HealthEntry({
            dateOfEntry: date,
            basicData: type === 'basic' ? dataToAppend : {},
            medicalRecord: type === 'medical' ? dataToAppend : {},
            diary: [] // Initialize empty diary array
          });
  
          await newEntry.save();
          updatedEntries.push(newEntry);
        }
      } catch (error) {
        throw new Error(`Error processing entry for date ${date}: ${error.message}`);
      }
    }
  
    return updatedEntries;
  }
}

// Utility function to check if the date string matches the format YYYY-MM-DD
const isValidDate = (dateStr) => {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
};

module.exports = HealthService;
