// Require necessary database models
// const { ArticleModel } = require('../database');

exports.index = (req, res) => {
  res.render('cooking_index', {type: "Public"});
};
