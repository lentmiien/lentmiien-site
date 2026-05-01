const express = require('express');
const multer = require('multer');
const router = express.Router();

// Require controller modules.
const controller = require('../controllers/apicontroller');
const apiRecordController = require('../controllers/apiRecordController');
const audioWorkflowController = require('../controllers/audioWorkflowController');

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

const handleAudioWorkflowUpload = (req, res, next) => {
  audioUpload.single('audio')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Audio file exceeds the 25MB limit.'
        : 'Unable to process the uploaded audio.';
      return res.status(400).json({ error: message });
    }
    return audioWorkflowController.uploadAudio(req, res, next);
  });
};

/* GET home page. */
router.all('*', controller.root);

/* Bin packing */
router.post('/binpacking', controller.binPacking);

/* Product details */
router.post('/productDetails', controller.processProductDetails);

/* Health log */
router.get('/getHealthEntries', controller.getHealthEntries);
router.post('/updateHealthEntry', controller.updateHealthEntry);
router.post('/uploadHealthCsv', controller.uploadHealthCsv);
router.post('/deleteHealthEntry', controller.deleteHealthEntry);

/* Message inbox */
router.post('/messages', controller.saveIncomingMessage);

/* Audio workflow */
router.post('/audio/upload', handleAudioWorkflowUpload);
router.get('/audio/jobs/:jobId', audioWorkflowController.getJob);
router.get('/audio/output/:outputAudioId', audioWorkflowController.getOutputAudio);

/* Chat */
router.get('/getChatEntries', controller.getChatEntries);
router.post('/chat5/sendResponse', controller.chat5SendResponse);
router.post('/chat5/batchSendResponse', controller.chat5BatchSendResponse);
router.get('/chat5/fetchLastMessage', controller.fetchLastMessage);

/* External */
router.get('/testConnect', controller.testConnect);
router.get('/fetchFeedback', controller.fetchFeedback);
router.post('/setTask', controller.setTask);

/* Records */
router.get('/records', apiRecordController.requireApiRecordUser, apiRecordController.fetchRecords);
router.get('/records/orders', apiRecordController.requireApiRecordUser, apiRecordController.fetchRecordOrdersByTitle);
router.get('/records/:id', apiRecordController.requireApiRecordUser, apiRecordController.fetchRecordById);
router.post('/records', apiRecordController.requireApiRecordUser, apiRecordController.upsertRecords);
router.delete('/records/:id', apiRecordController.requireApiRecordUser, apiRecordController.deleteRecord);

/* Exchange rates */
router.post('/exchangeRates', controller.updateExchangeRates);

module.exports = router;
