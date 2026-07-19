const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => res.render('lego_sculpture_converter', {
  pageTitle: 'Brickify 3D — GLB-aware LEGO Sculpture Converter',
}));

module.exports = router;
