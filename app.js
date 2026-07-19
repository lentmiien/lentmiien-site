require('dotenv').config({ quiet: true });

// Core modules
const fs = require('fs');
const path = require('path');
const http = require('http');
const logger = require('./utils/logger');

// NPM packages
const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const expressSession = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const expressStaticGzip = require('express-static-gzip');
const crypto = require('crypto');
const { ensurePublicTobuyListPath } = require('./utils/publicTobuyList');
const { ensureRequestCounterPath } = require('./utils/requestCounterPath');
const { ensureMinuteLoggerPath } = require('./utils/minuteLoggerPath');
const { ensureDeviceUsagePath } = require('./utils/deviceUsagePath');

// Database models
const { UseraccountModel, RoleModel, HtmlPageRating, BookmarkModel } = require('./database');
const { HTML_RATING_CATEGORIES, computeAverageRating } = require('./utils/htmlRatings');
const performanceMetrics = require('./services/performanceMetricsService');
const createPerformanceMetricsMiddleware = require('./middleware/performanceMetrics');

// Initialize app and server
const app = express();
const server = http.createServer(app);
app.set('logger', logger);

function getPositiveIntegerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getBooleanEnv(name, fallback = false) {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(rawValue).trim().toLowerCase());
}

function getTrustProxyValue(rawValue) {
  if (rawValue === undefined || rawValue === '') {
    return process.env.NODE_ENV === 'production' ? 1 : false;
  }
  if (rawValue === 'true') return 1;
  if (rawValue === 'false') return false;
  const numericValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(numericValue) ? numericValue : rawValue;
}

function isBcryptHash(value) {
  return typeof value === 'string'
    && /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/.test(value);
}

