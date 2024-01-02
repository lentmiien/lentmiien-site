// Require necessary database models
const { CookingCalendarModel, CookingRequestModel, Chat3KnowledgeModel } = require('../database');

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

  // TODO: change to only valid users (guest users can only view cookbook)
  // All user may view cooking calendar, so get content
  // Get 7 dates, starting from today and get the calendar values for the dates
  const dates_array = createDatesArray();
  const dates_only = dates_array.map(d => d.date);
  const calendar = await CookingCalendarModel.find({date: dates_only});
  const knowledge = await Chat3KnowledgeModel.find();

  const knowledge_lookup = [];
  knowledge.forEach(k => knowledge_lookup.push(k._id.toString()));

  const cooking_knowledge = knowledge.filter(d => d.data.indexOf('"name"') >= 0);// TODO: works for now, but change to something better
  cooking_knowledge.sort((a,b) => {
    if (a.title < b.title) return -1;
    if (a.title > b.title) return 1;
    return 0;
  });

  // Generate structure holding the cooking calendar for the 7 days,
  // fill in empty entries where there were no data from database
  const cookingCalendar = [];
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

  // Valid users may view their own requests, so get content
  let cooking_requests = [];
  if (valid_user) {
    cooking_requests = await CookingRequestModel.find({requesterName: user});
  }

  res.render('cooking_request_index', {valid_user, user, cookingCalendar, cooking_knowledge, cooking_requests});
};

// API endpoint for submitting a cooking request
exports.api_send_cooking_request = async (req, res) => {
  // TODO: fill in code for function
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
