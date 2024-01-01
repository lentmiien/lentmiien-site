// Require necessary database models
const { CookingCalendarModel, CookingRequestModel, Chat3KnowledgeModel } = require('../database');

// This is temporary solution, so OK for now (plan to prepare database)
const user_list = {
  "nzz8gXilQBZ8nxS78b0UjhpPtnXqUMFW": "Maiko",
  "JSqngWDQyGoIVohdrG96dxU6XYSDv98G": "Mizuki",
};

exports.index = (req, res) => {
  // User validation
  let valid_user = false;
  let user = "Guest";
  if ("uid" in req.query && req.query.uid in user_list) {
    valid_user = true;
    user = user_list[req.query.uid];
  }

  // All user may view cooking calendar, so get content

  // Valid users may view their own requests, so get content

  res.render('cooking_request_index', {valid_user, user});
};