const isProduction = process.env.NODE_ENV === 'production';
const trustProxyValue = getTrustProxyValue(process.env.TRUST_PROXY);
if (trustProxyValue !== false) {
  app.set('trust proxy', trustProxyValue);
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

const loginLimiter = rateLimit({
  windowMs: getPositiveIntegerEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: getPositiveIntegerEnv('LOGIN_RATE_LIMIT_MAX', 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.',
});

const publicWriteLimiter = rateLimit({
  windowMs: getPositiveIntegerEnv('PUBLIC_WRITE_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: getPositiveIntegerEnv('PUBLIC_WRITE_RATE_LIMIT_MAX', 30),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
});

const telemetryLimiter = rateLimit({
  windowMs: getPositiveIntegerEnv('PUBLIC_TELEMETRY_RATE_LIMIT_WINDOW_MS', 60 * 1000),
  limit: getPositiveIntegerEnv('PUBLIC_TELEMETRY_RATE_LIMIT_MAX', 120),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

// Session middleware
const sessionMiddleware = expressSession({
  name: process.env.SESSION_COOKIE_NAME || 'lentmiien.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: process.env.SESSION_COOKIE_SAMESITE || 'lax',
    secure: getBooleanEnv('SESSION_COOKIE_SECURE', isProduction),
    maxAge: getPositiveIntegerEnv('SESSION_COOKIE_MAX_AGE_MS', 24 * 60 * 60 * 1000),
  },
});
app.use(sessionMiddleware);

// Setup Socket.io
const socketIO = require('./socket_io/index');
const scheduleDailyBatchTrigger = require('./schedulers/batchTrigger');
const scheduleDatabaseUsageMonitor = require('./schedulers/databaseUsageMonitor');
const scheduleAgent5Runner = require('./schedulers/agent5');
const scheduleOpenAIResponseRecovery = require('./schedulers/openaiResponseRecovery');
const scheduleDisasterIngestion = require('./schedulers/disasterIngestion');
const audioWorkflowService = require('./services/audioWorkflowInstance');
const codexQueueWorker = require('./services/codexQueueWorker');
const io = socketIO(server, sessionMiddleware);
app.set('io', io);

performanceMetrics.start();
app.use(createPerformanceMetricsMiddleware(performanceMetrics));

// Setup webhooks
// app.use(express.text({ type: 'application/json' }));
const webhook = require('./routes/webhook');
app.use('/webhook', webhook);

// Body parsers
const DEFAULT_BODY_LIMIT = '5mb';
app.use(bodyParser.urlencoded({ extended: false, limit: DEFAULT_BODY_LIMIT }));
app.use(express.json({ limit: DEFAULT_BODY_LIMIT }));

// App health
app.use('/apphealth', (req, res) => res.json({status: "ok"}));

// Public hidden request counter endpoint
const requestCounterRouter = require('./routes/request_counter');
const requestCounterPath = ensureRequestCounterPath();
app.use(requestCounterPath, telemetryLimiter, requestCounterRouter);

// Public hidden device usage endpoint
const deviceUsageRouter = require('./routes/device_usage');
const deviceUsagePath = ensureDeviceUsagePath();
app.use(deviceUsagePath, telemetryLimiter, deviceUsageRouter);

// Public hidden minute logger endpoint
const minuteLoggerRouter = require('./routes/minute_logger');
const minuteLoggerPath = ensureMinuteLoggerPath();
app.use(minuteLoggerPath, telemetryLimiter, minuteLoggerRouter);

// Passport setup
app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new LocalStrategy((username, password, done) => {
    UseraccountModel.findOne({ name: username }).then(async (user) => {
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }

      if (!isBcryptHash(user.hash_password)) {
        logger.warning('Rejected login for account without a bcrypt password hash', {
          category: 'auth',
          metadata: {
            userId: user._id ? user._id.toString() : null,
            username: user.name,
          },
        });
        return done(null, false, { message: 'Password reset required.' });
      }

      bcrypt.compare(password, user.hash_password, (err, isMatch) => {
        if (err) return done(err);
        if (isMatch) {
          return done(null, user);
        } else {
          return done(null, false, { message: 'Incorrect password.' });
        }
      });
    })
    .catch((err) => done(err));
  })
);

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser((id, done) => {
  UseraccountModel.findOne({ _id: id })
    .then((user) => {
      done(null, user);
    })
    .catch((err) => done(err));
});

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

const htmlDirectory = path.join(__dirname, 'public', 'html');

// Middleware to set res.locals
app.use(async (req, res, next) => {
  res.locals.loggedIn = req.isAuthenticated();
  res.locals.currentPath = req.originalUrl || '/';
  if (res.locals.loggedIn) {
    res.locals.name = req.user.name;
    res.locals.admin = req.user.type_user === 'admin';
  }
  res.locals.gtag = !(process.env.HIDE_GTAG && process.env.HIDE_GTAG === 'YES');

  // Load permissions
  const permissions = [];
  if (req.isAuthenticated()) {
    const roles = await RoleModel.find({
      name: [req.user.name, req.user.type_user],
    });
    roles.forEach((d) => {
      d.permissions.forEach((permission) => {
        if (!permissions.includes(permission)) {
          permissions.push(permission);
        }
      });
    });
  }
  res.locals.permissions = permissions;

  // Load bookmark links
  const bookmarks = [];
  if (req.isAuthenticated()) {
    try {
      const bookmarkEntries = await BookmarkModel.find({ user: req.user.name })
        .sort({ importance: -1, updatedAt: -1, title: 1 })
        .select({ title: 1, url: 1, importance: 1 })
        .lean()
        .exec();
      bookmarkEntries.forEach((entry) => {
        if (!entry || !entry.title || !entry.url) {
          return;
        }
        bookmarks.push({
          title: entry.title,
          url: entry.url,
          importance: Number.isFinite(entry.importance) ? entry.importance : 0,
        });
      });
    } catch (error) {
      logger.warning('Unable to hydrate bookmark list', {
        category: 'layout',
        metadata: { error: error.message },
      });
    }
  }
  res.locals.bookmarks = bookmarks;

  // Set social media tags
  res.locals.og_title = 'Lennart\'s Website';
  res.locals.og_type = 'website';
  res.locals.og_url = 'https://home.lentmiien.com/';
  res.locals.og_image = 'https://home.lentmiien.com/image.jpg';
  res.locals.og_description = 'Welcome to the digital home of Lennart, where technology meets culinary art and cultural exploration. Based in Japan with Swedish origins, I am a seasoned programmer specializing in JavaScript, AI, and machine learning. I lead a dynamic team to enhance English customer service through innovative tech solutions. Beyond programming, I indulge in fusing Swedish and Japanese culinary traditions, finding joy in creating nutritious and delicious dishes. My life in Japan enriches me deeply, embracing its culture in my journey of personal and professional growth. Through this website, I aim to share my adventures in integrating technology with everyday life, culinary experiments, and the insights gained from my cross-cultural experiences. Join me in exploring the seamless blend of innovation, tradition, and natural beauty.';
  res.locals.og_site_name = 'Lennart\'s Website';
  res.locals.og_image_width = '1200';
  res.locals.og_image_height = '630';
  res.locals.twitter_card = 'summary_large_image';
  res.locals.twitter_creator = '@lentmiien';
  res.locals.twitter_title = 'Lennart\'s Website';
  res.locals.twitter_description = 'Welcome to the digital home of Lennart, where technology meets culinary art and cultural exploration. Based in Japan with Swedish origins, I am a seasoned programmer specializing in JavaScript, AI, and machine learning. I lead a dynamic team to enhance English customer service through innovative tech solutions. Beyond programming, I indulge in fusing Swedish and Japanese culinary traditions, finding joy in creating nutritious and delicious dishes. My life in Japan enriches me deeply, embracing its culture in my journey of personal and professional growth. Through this website, I aim to share my adventures in integrating technology with everyday life, culinary experiments, and the insights gained from my cross-cultural experiences. Join me in exploring the seamless blend of innovation, tradition, and natural beauty.';
  res.locals.twitter_image = 'https://home.lentmiien.com/image.jpg';
  res.locals.twitter_image_alt = 'A fusion of Swedish and Japanese cultures set within a modern, technology-driven landscape. Picture a serene Japanese garden blending seamlessly into a snowy Swedish forest. In the foreground, a traditional Swedish wooden table filled with a mix of Japanese and Swedish dishes, expertly prepared and beautifully presented. Scattered among these dishes are subtle elements of technology, such as a futuristic AI interface and small, high-tech gadgets that enhance the dining experience. A harmonious blend of nature, technology, gastronomy, and cultural integration, capturing the essence of a balanced, innovative lifestyle.';

  const htmlPaths = [];
  try {
    const ratingEntries = await HtmlPageRating.find({ isPublic: true }).lean().exec();
    ratingEntries.forEach((entry) => {
      const fileName = entry.filename;
      if (!fileName) {
        return;
      }
      const filePath = path.join(htmlDirectory, fileName);
      if (!fs.existsSync(filePath)) {
        return;
      }
      const displayName = fileName.replace(/\.html$/i, '');
      const ratings = HTML_RATING_CATEGORIES.map((category) => {
        const score = entry.ratings && Number.isFinite(entry.ratings[category.key])
          ? entry.ratings[category.key]
          : null;
        return {
          key: category.key,
          label: category.label,
          score,
        };
      });
      htmlPaths.push({
        path: `/html/${fileName}`,
        name: displayName,
        ratings,
        averageRating: computeAverageRating(entry.ratings),
        version: entry.version || 1,
      });
    });
    htmlPaths.sort((a, b) => {
      const aAvg = Number.isFinite(a.averageRating) ? a.averageRating : 0;
      const bAvg = Number.isFinite(b.averageRating) ? b.averageRating : 0;
      if (bAvg !== aAvg) {
        return bAvg - aAvg;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    logger.warning('Unable to hydrate HTML samples list', {
      category: 'layout',
      metadata: { error: error.message },
    });
  }
  res.locals.htmlPaths = htmlPaths;

  next();
});

app.get('/', (req, res, next) => {
  if (typeof req.isAuthenticated === 'function' && req.isAuthenticated()) {
    return res.redirect('/mypage');
  }
  return next();
});

// ----- VUE APP -----
app.use((req, res, next) => {
  if ("VUE_PATH" in process.env && req.isAuthenticated && req.isAuthenticated()) {
    express.static(process.env.VUE_PATH)(req, res, next);
  } else {
    next();
  }
});
// -------------------

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/katex', express.static(path.join(__dirname, 'node_modules', 'katex', 'dist')));
app.use('/vendor/mermaid', express.static(path.join(__dirname, 'node_modules', 'mermaid', 'dist')));

// Middleware for caching static files
app.use('/img', express.static(path.join(__dirname, 'public', 'img'), {
  maxAge: '1y',
  immutable: true,
}));
app.use('/mp3', express.static(path.join(__dirname, 'public', 'mp3'), {
  maxAge: '1y',
  immutable: true,
}));

// Routes
const indexRouter = require('./routes/index');
const apiRouter = require('./routes/api');
const dummyapiRouter = require('./routes/dummyapi');
const dummyDebugApiRouter = require('./routes/dummy_debug_api');
const blogRouter = require('./routes/blog');
const cookingPublicRouter = require('./routes/cooking_public');
const mypageRouter = require('./routes/mypage');
const learningRouter = require('./routes/learning');
const chatRouter = require('./routes/chat');
const chat2Router = require('./routes/chat2');
const chat3Router = require('./routes/chat3');
const chat4Router = require('./routes/chat4');
const chat5Router = require('./routes/chat5');
const openaiRouter = require('./routes/openai');
const embeddingRouter = require('./routes/embedding');
const gptdocumentRouter = require('./routes/gptdocument');
const legacyBudgetRouter = require('./routes/budget');
const accountingRouter = require('./routes/accounting');
const cookingRouter = require('./routes/cooking');
const healthRouter = require('./routes/health');
const boxRouter = require('./routes/box');
const binPackingRouter = require('./routes/binpacking');
const quicknoteRouter = require('./routes/quicknote');
const esRouter = require('./routes/es');
const receiptRouter = require('./routes/receipt');
const productRouter = require('./routes/product_details');
const galleryRouter = require('./routes/gallery');
const payrollRouter = require('./routes/payroll');
const scheduleTaskRouter = require('./routes/scheduleTaskRoute');
const imageGenRouter = require('./routes/image_gen');
const gptImageRouter = require('./routes/gpt_image');
const musicRouter = require('./routes/music');
const ocrRouter = require('./routes/ocr');
const ocrTtsRouter = require('./routes/ocr_tts');
const asrRouter = require('./routes/asr');
const soraRouter = require('./routes/sora');
const qwen3LoraRouter = require('./routes/qwen3_lora');
const trellis2Router = require('./routes/trellis2');
const pixal3dRouter = require('./routes/pixal3d');
const codexRouter = require('./routes/codex');
const adminRouter = require('./routes/admin');
const tmpFilesRouter = require('./routes/tmp_files');
const yamlRouter = require('./routes/yaml');
const shoppingListRouter = require('./routes/shopping_list');
const publicTobuyListRouter = require('./routes/public_tobuy_list');
const bookmarkRouter = require('./routes/bookmarks');
const clusterPlannerRouter = require('./routes/ai_cluster_planner');
const publicTobuyListPath = ensurePublicTobuyListPath();

app.use('/', indexRouter);
app.use('/', dummyDebugApiRouter);
app.use(publicTobuyListPath, publicWriteLimiter, publicTobuyListRouter);
app.use('/api', isAuthenticated, apiRouter);
app.use('/mydhlapi/test', dummyapiRouter);
app.use('/webapi/servlet', dummyapiRouter);
app.use('/blog', blogRouter);
app.use('/cookingp', cookingPublicRouter);
app.use('/yaml-viewer', yamlRouter);
app.use('/mypage', isAuthenticated, mypageRouter);
app.use('/learning', isAuthenticated, learningRouter);
app.use('/chat', isAuthenticated, authorize("chat"), chatRouter);
app.use('/chat2', isAuthenticated, authorize("chat2"), chat2Router);
app.use('/chat3', isAuthenticated, authorize("chat3"), chat3Router);
app.use('/chat4', isAuthenticated, authorize("chat4"), chat4Router);
app.use('/chat5', isAuthenticated, authorize("chat5"), chat5Router);
app.use('/openai', isAuthenticated, authorize("openai"), openaiRouter);
app.use('/embedding', isAuthenticated, authorize("embedding"), embeddingRouter);
app.use('/gptdocument', isAuthenticated, authorize("gptdocument"), gptdocumentRouter);
app.use('/accounting', isAuthenticated, authorize("accounting"), accountingRouter);
app.use('/budget', isAuthenticated, authorize("budget"), accountingRouter);
app.use('/accounting/legacy', isAuthenticated, authorize("accounting"), legacyBudgetRouter);
app.use('/cooking', isAuthenticated, authorize("cooking"), cookingRouter);
app.use('/health', isAuthenticated, authorize("health"), healthRouter);
app.use('/box', isAuthenticated, authorize("box"), boxRouter);
app.use('/binpacking', isAuthenticated, authorize("binpacking"), binPackingRouter);
app.use('/quicknote', isAuthenticated, authorize("quicknote"), quicknoteRouter);
app.use('/es', isAuthenticated, authorize("emergencystock"), esRouter);
app.use('/receipt', isAuthenticated, authorize("receipt"), receiptRouter);
app.use('/product', isAuthenticated, authorize("product"), productRouter);
app.use('/ai-cluster-planner', isAuthenticated, authorize("test"), clusterPlannerRouter);
app.use('/gallery', isAuthenticated, authorize("gallery"), galleryRouter);
app.use('/payroll', isAuthenticated, authorize("payroll"), payrollRouter);
app.use('/scheduleTask', isAuthenticated, authorize("scheduletask"), scheduleTaskRouter);
app.use('/shopping-list', isAuthenticated, authorize("shoppinglist"), shoppingListRouter);
app.use('/bookmarks', isAuthenticated, bookmarkRouter);
app.use('/image_gen', isAuthenticated, authorize("image_gen"), imageGenRouter);
app.use('/gpt-image', isAuthenticated, gptImageRouter);
app.use('/music', isAuthenticated, authorize("music"), musicRouter);
app.use('/ocr', isAuthenticated, authorize("ocr"), ocrRouter);
app.use('/ocr-tts', isAuthenticated, authorize("ocr"), ocrTtsRouter);
app.use('/asr', isAuthenticated, authorize("asr"), asrRouter);
app.use('/sora', isAuthenticated, authorize("sora"), soraRouter);
app.use('/qwen3-lora', isAuthenticated, qwen3LoraRouter);
app.use('/trellis2', isAuthenticated, trellis2Router);
app.use('/pixal3d', isAuthenticated, pixal3dRouter);
app.use('/codex', isAuthenticated, codexRouter);
app.use('/tmp-files', isAuthenticated, isAdmin, tmpFilesRouter);
app.use('/admin', isAuthenticated, isAdmin, adminRouter);

app.post(
  '/login',
  loginLimiter,
  passport.authenticate('local', {
    successRedirect: '/mypage',
    failureRedirect: '/login',
  })
);


// Helper: constant-time compare to avoid timing attacks
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getBearerToken(req) {
  const auth = req.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function isApiRequest(req) {
  // Works whether or not the middleware is mounted globally or on a router
  return req.originalUrl && req.originalUrl.startsWith('/api');
}

// Authentication and authorization middlewares
function isAuthenticated(req, res, next) {
  // 1) Session-based authentication (e.g., Passport)
  if (typeof req.isAuthenticated === 'function' && req.isAuthenticated()) {
    req.authType = 'session';
    return next();
  }

  // 2) API key for /api routes
  if (isApiRequest(req)) {
    const token = getBearerToken(req);
    const expected = process.env.API_KEY;

    if (expected && token && timingSafeEqual(token, expected)) {
      req.authType = 'apiKey';
      return next();
    }

    // For API routes, return JSON 401 (never redirect)
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 3) Non-API routes: keep existing redirect behavior
  return res.redirect('/login');
}

function authorize(routeName) {
  return async (req, res, next) => {
    const userRole = req.user.type_user;
    const username = req.user.name;

    // Check user-specific roles
    const userSpecificRole = await RoleModel.findOne({ name: username, type: 'user' });
    if (userSpecificRole && userSpecificRole.permissions.includes(routeName)) {
      return next();
    }

    // Check group roles
    const groupRole = await RoleModel.findOne({ name: userRole, type: 'group' });
    if (groupRole && groupRole.permissions.includes(routeName)) {
      return next();
    }

    res.status(403).render('accessDenied', {
      title: 'Access Denied',
      message: 'You do not have permission to access this page.',
      user: req.user,
    });
  };
}

function isAdmin(req, res, next) {
  if (req.user.type_user === 'admin') {
    return next();
  }
  res.redirect('/');
}

// ----- GAMES -----
const gamesDirectory = path.join(__dirname, 'games');

// Helper function to determine Content-Type based on file extension
const getContentType = (filepath) => {
  const ext = path.extname(filepath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html';
    case '.js':
      return 'application/javascript';
    case '.css':
      return 'text/css';
    case '.data':
      return 'application/octet-stream';
    case '.wasm':
      return 'application/wasm';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
};

// Middleware to serve each game with gzip support
const serveGames = () => {
  fs.readdirSync(gamesDirectory).forEach(gameFolder => {
    const gamePath = path.join(gamesDirectory, gameFolder);
    if (fs.statSync(gamePath).isDirectory()) {
      app.use(`/${gameFolder}`, expressStaticGzip(gamePath, {
        enableBrotli: true, // Enable Brotli if you have .br files
        orderPreference: ['br', 'gz'], // Prioritize Brotli over gzip
        setHeaders: (res, filepath) => {
          if (filepath.endsWith('.gz') || filepath.endsWith('.br')) {
            // Determine the original file extension
            let originalExt = path.extname(filepath.slice(0, filepath.lastIndexOf('.')));
            if (!originalExt) originalExt = path.extname(filepath);

            // Set the correct Content-Type
            const contentType = getContentType(filepath.slice(0, filepath.lastIndexOf('.')));
            if (contentType) {
              res.setHeader('Content-Type', contentType);
            }

            // Set Content-Encoding based on the compression
            if (filepath.endsWith('.gz')) {
              res.setHeader('Content-Encoding', 'gzip');
            } else if (filepath.endsWith('.br')) {
              res.setHeader('Content-Encoding', 'br');
            }
          }
        }
      }));
    }
  });
};

const formatGameName = (gameFolder) => gameFolder
  .split(/[-_]+/)
  .filter(Boolean)
  .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
  .join(' ');

const getAvailableGames = () => fs.readdirSync(gamesDirectory, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => ({
    name: formatGameName(entry.name),
    href: `/${encodeURIComponent(entry.name)}`,
  }))
  .sort((first, second) => first.name.localeCompare(second.name));

// Initialize serving of games
serveGames();

// Main route to display all available games
app.get('/games', (req, res) => {
  res.render('games', {
    pageTitle: 'Games',
    games: getAvailableGames(),
  });
});
// -----------------

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.notice(`Server started on port ${PORT}`, { category: 'server' });
});

server.on('error', (err) => {
  logger.error('Server encountered an error', { category: 'server', metadata: { error: err } });
});

scheduleDailyBatchTrigger();
scheduleDatabaseUsageMonitor();
scheduleAgent5Runner();
scheduleOpenAIResponseRecovery(app);
scheduleDisasterIngestion();
if (getBooleanEnv('CODEX_WEB_WORKER_ENABLED', getBooleanEnv('CODEX_WORKER_ENABLED', true))) {
  codexQueueWorker.start();
} else {
  logger.notice('Embedded Codex queue worker disabled by configuration', {
    category: 'codex_tool',
  });
}
audioWorkflowService.start().catch((error) => {
  logger.error('Failed to start audio workflow service', {
    category: 'audio_workflow',
    metadata: { error: error.message },
  });
});
