const AudioWorkflowService = require('./audioWorkflowService');
const mongoose = require('mongoose');

module.exports = new AudioWorkflowService({
  databaseReady: () => mongoose.connection.readyState === 1,
});
