const Pixal3dGatewayService = require('./pixal3dGatewayService');
const Pixal3dJobService = require('./pixal3dJobService');

const gateway = new Pixal3dGatewayService();
const jobService = new Pixal3dJobService({ gateway });

module.exports = {
  gateway,
  jobService,
};
