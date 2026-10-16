const { LocalAiService } = require('./service');
const { Worker } = require('./worker');
const service = new LocalAiService();
const worker = new Worker(service);
module.exports = { service, worker };
