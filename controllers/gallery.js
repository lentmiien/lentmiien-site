const fs = require("fs");

// Require necessary database models
const { Images } = require('../database');

const galleryPath = process.env.GALLERY_PATH;

exports.index = async (req, res) => {
  try {
    const images = [];
    fs.readdirSync(galleryPath).forEach(file => {
      images.push(`${file}`);
    });
    res.render('gallery/gallery', { images });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
};

exports.view = async (req, res) => {
  try {
    const imageFile = req.params.file;
    const image = await Images.findOne({ imageFile });
    res.render('gallery/view', { imageFile, image });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
};

exports.rate = async (req, res) => {
  const imageFile = req.params.file;
  const { comment, ...ratings } = req.body; // Assuming ratings come as category: score
  try {
    // Transform ratings into array of objects
    const ratingsArray = Object.keys(ratings).map(category => ({
      category,
      score: Number(ratings[category])
    }));

    // Find existing image entry
    let image = await Images.findOne({ filename: imageFile });
    
    if (image) {
      // Update existing entry
      image.comment = comment;
      image.ratings = ratingsArray;
    } else {
      // Create new entry
      image = new Images({
        filename: imageFile,
        comment,
        ratings: ratingsArray
      });
    }
    
    await image.save();
    res.redirect(`/gallery/view/${imageFile}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

exports.image = async (req, res) => {
  try {
    const filename = req.params.file;
    const filepath = galleryPath + "\\" + filename;
    res.sendFile(filepath);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
};
