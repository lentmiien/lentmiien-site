const { ArticleModel } = require('../database');

exports.mypage = (req, res) => {
  // Do something fun here, to show om mypage!
  res.render('mypage');
};

exports.blogpost = async (req, res) => {
  const form_data = {
    id: "",
    title: "",
    category: "",
    content: "",
  };
  // if req.query.id then load from database and display page for editing entry
  if ("id" in req.query) {
    const entry = await ArticleModel.findById(req.query.id);
    if (entry) {
      form_data.id = req.query.id;
      form_data.title = entry.title;
      form_data.category = entry.category;
      form_data.content = entry.content.split('<br>').join('\n');
    }
  }
  // else display page for writuing a new entry
  res.render("blogpost", {form_data});
};

exports.post_blogpost = (req, res) => {
  // HTML form data, if id value is empty, then save new, otherwise update entry with the id
  if (req.body.id && req.body.id.length > 0) {
    // Update existing entry
    const Id = req.body.id;
    const update = {
      title: req.body.title,
      category: req.body.category,
      content: req.body.content.split('\n').join("<br>"),
      updated: new Date(),
    };

    ArticleModel.findByIdAndUpdate(Id, update, { new: true, useFindAndModify: false })
      .then((updatedArticle) => {
        res.redirect("/blog");
      })
      .catch((err) => console.error('Error updating user:', err));
  } else {
    // New entry
    const entry_to_save = new ArticleModel({
      title: req.body.title,
      category: req.body.category,
      content: req.body.content.split('\n').join("<br>"),
      created: new Date(),
      updated: new Date(),
    });
  
    // Save to database
    entry_to_save.save().then((saved_data) => {
      setTimeout(() => res.redirect(`/blog`), 100);
    });
  }
};

exports.delete_blogpost = (req, res) => {
  // Delete blogpost with _id that is req.query.id
  ArticleModel.findByIdAndRemove(req.query.id).then(() => {
    setTimeout(() => res.redirect("/blog"), 100);
  });
};