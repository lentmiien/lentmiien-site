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

exports.apiRate = async (req, res) => {
  const imageFile = req.params.file;
  // Extract comment and ratings from request body
  const { comment, ...ratings } = req.body;
  try {
    // Transform ratings into array of objects:
    const ratingsArray = Object.keys(ratings).map(category => ({
      category,
      score: Number(ratings[category])
    }));

    // Look up an existing image entry
    let image = await Images.findOne({ filename: imageFile });
    
    if (image) {
      // Update existing entry
      image.comment = comment;
      image.ratings = ratingsArray;
    } else {
      // Create a new entry
      image = new Images({
        filename: imageFile,
        comment,
        ratings: ratingsArray
      });
    }
    
    await image.save();
    // Return a JSON response indicating success
    return res.json({ success: true, message: 'Rating saved successfully', imageFile, ratings: ratingsArray });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
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
    const diskImages = await getImageFiles();
    // Find images with the specified category rating >= minRating
    const images = await Images.find({
      'ratings': {
        $elemMatch: {
          category: category,
          score: { $gte: Number(minRating) }
        }
      }
    }).select('filename');

    const filteredFilenames = images.map(img => img.filename).filter(d => diskImages.indexOf(d) >= 0).sort(() => 0.5 - Math.random());
    res.render('gallery/slideshow', { images: filteredFilenames, type: `Category: ${category} ≥ ${minRating}`, currentIndex: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
};

exports.random_unrated_slideshow = async (req, res) => {
  try {
    // Get list of all image files from disk
    const diskImages = await getImageFiles();

    // Get documents from the database (rated images)
    const ratedDocs = await Images.find({}).select('filename');
    const ratedFilenames = ratedDocs.map(doc => doc.filename);

    // Filter to only images that do NOT have a DB entry (unrated)
    const unratedImages = diskImages.filter(file => !ratedFilenames.includes(file));

    if (unratedImages.length === 0) {
      return res.send("There are no unrated images available for the slideshow.");
    }

    // Shuffle the filtered list
    const shuffled = unratedImages.sort(() => 0.5 - Math.random());

    // Render the slideshow view, and send along the type so the view can display the rating form.
    res.render('gallery/slideshow', { images: shuffled, type: 'Random Unrated', currentIndex: 0 });
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
