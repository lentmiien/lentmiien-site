// Require necessary database models
const { CookingCalendarModel, CookingRequestModel, Chat3KnowledgeModel } = require('../database');

exports.index = async (req, res) => {
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

  res.render('cooking_index', {cookingCalendar, cooking_knowledge});
};

// API endpoint to accept one update for a date, and respond to user when done
// The date can be a new or existing entry in database
exports.update_cooking_calendar = async (req, res) => {
  const entry_to_update = await CookingCalendarModel.find({date: req.body.date});
  if (entry_to_update.length === 0) {
    // new entry
    const data = {
      date: req.body.date,
      lunchToCook: "lunch" in req.body ? req.body.lunch : "",
      dinnerToCook: "dinner" in req.body ? req.body.dinner : "",
      dessertToCook: "dessert" in req.body ? req.body.dessert : "",
    }
    const entry = await new CookingCalendarModel(data).save();
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
