const fs = require("fs");

// Require necessary database models
const { Images } = require('../database');

const galleryPath = process.env.GALLERY_PATH;

exports.index = async (req, res) => {
  try {
    const images = await getImageFiles();
    res.render('gallery/gallery', { images });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
};

exports.view = async (req, res) => {
  try {
    const images = await getImageFiles();
    const imageFile = req.query.img;

    const currentIndex = getImageIndex(images, imageFile);
    if (currentIndex === -1) {
      return res.status(404).send('Image not found');
    }
    const previousImage = images[currentIndex - 1] || null;
    const nextImage = images[currentIndex + 1] || null;

    const image = await Images.findOne({ filename: imageFile });
    res.render('gallery/view', { imageFile, image, previousImage, nextImage });
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
    res.redirect(`/gallery/view?img=${imageFile}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

exports.random_slideshow = async (req, res) => {
  try {
    const images = await getImageFiles();
    // Shuffle images
    const shuffled = images.sort(() => 0.5 - Math.random());
    res.render('gallery/slideshow', { images: shuffled, type: 'Random', currentIndex: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

exports.category_slideshow = async (req, res) => {
  const { category, minRating } = req.query;

  try {
    // Find images with the specified category rating >= minRating
    const images = await Images.find({
      'ratings': {
        $elemMatch: {
          category: category,
          score: { $gte: Number(minRating) }
        }
      }
    }).select('filename');

    const filteredFilenames = images.map(img => img.filename);
    res.render('gallery/slideshow', { images: filteredFilenames, type: `Category: ${category} ≥ ${minRating}`, currentIndex: 0 });
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

// Utility function to get list of image files
const getImageFiles = async () => {
  const images = [];
  fs.readdirSync(galleryPath).forEach(file => {
    images.push(`${file}`);
  });
  return images;
};

// Helper to get image index
const getImageIndex = (images, filename) => images.indexOf(filename);
