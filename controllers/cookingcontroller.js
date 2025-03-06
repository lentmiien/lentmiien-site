// Require necessary database models
const { CookingCalendarModel, CookingRequestModel, Chat4KnowledgeModel } = require('../database');

exports.index = async (req, res) => {
  // Get 7 dates, starting from today and get the calendar values for the dates
  const dates_array = createDatesArray();
  const dates_only = dates_array.map(d => d.date);
  const calendar = await CookingCalendarModel.find({date: dates_only});
  const knowledge = await Chat4KnowledgeModel.find({category: "Recipe"});
  const requests = await CookingRequestModel.find({requestDate: dates_only});

  knowledge.sort((a,b) => {
    if (a.title < b.title) return -1;
    if (a.title > b.title) return 1;
    return 0;
  });

  const knowledge_lookup = [];
  knowledge.forEach(k => knowledge_lookup.push(k._id.toString()));

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
        cookingCalendar[index].lunch.name = knowledge[know_index].title;
        cookingCalendar[index].lunch.knoledge_id = c.lunchToCook;
        cookingCalendar[index].lunch.image = knowledge[know_index].images.length > 0 ? knowledge[know_index].images[0] : null;
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
        cookingCalendar[index].dinner.name = knowledge[know_index].title;
        cookingCalendar[index].dinner.knoledge_id = c.dinnerToCook;
        cookingCalendar[index].dinner.image = knowledge[know_index].images.length > 0 ? knowledge[know_index].images[0] : null;
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
        cookingCalendar[index].dessert.name = knowledge[know_index].title;
        cookingCalendar[index].dessert.knoledge_id = c.dessertToCook;
        cookingCalendar[index].dessert.image = knowledge[know_index].images.length > 0 ? knowledge[know_index].images[0] : null;
      } else {
        if (c.dessertToCook.length > 0) {
          // Assume to be URL
          cookingCalendar[index].dessert.name = c.dessertToCook;
          cookingCalendar[index].dessert.is_url = true;
        }
      }
    }
  });

  // Add requests to calendar
  requests.forEach(d => {
    const index = dates_only.indexOf(d.requestDate);

    if (d.lunchToCook.length > 0) {
      if ("request" in cookingCalendar[index].lunch) {
        cookingCalendar[index].lunch.request.push(`${d.requesterName} wants ${d.lunchToCook}`)
      } else {
        cookingCalendar[index].lunch.request = [`${d.requesterName} wants ${d.lunchToCook}`];
      }
    }
    if (d.dinnerToCook.length > 0) {
      if ("request" in cookingCalendar[index].dinner) {
        cookingCalendar[index].dinner.request.push(`${d.requesterName} wants ${d.dinnerToCook}`)
      } else {
        cookingCalendar[index].dinner.request = [`${d.requesterName} wants ${d.dinnerToCook}`];
      }
    }
    if (d.dessertToCook.length > 0) {
      if ("request" in cookingCalendar[index].dessert) {
        cookingCalendar[index].dessert.request.push(`${d.requesterName} wants ${d.dessertToCook}`)
      } else {
        cookingCalendar[index].dessert.request = [`${d.requesterName} wants ${d.dessertToCook}`];
      }
    }
  });

  res.render('cooking_index', {cookingCalendar, knowledge});
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

exports.cooking_statistics = async (req, res) => {
  const stats = await getCookingStatistics();
  const knowledge = await Chat4KnowledgeModel.find({category: "Recipe"});
  const knowledge_lookup = {};
  knowledge.forEach(k => knowledge_lookup[k._id.toString()] = k.title);
  res.render("cooking_statistics", {stats, knowledge_lookup});
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

/**
 * Fetches cooking statistics from the database.
 *
 * @returns {Promise<Array>} An array of objects containing cooking statistics.
 */
async function getCookingStatistics() {
  try {
    const today = new Date();

    // Helper function to subtract days from a date
    const subtractDays = (date, days) => {
      const result = new Date(date);
      result.setDate(result.getDate() - days);
      return result;
    };

    // Define date boundaries
    const last10Start = subtractDays(today, 10);
    const last90Start = subtractDays(today, 90);
    const last180Start = subtractDays(today, 180);

    // Aggregation pipeline
    const pipeline = [
      {
        // Combine cooking fields into an array and filter out nulls
        $project: {
          date: 1,
          cookingItems: {
            $filter: {
              input: ["$dinnerToCook", "$lunchToCook", "$dessertToCook"],
              as: "item",
              cond: { $ne: ["$$item", null] }
            }
          }
        }
      },
      { $unwind: "$cookingItems" }, // Flatten the array
      {
        // Convert the date string to a Date object
        $addFields: {
          dateObj: {
            $dateFromString: {
              dateString: "$date",
              format: "%Y-%m-%d",
              onError: null
            }
          }
        }
      },
      {
        // Group by the unique cooking item and compute counts
        $group: {
          _id: "$cookingItems",
          totalCount: { $sum: 1 },
          countLast90Days: {
            $sum: {
              $cond: [{ $gte: ["$dateObj", last90Start] }, 1, 0]
            }
          },
          countPrev90Days: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ["$dateObj", last180Start] },
                    { $lt: ["$dateObj", last90Start] }
                  ]
                },
                1,
                0
              ]
            }
          },
          existInLast10Days: {
            $max: {
              $cond: [{ $gte: ["$dateObj", last10Start] }, true, false]
            }
          }
        }
      },
      {
        // Restructure the output
        $project: {
          uniqueString: "$_id",
          _id: 0,
          existInLast10Days: 1,
          countLast90Days: 1,
          countPrev90Days: 1,
          totalCount: 1
        }
      },
      {
        // Sort by countLast90Days in descending order
        $sort: { countLast90Days: -1 }
      }
    ];

    // Execute the aggregation
    const results = await CookingCalendarModel.aggregate(pipeline).exec();

    return results;
  } catch (error) {
    console.error("Error fetching cooking statistics:", error);
    throw error;
  }
}
