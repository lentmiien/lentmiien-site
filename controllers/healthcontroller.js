const { HealthEntry } = require('../database');
const logger = require('../utils/logger');

// Front-end
exports.top = (req, res) => {
  res.render('health_top');
};

// GET /edit/:date: Fetches one entry from database and show edit page
exports.edit = async (req, res) => {
  let { date } = req.params; // Extract date from the request parameters

  // Validate the provided date
  if (!isValidDate(date)) {
    date = new Date().toISOString().split('T')[0]; // Use today's date in YYYY-MM-DD format if provided date is invalid
  }

  try {
    // Attempt to fetch the entry for the given date
    let entry = await HealthEntry.findOne({ dateOfEntry: date });
    
    if (!entry) {
      // If no entry exists, create a default template
      entry = {
        dateOfEntry: date,
        basicData: new Map(),
        medicalRecord: new Map(),
        diary: [],
      };
    } else {
      // Convert Mongoose Map to an array of {key, value} objects for iteration in Pug
      entry.basicData = [...entry.basicData.entries()].map(([key, value]) => ({key, value}));
      entry.medicalRecord = [...entry.medicalRecord.entries()].map(([key, value]) => ({key, value}));
    }

    // Render the edit page with the entry data
    res.render('health_edit', { entry: entry });

  } catch (error) {
    // Log the error and render an error page or send an error response
    logger.error(`Error fetching entry for editing: ${error.message}`);
    res.status(500).render('error', { error: 'Could not fetch entry for editing' });
  }
};

// Utility function to check if the date string matches the format YYYY-MM-DD
const isValidDate = (dateStr) => {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
};

