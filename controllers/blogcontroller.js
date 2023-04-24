// Require necessary database models
const { ArticleModel } = require('../database');

exports.index = (req, res) => {
  // Display list of all entries
  //  Show full text of entries within last week, or last 3 entries if less than 3 entries in last week;
  //  Show titles for other entries (click to view)
  ArticleModel.find().then((articles) => {
    articles.sort((a, b) => {
      if (a.updated > b.updated) return -1;
      if (a.updated < b.updated) return 1;
      return 0;
    });

    res.render('blog', { articles });
  });
};

exports.list = (req, res) => {
  // Display list of entires in :category
  //  Show similar as index, but only for entries in category
  ArticleModel.find({ category: req.params.category }).then((articles) => {
    articles.sort((a, b) => {
      if (a.updated > b.updated) return -1;
      if (a.updated < b.updated) return 1;
      return 0;
    });

    res.render('blog', { articles });
  });
};

exports.view = (req, res) => {
  // Display entry :id
  //  Only show the particular entry (suitable link to share on social media)
  ArticleModel.find({ _id: req.params.id }).then((articles) => {
    articles.sort((a, b) => {
      if (a.updated > b.updated) return -1;
      if (a.updated < b.updated) return 1;
      return 0;
    });

    res.render('blog', { articles });
  });
};
