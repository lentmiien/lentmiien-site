require('dotenv').config();

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
const bcrypt = require('bcryptjs');
const expressStaticGzip = require('express-static-gzip');
const crypto = require('crypto');

// Database models
const { UseraccountModel, RoleModel, HtmlPageRating } = require('./database');
const { HTML_RATING_CATEGORIES, computeAverageRating } = require('./utils/htmlRatings');

// Initialize app and server
const app = express();
const server = http.createServer(app);
app.set('logger', logger);

// Session middleware
const sessionMiddleware = expressSession({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
});
app.use(sessionMiddleware);

// Setup Socket.io
const socketIO = require('./socket_io/index');
const scheduleDailyBatchTrigger = require('./schedulers/batchTrigger');
const scheduleDatabaseUsageMonitor = require('./schedulers/databaseUsageMonitor');
const io = socketIO(server, sessionMiddleware);
app.set('io', io);

// Setup webhooks
// app.use(express.text({ type: 'application/json' }));
const webhook = require('./routes/webhook');
app.use('/webhook', webhook);

// Body parsers
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

// App health
app.use('/apphealth', (req, res) => res.json({status: "ok"}));

// Passport setup
app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new LocalStrategy((username, password, done) => {
    UseraccountModel.findOne({ name: username }).then(async (user) => {
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }

      // If password is not hashed, hash it
      if (user.hash_password.length === 1) {
        user.hash_password = bcrypt.hashSync(password, 10);
        await user.save();
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
const blogRouter = require('./routes/blog');
const cookingPublicRouter = require('./routes/cooking_public');
const mypageRouter = require('./routes/mypage');
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
const ocrRouter = require('./routes/ocr');
const asrRouter = require('./routes/asr');
const soraRouter = require('./routes/sora');
const adminRouter = require('./routes/admin');
const tmpFilesRouter = require('./routes/tmp_files');
const yamlRouter = require('./routes/yaml');

app.use('/', indexRouter);
app.use('/api', isAuthenticated, apiRouter);
app.use('/mydhlapi/test', dummyapiRouter);
app.use('/webapi/servlet', dummyapiRouter);
app.use('/blog', blogRouter);
app.use('/cookingp', cookingPublicRouter);
app.use('/yaml-viewer', yamlRouter);
app.use('/mypage', isAuthenticated, mypageRouter);
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
app.use('/gallery', isAuthenticated, authorize("gallery"), galleryRouter);
app.use('/payroll', isAuthenticated, authorize("payroll"), payrollRouter);
app.use('/scheduleTask', isAuthenticated, authorize("scheduletask"), scheduleTaskRouter);
app.use('/image_gen', isAuthenticated, authorize("image_gen"), imageGenRouter);
app.use('/ocr', isAuthenticated, authorize("ocr"), ocrRouter);
app.use('/asr', isAuthenticated, authorize("asr"), asrRouter);
app.use('/sora', isAuthenticated, authorize("sora"), soraRouter);
app.use('/tmp-files', isAuthenticated, isAdmin, tmpFilesRouter);
app.use('/admin', isAuthenticated, isAdmin, adminRouter);

app.post(
  '/login',
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

// Function to generate the main page listing all games
const generateMainPage = () => {
  const gameLinks = fs.readdirSync(gamesDirectory)
    .filter(gameFolder => fs.statSync(path.join(gamesDirectory, gameFolder)).isDirectory())
    .map(gameFolder => `<li><a href="/${gameFolder}">${gameFolder}</a></li>`)
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Available Games</title>
    </head>
    <body>
        <h1>Available Games</h1>
        <ul>
            ${gameLinks}
        </ul>
    </body>
    </html>
  `;
};

// Initialize serving of games
serveGames();

// Main route to display all available games
app.get('/games', (req, res) => {
  const mainPage = generateMainPage();
  res.send(mainPage);
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
