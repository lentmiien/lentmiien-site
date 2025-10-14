const express = require('express');
const swaggerUi = require('swagger-ui-express');

const router = express.Router();

const controller = require('../controllers/yamlcontroller');

router.get('/', controller.renderLanding);
router.get('/spec/:filename', controller.getSpec);
router.use('/view/:filename', swaggerUi.serve, controller.renderSwagger);

module.exports = router;
