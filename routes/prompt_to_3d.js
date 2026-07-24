const express = require('express');
const controller = require('../controllers/promptTo3dController');

const router = express.Router();

router.use(express.json({ limit: '256kb' }));
router.get('/', controller.renderIndex);
router.post('/jobs', controller.createJob);
router.get('/jobs/:jobId', controller.getJob);

module.exports = router;
