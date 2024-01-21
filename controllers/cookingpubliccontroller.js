// Require necessary database models
const { CookingCalendarModel, CookingRequestModel, Chat3KnowledgeModel, Chat3KnowledgeTModel } = require('../database');

// This is temporary solution, so OK for now (plan to prepare database)
const user_list = {
  "nzz8gXilQBZ8nxS78b0UjhpPtnXqUMFW": "Maiko",
  "JSqngWDQyGoIVohdrG96dxU6XYSDv98G": "Mizuki",
};

exports.index = async (req, res) => {
  // User validation
  let valid_user = false;
  let user = "Guest";
  if ("uid" in req.query && req.query.uid in user_list) {
    valid_user = true;
    user = user_list[req.query.uid];
  }

  // Cookbook data
  const knowledge = await Chat3KnowledgeModel.find();
  const knowledge_lookup = [];
  knowledge.forEach(k => knowledge_lookup.push(k._id.toString()));
  const cooking_knowledge = knowledge.filter(d => d.data.indexOf('"name"') >= 0);// TODO: works for now, but change to something better
  cooking_knowledge.sort((a,b) => {
    if (a.title < b.title) return -1;
    if (a.title > b.title) return 1;
    return 0;
  });

  // Valid users may view cooking calendar, so get content
  const cookingCalendar = [];
  if (valid_user) {
    // Get 7 dates, starting from today and get the calendar values for the dates
    const dates_array = createDatesArray();
    const dates_only = dates_array.map(d => d.date);
    const calendar = await CookingCalendarModel.find({date: dates_only});

    // Generate structure holding the cooking calendar for the 7 days,
    // fill in empty entries where there were no data from database
    dates_array.forEach(date => {
      cookingCalendar.push({
        date: date.date,
        day: date.day,
        lunch: {
          name: "not set",
          is_url: false,
          knoledge_id: "",
          image: "",
        },
        dinner: {
          name: "not set",
          is_url: false,
          knoledge_id: "",
          image: "",
        },
        dessert: {
          name: "not set",
          is_url: false,
          knoledge_id: "",
          image: "",
        },
      });
    });
    calendar.forEach(c => {
      const index = dates_only.indexOf(c.date);
      if (index >= 0) {
        let know_index = knowledge_lookup.indexOf(c.lunchToCook);
        if (know_index >= 0) {
          // Get details from knowledge entry
          const data = JSON.parse(knowledge[know_index].data);
          cookingCalendar[index].lunch.name = data.name;
          cookingCalendar[index].lunch.knoledge_id = c.lunchToCook;
          cookingCalendar[index].lunch.image = data.image;
        } else {
          if (c.lunchToCook.length > 0) {
            // Assume to be URL
            cookingCalendar[index].lunch.name = c.lunchToCook;
            cookingCalendar[index].lunch.is_url = true;
          }
        }
        know_index = knowledge_lookup.indexOf(c.dinnerToCook);
        if (know_index >= 0) {
          // Get details from knowledge entry
          const data = JSON.parse(knowledge[know_index].data);
          cookingCalendar[index].dinner.name = data.name;
          cookingCalendar[index].dinner.knoledge_id = c.dinnerToCook;
          cookingCalendar[index].dinner.image = data.image;
        } else {
          if (c.dinnerToCook.length > 0) {
            // Assume to be URL
            cookingCalendar[index].dinner.name = c.dinnerToCook;
            cookingCalendar[index].dinner.is_url = true;
          }
        }
        know_index = knowledge_lookup.indexOf(c.dessertToCook);
        if (know_index >= 0) {
          // Get details from knowledge entry
          const data = JSON.parse(knowledge[know_index].data);
          cookingCalendar[index].dessert.name = data.name;
          cookingCalendar[index].dessert.knoledge_id = c.dessertToCook;
          cookingCalendar[index].dessert.image = data.image;
        } else {
          if (c.dessertToCook.length > 0) {
            // Assume to be URL
            cookingCalendar[index].dessert.name = c.dessertToCook;
            cookingCalendar[index].dessert.is_url = true;
          }
        }
      }
    });
  }

  // Valid users may view their own requests, so get content
  let cooking_requests = [];
  if (valid_user) {
    cooking_requests = await CookingRequestModel.find({requesterName: user});
  }
  // Generate lookup
  const cooking_request_lookup = {};
  cooking_requests.forEach(d => {
    if (d.lunchToCook.length > 0) {
      cooking_request_lookup[`${d.requestDate}lunch`] = d.lunchToCook;
    }
    if (d.dinnerToCook.length > 0) {
      cooking_request_lookup[`${d.requestDate}dinner`] = d.dinnerToCook;
    }
    if (d.dessertToCook.length > 0) {
      cooking_request_lookup[`${d.requestDate}dessert`] = d.dessertToCook;
    }
  });

  // Prepare cookbook
  const knowledge_templates = await Chat3KnowledgeTModel.find();
  let title = "Cooking recipe";
  const ids = [];
  const templates = knowledge_templates.filter(t => t.title === title);
  templates.forEach(t => ids.push(t._id.toString()));
  const knows = knowledge.filter(k => ids.indexOf(k.templateId) >= 0);

  // Id to name lookup
  const id_to_name_lookup = {};
  knows.forEach(d => id_to_name_lookup[d._id.toString()] = d.title);

  res.render('cooking_request_index', {valid_user, user_id: req.query.uid || null, cookingCalendar, cooking_knowledge, cooking_requests, cooking_request_lookup, ids, templates, knows, id_to_name_lookup});
};

