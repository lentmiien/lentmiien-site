const { ArticleModel } = require('../database');
const { tts, ig } = require('../utils/ChatGPT');

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

exports.speektome = async (req, res) => {
  const tts_file = await tts("tts-1", "Once upon a time, in a land filled with lush green forests and deep blue lakes, there lived a young dinosaur named Dino. Dino was not very big, but he had a huge heart and an even bigger curiosity about the world around him.\n\nOne sunny morning, Dino decided to go on an adventure. He wanted to explore the forest and see what secrets it held. So, with a big smile on his face, he set off into the woods.\n\nAs Dino walked, he saw many amazing things. He saw birds with bright feathers flying high in the sky. He heard the rustling of leaves as tiny creatures scurried through the underbrush. And he even saw a family of bunnies hopping along a nearby path.\n\nBut the most exciting moment came when Dino reached a clearing and found a group of other young dinosaurs playing together. They were all different types and colors, and they were having so much fun. Dino was a little shy at first, but the other dinosaurs invited him to join their games.\n\nThey played dinosaur tag, where they chased each other around with roars of laughter. They had a jumping contest to see who could leap the highest. And they even played hide-and-seek among the giant trees.\n\nAs the sun began to set, Dino realized it was time to head back home. He said goodbye to his new friends and promised to come back soon for more adventures.\n\nDino returned home with a heart full of joy. He couldn't wait to tell his family about all the wonderful things he had seen and done. And as he fell asleep that night, he dreamt of all the adventures that were still waiting for him in the big, beautiful world.\n\nAnd so, Dino's big adventure had just begun.", "nova");
  res.render("speektome", { tts_file });
};

exports.showtome = async (req, res) => {
  const ig_file = await ig("A rainbow colored diamond, in the depths of a deep cave", "standard", "1024x1024");
  res.render("showtome", { ig_file, prompt: "A hotdog car" });
};
