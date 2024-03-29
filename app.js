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
const { UseraccountModel } = require('./database');

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
app.use(express.static(path.join(__dirname, 'public')));
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

// Routes
// Public - routes
app.all('*', (req, res, next) => {
  res.locals.loggedIn = false;
  if (req.isAuthenticated()) {
    res.locals.loggedIn = true;
    res.locals.name = req.user.name;
  }
  if (process.env.HIDE_GTAG && process.env.HIDE_GTAG === "YES") {
    res.locals.gtag = false;
  } else {
    res.locals.gtag = true;
  }

  next();
});

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
app.use('/chat', isAuthenticated, chatRouter);

const chat2Router = require('./routes/chat2');
app.use('/chat2', isAuthenticated, chat2Router);

const chat3Router = require('./routes/chat3');
app.use('/chat3', isAuthenticated, chat3Router);

const chat4Router = require('./routes/chat4');
app.use('/chat4', isAuthenticated, chat4Router);

const openaiRouter = require('./routes/openai');
app.use('/openai', isAuthenticated, openaiRouter);

const embeddingRouter = require('./routes/embedding');
app.use('/embedding', isAuthenticated, embeddingRouter);

const gptdocumentRouter = require('./routes/gptdocument');
app.use('/gptdocument', isAuthenticated, gptdocumentRouter);

const budgetRouter = require('./routes/budget');
app.use('/accounting', isAuthenticated, budgetRouter);

const cookingRouter = require('./routes/cooking');
app.use('/cooking', isAuthenticated, cookingRouter);

const healthRouter = require('./routes/health');
app.use('/health', isAuthenticated, healthRouter);

const boxRouter = require('./routes/box');
app.use('/box', isAuthenticated, boxRouter);

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
