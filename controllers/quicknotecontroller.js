const { LocationModel, QuicknoteModel } = require('../database');

exports.quick_note = async (req, res) => {
  const locations = await LocationModel.find();
  res.render('quick_note', {locations});
};

// Create a new quick note
exports.add = async (req, res) => {
  const user_id = req.user.name;
  const { content, latitude, longitude } = req.body;

  // Find the nearest location within 100 meters
  const nearestLocations = await LocationModel.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distance',
        maxDistance: 100, // 100 meters
        spherical: true,
        query: { user: user_id }
      }
    },
    { $limit: 1 }
  ]);

  let nearestLocation = null;
  if (nearestLocations.length > 0) {
    nearestLocation = {
      name: nearestLocations[0].name,
      distance: nearestLocations[0].distance
    };
  }

  const newNote = new QuicknoteModel({
    user: user_id,
    content,
    location: {
      coordinates: [longitude, latitude]
    },
    nearestLocation
  });
  await newNote.save();

  res.json({ success: true, note: newNote });
};

// Get all quick notes for a user
exports.get_all = async (req, res) => {
  const user_id = req.user.name;
  const notes = await QuicknoteModel.find({ user: user_id }).sort('-timestamp');
  res.json(notes);
};

// Delete a quick note
exports.delete = async (req, res) => {
  await QuicknoteModel.findByIdAndDelete(req.params.id);
  res.json({ success: true });
};

// Delete notes older than 30 days
exports.delete_old = async (req, res) => {
  const user_id = req.user.name;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await QuicknoteModel.deleteMany({ user: user_id, timestamp: { $lt: thirtyDaysAgo } });
  res.json({ success: true });
};

// Add a new important location
exports.add_location = async (req, res) => {
  const user_id = req.user.name;
  const { name, latitude, longitude } = req.body;
  const newLocation = new LocationModel({
    user: user_id,
    name,
    location: {
      coordinates: [longitude, latitude]
    }
  });
  await newLocation.save();
  res.json({ success: true, location: newLocation });
};

// Navigate to location
exports.navigate_to_location = async (req, res) => {
  const longitude = req.params.longitude;
  const latitude = req.params.latitude;
  res.render('navigate_to_location', {longitude, latitude});
};
