const fs = require("fs");

// Require necessary database models
// const { ArticleModel } = require('../database');

const galleryPath = process.env.GALLERY_PATH;

exports.index = async (req, res) => {
  const images = [];
  fs.readdirSync(galleryPath).forEach(file => {
    images.push(`${file}`);
  });

  res.render('gallery', { images });
};

exports.image = async (req, res) => {
  const filename = req.params.file;
  const filepath = galleryPath + "\\" + filename;
  res.sendFile(filepath);
};
