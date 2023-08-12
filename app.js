require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const expressSession = require('express-session');
const bcrypt = require('bcryptjs');

// Clear temporary folder
function clearDirectory(directory) {
  if (fs.existsSync(directory)) {
      fs.readdirSync(directory).forEach((file) => {
          const currentPath = path.join(directory, file);
          if (fs.lstatSync(currentPath).isDirectory()) {
              // Recurse if directory
              clearDirectory(currentPath);
              fs.rmdirSync(currentPath);
          } else {
              // Remove file
              fs.unlinkSync(currentPath);
          }
      });
  }
}
const TEMP_DIR = path.join(__dirname, 'tmp_data');
clearDirectory(TEMP_DIR);

// Require necessary database models
const { UseraccountModel } = require('./database');

const app = express();

// Middleware
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

// Private - routes
const mypageRouter = require('./routes/mypage');
app.use('/mypage', isAuthenticated, mypageRouter);

const chatRouter = require('./routes/chat');
app.use('/chat', isAuthenticated, chatRouter);

const chat2Router = require('./routes/chat2');
app.use('/chat2', isAuthenticated, chat2Router);

const openaiRouter = require('./routes/openai');
app.use('/openai', isAuthenticated, openaiRouter);

const gptdocumentRouter = require('./routes/gptdocument');
app.use('/gptdocument', isAuthenticated, gptdocumentRouter);

const budgetRouter = require('./routes/budget');
app.use('/accounting', isAuthenticated, budgetRouter);

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
