const express = require('express');
const router = express.Router();

const controller = require('../controllers/clusterPlannerController');

router.get('/', controller.home);
router.get('/api/state', controller.state);
router.post('/api/inventory', controller.save_inventory);
router.delete('/api/inventory/:id', controller.delete_inventory);
router.post('/api/node-type/:id', controller.save_node_type);
router.post('/api/hardware', controller.save_hardware);
router.delete('/api/hardware/:id', controller.delete_hardware);

module.exports = router;
