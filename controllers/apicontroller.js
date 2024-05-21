// API for the VUE app
const { /* Needed databases */ } = require('../database');

exports.root = async (req, res, next) => {
  // Do some initial checks and setups

  // FOR DEBUG PURPOSE: return a simple JSON response and stop
  return res.json({status: "API alive!", user: req.user.name});

  // next();
}