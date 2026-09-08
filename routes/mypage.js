const express = require('express');
const router = express.Router();

const multer = require('multer');
const upload = multer({
  dest: './tmp_data/',
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1,
  },
});

// Require controller modules.
// Legacy controllers initialize integrations; load only for legacy operations.
const controller = new Proxy({}, { get: (_, key) => (req, res, next) => require('../controllers/mypagecontroller')[key](req, res, next) });
const { createAccountDashboard } = require('./accountDashboard');
const { router: mypageTasks } = require('./mypageTasks');

const { resolvePolicy, allows, SECTIONS } = require('../services/accountSurfacePolicy');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const legacyLifeCsrf = createSessionCsrf();
const requireAdminLifeLog = async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  const policy = await resolvePolicy(req.user, require('../models/role'));
  if (!allows(policy, SECTIONS.find(s => s.id === 'life'))) return res.status(403).json({ error: 'Life log unavailable.' });
  if (!['GET', 'HEAD'].includes(req.method)) {
    if (!policy.capabilities.includes('dashboard.personal.write')) return res.status(403).json({ error: 'Life log unavailable.' });
    return legacyLifeCsrf.requireToken(req, res, next);
  }
  next();
};

const dashboard = createAccountDashboard();

const redirectLegacyLifeLog = (req, res) => {
  const suffix = req.url === '/' ? '' : req.url;
  return res.redirect(307, `/admin/life_log${suffix}`);
};

/* GET home page. */
router.use('/api/tasks', mypageTasks);
router.use((req, res, next) => {
  if (req.path === '/' || req.path === '/icon-settings' || req.path.startsWith('/api/')) return dashboard(req, res, next);
  next();
});

router.use('/embedding-search', require('./accountEmbedding'));

// Blogpost
router.get('/blogpost', controller.blogpost);
router.post('/post_blogpost', controller.post_blogpost);
router.post('/delete_blogpost', controller.delete_blogpost);

router.get('/speektome', controller.speektome);
router.post('/speektome', controller.speektome_post);
router.get('/showtome', controller.showtome);
router.post('/showtome', controller.showtome_post);

router.get('/pdf_to_jpg', controller.pdf_to_jpg);
router.post('/convert_pdf_to_jpg', upload.single('pdf'), controller.convert_pdf_to_jpg)
router.post('/pdf_to_chat', controller.pdf_to_chat)

/****
 * TEST GitHub
 */
router.get('/github', controller.github);
router.get('/getfolder', controller.getfolder);
router.get('/updatefolder', controller.updatefolder);
router.get('/getfile', controller.getfile);

// My Life Log moved to the admin router. Keep old links gated and redirected.
router.use('/life_log', requireAdminLifeLog, redirectLegacyLifeLog);

module.exports = router;