// API endpoint for submitting a cooking request
exports.api_send_cooking_request = async (req, res) => {
  // User validation
  let valid_user = false;
  let user = "Guest";
  if ("uid" in req.query && req.query.uid in user_list) {
    valid_user = true;
    user = user_list[req.query.uid];
  }

  /*
  requestDate: {
    type: String, 
    required: true,
    match: [/^\d{4}-\d{2}-\d{2}$/, 'Please fill a valid date format (YYYY-MM-DD)'],
  },
  requesterName: { 
    type: String,
    required: true,
  },
  dinnerToCook: { 
    type: String,
    default: null,
  },
  lunchToCook: { 
    type: String,
    default: null,
  },
  dessertToCook: { 
    type: String,
    default: null,
  }
  */

  const entry_to_update = await CookingRequestModel.find({requestDate: req.body.date, requesterName: user});
  if (entry_to_update.length === 0) {
    // new entry
    const data = {
      requestDate: req.body.date,
      requesterName: user,
      lunchToCook: "lunch" in req.body ? req.body.lunch : "",
      dinnerToCook: "dinner" in req.body ? req.body.dinner : "",
      dessertToCook: "dessert" in req.body ? req.body.dessert : "",
    }
    const entry = await new CookingRequestModel(data).save();
    return res.json({status: "OK", msg: `${entry._id.toString()} (${req.body.date}): entry saved!`});
  } else {
    // update and save entry
    if ("lunch" in req.body) {
      entry_to_update[0].lunchToCook = req.body.lunch;
    }
    if ("dinner" in req.body) {
      entry_to_update[0].dinnerToCook = req.body.dinner;
    }
    if ("dessert" in req.body) {
      entry_to_update[0].dessertToCook = req.body.dessert;
    }
    await entry_to_update[0].save();
    return res.json({status: "OK", msg: `${entry_to_update[0]._id.toString()} (${req.body.date}): entry updated!`});
  }
};

/**
 * helper functions
 */

// This function formats a JavaScript Date object into a string of the form YYYY-MM-DD
function formatDate(date) {
  const year = date.getFullYear();
  // Month is 0-indexed, so we need to add 1
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Function to create an array of dates
function createDatesArray() {
  const datesArray = [];
  const today = new Date();
  
  for (let i = 0; i < 7; i++) {
    // Create a new date for each day
    const currentDate = new Date(today);
    // Set the date to today + i days
    currentDate.setDate(today.getDate() + i);
    // Format the date and add to the array
    datesArray.push({date: formatDate(currentDate), day: currentDate.getDay()});
  }
  
  return datesArray;
}
