const mongoose = require('mongoose');

// mongoose.set('useFindAndModify', false);

// Set up default mongoose connection
const mongoDB_url = process.env.MONGOOSE_URL;
// mongoose.connect(mongoDB_url, { useNewUrlParser: true, useUnifiedTopology: true });

mongoose.connect(mongoDB_url).then(() => {
  console.log('Database connected');
});

// Get the default connection
const db = mongoose.connection;

// Bind connection to error event (to get notification of connection errors)
db.on('error', console.error.bind(console, 'MongoDB connection error:'));

// User
const UseraccountModel = require('./models/useraccount');
// Article
const ArticleModel = require('./models/article');
// ChatGPT
const ChatModel = require('./models/chat');

// Export models
module.exports = {
  UseraccountModel,
  ArticleModel,
  ChatModel,
};
