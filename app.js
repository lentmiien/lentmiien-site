require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const expressSession = require('express-session');
const bcrypt = require('bcryptjs');

// Require necessary database models
const { UseraccountModel, RoleModel } = require('./database');

const app = express();

// Middleware
// Due to potential long loading times cache files in folders "/img" and "/mp3"
app.get('/img', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
app.get('/mp3', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(expressSession({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Passport configuration
passport.use(
  new LocalStrategy((username, password, done) => {
    UseraccountModel.findOne({ name: username }).then(async (user) => {
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }

      // console.log(user);
      // console.log(bcrypt.hashSync(password, 10));
      if (user.hash_password.length === 1) {
        user.hash_password = bcrypt.hashSync(password, 10);
        await user.save();
      }

      bcrypt.compare(password, user.hash_password, (err, isMatch) => {
        if (err) throw err;
        if (isMatch) {
          return done(null, user);
        } else {
          return done(null, false, { message: 'Incorrect password.' });
        }
      });
    });
  })
);

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser((id, done) => {
  UseraccountModel.findOne({ _id: id }).then((user) => {
    done(null, user);
  });
});

// Middleware to check authentication and serve VUE app only if authenticated
app.use((req, res, next) => {
  if ("VUE_PATH" in process.env && req.isAuthenticated && req.isAuthenticated()) {
    express.static(process.env.VUE_PATH)(req, res, next);
  } else {
    next();
  }
});
app.use(express.static(path.join(__dirname, 'public')));

// Routes
// Public - routes
app.all('*', async (req, res, next) => {
  res.locals.loggedIn = false;
  if (req.isAuthenticated()) {
    res.locals.loggedIn = true;
    res.locals.name = req.user.name;
    res.locals.admin = req.user.type_user === "admin";
  }
  if (process.env.HIDE_GTAG && process.env.HIDE_GTAG === "YES") {
    res.locals.gtag = false;
  } else {
    res.locals.gtag = true;
  }

  // Load permissions
  const permissions = [];
  if (req.isAuthenticated()) {
    const roles = await RoleModel.find({name:[req.user.name, req.user.type_user]});
    roles.forEach(d => {
      for (let i = 0; i < d.permissions.length; i++) {
        if (permissions.indexOf(d.permissions[i]) === -1) permissions.push(d.permissions[i]);
      }
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

  next();
});

const apiRouter = require('./routes/api');
app.use('/api', isAuthenticated, apiRouter);

const indexRouter = require('./routes/index');
app.use('/', indexRouter);

const blogRouter = require('./routes/blog');
app.use('/blog', blogRouter);

app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/mypage',
    failureRedirect: '/login',
  })
);

const cooking_publicRouter = require('./routes/cooking_public');
app.use('/cookingp', cooking_publicRouter);

// Private - routes
const mypageRouter = require('./routes/mypage');
app.use('/mypage', isAuthenticated, mypageRouter);

const chatRouter = require('./routes/chat');
app.use('/chat', isAuthenticated, authorize("chat"), chatRouter);

const chat2Router = require('./routes/chat2');
app.use('/chat2', isAuthenticated, authorize("chat2"), chat2Router);

const chat3Router = require('./routes/chat3');
app.use('/chat3', isAuthenticated, authorize("chat3"), chat3Router);

const chat4Router = require('./routes/chat4');
app.use('/chat4', isAuthenticated, authorize("chat4"), chat4Router);

const openaiRouter = require('./routes/openai');
app.use('/openai', isAuthenticated, authorize("openai"), openaiRouter);

const embeddingRouter = require('./routes/embedding');
app.use('/embedding', isAuthenticated, authorize("embedding"), embeddingRouter);

const gptdocumentRouter = require('./routes/gptdocument');
app.use('/gptdocument', isAuthenticated, authorize("gptdocument"), gptdocumentRouter);

const budgetRouter = require('./routes/budget');
app.use('/accounting', isAuthenticated, authorize("accounting"), budgetRouter);

const cookingRouter = require('./routes/cooking');
app.use('/cooking', isAuthenticated, authorize("cooking"), cookingRouter);

const healthRouter = require('./routes/health');
app.use('/health', isAuthenticated, authorize("health"), healthRouter);

const boxRouter = require('./routes/box');
app.use('/box', isAuthenticated, authorize("box"), boxRouter);

const quicknoteRouter = require('./routes/quicknote');
app.use('/quicknote', isAuthenticated, authorize("quicknote"), quicknoteRouter);

const esRouter = require('./routes/es');
app.use('/es', isAuthenticated, authorize("emergencystock"), esRouter);

const receiptRouter = require('./routes/receipt');
app.use('/receipt', isAuthenticated, authorize("receipt"), receiptRouter);

const productRouter = require('./routes/product_details');
app.use('/product', isAuthenticated, authorize("product"), productRouter);

const adminRouter = require('./routes/admin');
app.use('/admin', isAuthenticated, isAdmin, adminRouter);

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.user.type_user === 'admin') {
    return next();
  }
  res.redirect('/');
}

function authorize(routeName) {
  return async (req, res, next) => {
      const userrole = req.user.type_user;
      const username = req.user.name;

      // First look for user-specific roles
      const userSpecificRole = await RoleModel.findOne({ name: username, type: 'user' });
      if (userSpecificRole && userSpecificRole.permissions.includes(routeName)) {
        return next();
      }

      // If no user-specific role or not authorized, check group role
      const groupRole = await RoleModel.findOne({ name: userrole, type: 'group' });
      if (!groupRole || !groupRole.permissions.includes(routeName)) {
        return res.status(403).render('accessDenied', {
          title: 'Access Denied',
          message: 'You do not have permission to access this page. Please contact support if you think this is a mistake.',
          user: req.user // Pass user info to display personalized navbar or options
        });
      }

      // Everything OK
      next();
  };
}

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
