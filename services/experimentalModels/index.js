const { LabStore } = require('./storage');
// One store per Site process. Importing it performs no I/O or inference.
module.exports = new LabStore();
