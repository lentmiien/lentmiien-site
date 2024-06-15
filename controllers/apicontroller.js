// API for the VUE app
const HealthService = require('../services/healthService');
const { HealthEntry } = require('../database');
// Services
const healthService = new HealthService(HealthEntry);

exports.root = async (req, res, next) => {
  // Do some initial checks and setups

  next();
}

exports.getHealthEntries = async (req, res) => {
  let entries = [];

  if ("start" in req.query && "end" in req.query) {
    entries = await healthService.getInRange(req.query.start, req.query.end);
  } else {
    entries = await healthService.getAll();
  }

  entries.sort((a,b) => {
    if (a.dateOfEntry < b.dateOfEntry) return 1;
    if (a.dateOfEntry > b.dateOfEntry) return -1;
    return 0;
  });

  res.json(entries);
};

exports.updateHealthEntry = async (req, res) => {
  const {date, basic, medical, diary} = req.body;
  res.json(await healthService.updateEntry(date, basic, medical, diary));
};

exports.upload_health_csv = async (req, res) => {
  const {inputDataArray, type} = req.body;
  res.json(await healthService.appendData(inputDataArray, type));
};