// POST /health-entries: Create a new health entry.
exports.addHealthEntry = async (req, res) => {
  const { dateOfEntry, basicData, medicalRecord, diary } = req.body;

  // Check if dateOfEntry is provided and valid
  if (!dateOfEntry || !isValidDate(dateOfEntry)) {
    return res.status(400).json({ message: 'Invalid or missing dateOfEntry.' });
  }

  // Check if at least one of the optional fields is provided
  if (!basicData && !medicalRecord && !diary) {
    return res.status(400).json({ message: 'At least one of basicData, medicalRecord, or diary must be provided.' });
  }

  try {
    // Check if an entry with the same dateOfEntry already exists
    const existingEntry = await HealthEntry.findOne({ dateOfEntry });
    if (existingEntry) {
      return res.status(409).json({ message: 'An entry with this date already exists.' });
    }

    // Prepare the data object for the new entry
    const newData = {
      dateOfEntry,
      basicData: basicData || {},
      medicalRecord: medicalRecord || {},
      diary: diary || []
    };

    // Save the new entry to the database
    const newEntry = new HealthEntry(newData);
    await newEntry.save();

    // Return successfully created entry
    return res.status(201).json({
      message: 'Entry added successfully.',
      data: newEntry
    });

  } catch (error) {
    logger.error(`Error adding health entry: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /health-entries/:date: Get an entry by date.
exports.getHealthEntry = async (req, res) => {
  // Extract date from URL params
  const { date } = req.params;

  // Validate the date format
  if (!isValidDate(date)) {
    return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
  }

  try {
    // Attempt to find the entry by date
    const entry = await HealthEntry.findOne({ dateOfEntry: date });

    // Check if the entry was found
    if (!entry) {
      // Respond with not found status if no entry exists for the given date
      return res.status(404).json({ message: 'No entry found for the given date.', data: null });
    }

    // Respond with the found entry
    res.status(200).json({
      message: 'Entry found.',
      data: entry
    });
  } catch (error) {
    // Log and respond with error information in case of a server error
    logger.error(`Error fetching health entry: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// PUT /health-entries/:date: Update an entry by date.
exports.updateHealthEntry = async (req, res) => {
  const { date } = req.params;

  // Validate the date format
  if (!isValidDate(date)) {
    return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
  }

  // Check that at least one of the fields to be updated is provided
  const { basicData, medicalRecord, diary } = req.body;
  if (!basicData && !medicalRecord && !diary) {
    return res.status(400).json({ message: 'At least one of basicData, medicalRecord, or diary must be provided.' });
  }

  try {
    // Verify existence of the entry for the given date
    const entry = await HealthEntry.findOne({ dateOfEntry: date });
    if (!entry) {
      return res.status(404).json({ message: 'No entry found for the given date.' });
    }

    // Apply updates based on provided data
    if (basicData !== undefined) entry.basicData = basicData;
    if (medicalRecord !== undefined) entry.medicalRecord = medicalRecord;
    if (diary !== undefined) entry.diary = diary;

    // Save the updated entry to the database
    const updatedEntry = await entry.save();

    // Respond with the updated entry
    res.status(200).json({
      message: 'Entry updated successfully.',
      data: updatedEntry
    });

  } catch (error) {
    // Log and respond with error information in case of server error
    logger.error(`Error updating health entry: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// GET /health-entries: Get entries within a certain date range.
exports.getHealthEntries = async (req, res) => {
  const { start, end } = req.query;

  // Validate the start and end date formats
  if (!start || !end || !isValidDate(start) || !isValidDate(end)) {
    return res.status(400).json({ message: 'Invalid or missing start/end date format. Please use YYYY-MM-DD.' });
  }

  // The start date should not be after the end date
  if(new Date(start) > new Date(end)) {
    return res.status(400).json({ message: 'Start date cannot be after the end date.' });
  }

  try {
    // Fetch data from database for the given date range
    const entries = await HealthEntry.find({
      dateOfEntry: { $gte: start, $lte: end }
    }).sort({ dateOfEntry: 1 }); // Sorting by dateOfEntry in ascending order

    // Check if entries were found
    if (!entries.length) {
      return res.status(404).json({ message: 'No entries found for the given date range.', data: [] });
    }

    // Return the entries found within the given date range
    res.status(200).json({
      message: 'Entries retrieved successfully.',
      data: entries
    });

  } catch (error) {
    // Log and respond with error information in case of a server error
    logger.error(`Error fetching health entries: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// DELETE /health-entries/:date: Delete an entry by date
exports.deleteHealthEntry = async (req, res) => {
  const { date } = req.params;

  // Validate the provided date
  if (!isValidDate(date)) {
    return res.status(400).json({ message: 'Invalid date format. Please use YYYY-MM-DD.' });
  }

  try {
    // Attempt to find and delete the entry from the database
    const deletedEntry = await HealthEntry.findOneAndDelete({ dateOfEntry: date });

    // If no entry was found or deleted, return a not found response
    if (!deletedEntry) {
      return res.status(404).json({ message: 'No entry found for the given date.' });
    }

    // Return a success response, including data of the deleted entry
    res.status(200).json({
      message: 'Entry deleted successfully.',
      deletedData: deletedEntry
    });

  } catch (error) {
    // Log error and return an internal server error response
    logger.error(`Error deleting health entry: ${error.message}`);
    return res.status(500).json({ message: 'Internal server error.' });
  }
};

// POST /health-entries/diary: Append id to diary of health entry, or create new if not existing
exports.append_diary = async (req, res) => {
  const { date, id } = req.body;

  // Validate date and id
  if (!date || !isValidDate(date)) {
      return res.status(400).json({ status: 'ERROR', message: 'Invalid or missing date.' });
  }

  if (!id) {
      return res.status(400).json({ status: 'ERROR', message: 'Missing id.' });
  }

  try {
      // Check if an entry for the given date exists
      let entry = await HealthEntry.findOne({ dateOfEntry: date });

      if (entry) {
          // Check if the provided id is already in the diary
          if (!entry.diary.includes(id)) {
              // Append the id and save the entry
              entry.diary.push(id);
              await entry.save();
              res.status(200).json({ status: 'OK', message: 'Id added to existing diary entry.' });
          } else {
              // Id already present
              res.status(200).json({ status: 'OK', message: 'Id already present in the diary for this date.' });
          }
      } else {
          // Create a new entry with the provided id in the diary
          const newEntry = new HealthEntry({
              dateOfEntry: date,
              diary: [id], // Initialize diary with the provided id
              basicData: {}, // Assuming your entry structure requires these
              medicalRecord: {},
          });
          await newEntry.save();
          res.status(201).json({ status: 'OK', message: 'New diary entry created with id.' });
      }
  } catch (error) {
      logger.error(`Error appending diary ID: ${error.message}`);
      res.status(500).json({ status: 'ERROR', message: 'Server error while processing request.' });
  }
};
