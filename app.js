require('dotenv').config();

// Core modules
const fs = require('fs');
const path = require('path');
const http = require('http');

// NPM packages
const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const expressSession = require('express-session');
const bcrypt = require('bcryptjs');
const expressStaticGzip = require('express-static-gzip');

// Database models
const { UseraccountModel, RoleModel } = require('./database');

// Initialize app and server
const app = express();
const server = http.createServer(app);

// Session middleware
const sessionMiddleware = expressSession({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
});
app.use(sessionMiddleware);

// Body parsers
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

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

  // Load HTML test content
  const htmlPaths = [];
  fs.readdirSync(htmlDirectory).forEach(file => {
    htmlPaths.push({path: `/html/${file}`, name: file.split(".")[0]})
  });
  res.locals["htmlPaths"] = htmlPaths;

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
const budgetRouter = require('./routes/budget');
const budget2Router = require('./routes/budget2');
const cookingRouter = require('./routes/cooking');
const healthRouter = require('./routes/health');
const boxRouter = require('./routes/box');
const quicknoteRouter = require('./routes/quicknote');
const esRouter = require('./routes/es');
const receiptRouter = require('./routes/receipt');
const productRouter = require('./routes/product_details');
const galleryRouter = require('./routes/gallery');
const adminRouter = require('./routes/admin');

app.use('/', indexRouter);
app.use('/api', isAuthenticated, apiRouter);
app.use('/blog', blogRouter);
app.use('/cookingp', cookingPublicRouter);
app.use('/mypage', isAuthenticated, mypageRouter);
app.use('/chat', isAuthenticated, authorize("chat"), chatRouter);
app.use('/chat2', isAuthenticated, authorize("chat2"), chat2Router);
app.use('/chat3', isAuthenticated, authorize("chat3"), chat3Router);
app.use('/chat4', isAuthenticated, authorize("chat4"), chat4Router);
app.use('/chat5', isAuthenticated, authorize("chat5"), chat5Router);
app.use('/openai', isAuthenticated, authorize("openai"), openaiRouter);
app.use('/embedding', isAuthenticated, authorize("embedding"), embeddingRouter);
app.use('/gptdocument', isAuthenticated, authorize("gptdocument"), gptdocumentRouter);
app.use('/accounting', isAuthenticated, authorize("accounting"), budgetRouter);
app.use('/budget', isAuthenticated, authorize("budget"), budget2Router);
app.use('/cooking', isAuthenticated, authorize("cooking"), cookingRouter);
app.use('/health', isAuthenticated, authorize("health"), healthRouter);
app.use('/box', isAuthenticated, authorize("box"), boxRouter);
app.use('/quicknote', isAuthenticated, authorize("quicknote"), quicknoteRouter);
app.use('/es', isAuthenticated, authorize("emergencystock"), esRouter);
app.use('/receipt', isAuthenticated, authorize("receipt"), receiptRouter);
app.use('/product', isAuthenticated, authorize("product"), productRouter);
app.use('/gallery', isAuthenticated, authorize("gallery"), galleryRouter);
app.use('/admin', isAuthenticated, isAdmin, adminRouter);

app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/mypage',
    failureRedirect: '/login',
  })
);

// Authentication and authorization middlewares
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
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
  console.log(`Server started on port ${PORT}`);
});

// Setup Socket.io
const socketIO = require('./socket_io');
socketIO(server, sessionMiddleware);
