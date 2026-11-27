const { Room } = require('./room');
const { Repository } = require('./repository');
module.exports = new Room({ repository: new Repository() });
