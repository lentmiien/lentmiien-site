const dashboard = JSON.parse(document.getElementById("dashboard").innerHTML);
const year = document.getElementById("year");
const month = document.getElementById("month");

function Update() {
  const y = parseInt(year.value);
  const m = parseInt(month.value);

  // Setup data structures
  const update_data = {
    total_income: {
      key: "total_income",
      type: "income",
      tracked: 0,
      budget: 0
    },
    total_expense: {
      key: "total_expense",
      type: "expense",
      tracked: 0,
      budget: 0
    },
    total_saving: {
      key: "total_saving",
      type: "saving",
      tracked: 0,
      budget: 0
    }
  };
  const keys = Object.keys(dashboard.categories);
  keys.forEach(key => {
    // Calculate 3 sets of year-month for previous 3 months
    let d = new Date(y, m-2, 1);
    const dates = [];
    dates.push({y:d.getFullYear(),m:d.getMonth()+1});
    d = new Date(d.getFullYear(), d.getMonth()-1, 1);
    dates.push({y:d.getFullYear(),m:d.getMonth()+1});
    d = new Date(d.getFullYear(), d.getMonth()-1, 1);
    dates.push({y:d.getFullYear(),m:d.getMonth()+1});
    let budget_amount = 0;
    dates.forEach(date_set => {
      const year_index = dashboard.budgets[key].year_lookup.indexOf(date_set.y);
      if (year_index >= 0) {
        const month_index = dashboard.budgets[key].data[year_index].month_lookup.indexOf(date_set.m);
        if (month_index >= 0) {
          budget_amount += dashboard.budgets[key].data[year_index].data[month_index].amount;
        }
      }
    });
    // Calculate amount average for the 3 months and assign to budget
    // If budget === 0, set to 1 (to prevent division by 0)
    const budget = budget_amount === 0 ? 1 : Math.round(budget_amount / 3);
    
    update_data[key] = {
      key,
      type: dashboard.categories[key].type,
      tracked: 0,
      budget
    };
    update_data[`total_${dashboard.categories[key].type}`].budget += budget;

    // Add data
    const year_index = dashboard.budgets[key].year_lookup.indexOf(y);
    if (year_index >= 0) {
      const month_index = dashboard.budgets[key].data[year_index].month_lookup.indexOf(m);
      if (month_index >= 0) {
        update_data[key].tracked = dashboard.budgets[key].data[year_index].data[month_index].amount;
        update_data[`total_${dashboard.categories[key].type}`].tracked += dashboard.budgets[key].data[year_index].data[month_index].amount;
      }
    }
  });

  // Update output
  const update_keys = Object.keys(update_data);
  update_keys.forEach(key => {
    document.getElementById(`${key}_tracked`).innerText = update_data[key].tracked;
    document.getElementById(`${key}_budget`).innerText = update_data[key].budget;
    document.getElementById(`${key}_done`).innerText = `${Math.round(100 * update_data[key].tracked / update_data[key].budget)}%`;
    document.getElementById(`${key}_remaining`).innerText = update_data[key].budget > update_data[key].tracked ? update_data[key].budget - update_data[key].tracked : '-';
    document.getElementById(`${key}_excess`).innerText = update_data[key].tracked > update_data[key].budget ? update_data[key].tracked - update_data[key].budget : '-';
  });

  // Graphs
  const date_array = [];
  let d = new Date(y, m-1, 1);
  d = new Date(d.getFullYear(),d.getMonth()-13,1);
  for (let i = 0; i < 12; i++) {
    d = new Date(d.getFullYear(),d.getMonth()+1,1);
    date_array.push({
      y: d.getFullYear(),
      m: d.getMonth()+1,
      income: 0,
      expense: 0,
      saving: 0
    });

    let year_index = dashboard.type_budgets.income.year_lookup.indexOf(date_array[i].y);
    if (year_index >= 0) {
      const month_index = dashboard.type_budgets.income.data[year_index].month_lookup.indexOf(date_array[i].m);
      if (month_index >= 0) {
        date_array[i].income = dashboard.type_budgets.income.data[year_index].data[month_index].amount;
      }
    }
    year_index = dashboard.type_budgets.expense.year_lookup.indexOf(date_array[i].y);
    if (year_index >= 0) {
      const month_index = dashboard.type_budgets.expense.data[year_index].month_lookup.indexOf(date_array[i].m);
      if (month_index >= 0) {
        date_array[i].expense = dashboard.type_budgets.expense.data[year_index].data[month_index].amount;
      }
    }
    year_index = dashboard.type_budgets.saving.year_lookup.indexOf(date_array[i].y);
    if (year_index >= 0) {
      const month_index = dashboard.type_budgets.saving.data[year_index].month_lookup.indexOf(date_array[i].m);
      if (month_index >= 0) {
        date_array[i].saving = dashboard.type_budgets.saving.data[year_index].data[month_index].amount;
      }
    }
  }

  // Income monthly 1 year graph
  PlotBarChart("income_graph", "income", date_array, "#69b369");
  // Expense monthly 1 year graph
  PlotBarChart("expense_graph", "expense", date_array, "#b36969");
  // Saving monthly 1 year graph
  PlotBarChart("saving_graph", "saving", date_array, "#6969b3");
  // Weekly balance change graph 52 weeks (Income - Expense, ignore Saving)
  PlotWeeklyAreaGraph("year_graph", dashboard.weekly_change_data);
}
Update();

function PlotBarChart(html_target_id, type, data, color) {
  document.getElementById(html_target_id).innerHTML = "";

  // set the dimensions and margins of the graph
  var margin = {top: 30, right: 30, bottom: 70, left: 60},
      width = 300 - margin.left - margin.right,
      height = 300 - margin.top - margin.bottom;

  // append the svg object to the body of the page
  var svg = d3.select(`#${html_target_id}`)
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")");

  // X axis
  var x = d3.scaleBand()
    .range([ 0, width ])
    .domain(data.map(function(d) { return `${d.y}-${d.m}`; }))
    .padding(0.2);
  svg.append("g")
    .attr("transform", "translate(0," + height + ")")
    .call(d3.axisBottom(x))
    .selectAll("text")
      .attr("transform", "translate(-10,0)rotate(-45)")
      .style("text-anchor", "end");

  // Add Y axis
  var y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d[type])])
    .range([ height, 0]);
  svg.append("g")
    .call(d3.axisLeft(y));

  // Bars
  svg.selectAll("mybar")
    .data(data)
    .enter()
    .append("rect")
      .attr("x", function(d) { return x(`${d.y}-${d.m}`); })
      .attr("y", function(d) { return y(d[type]); })
      .attr("width", x.bandwidth())
      .attr("height", function(d) { return height - y(d[type]); })
      .attr("fill", color)
}

function PlotWeeklyAreaGraph(html_target_id, data) {
  document.getElementById(html_target_id).innerHTML = "";
  
  let max = 0;
  let min = 0;
  const top_arr = [];
  const bottom_arr = [];
  const top_avg_arr = [];
  const bottom_avg_arr = [];
  const average = [];
  for (let i = 0; i < data.length; i++) {
    const date = new Date((data[i].start+data[i].end+1)/2);
    if (data[i].income > max) max = data[i].income;
    if (data[i].expense < min) min = data[i].expense;
    top_arr.push({
      x: date,
      y0: 0,
      y1: data[i].income
    });
    bottom_arr.push({
      x: date,
      y0: data[i].expense,
      y1: 0
    });
  }
  for (let i = 2; i < top_arr.length-2; i++) {
    top_avg_arr.push({
      x: top_arr[i].x,
      y: (top_arr[i-2].y1 + top_arr[i-1].y1 + top_arr[i].y1 + top_arr[i+1].y1 + top_arr[i+2].y1) / 5
    });
    bottom_avg_arr.push({
      x: bottom_arr[i].x,
      y: (bottom_arr[i-2].y0 + bottom_arr[i-1].y0 + bottom_arr[i].y0 + bottom_arr[i+1].y0 + bottom_arr[i+2].y0) / 5
    });
    average.push({
      x: top_arr[i].x,
      y: (top_arr[i-2].y1 + top_arr[i-1].y1 + top_arr[i].y1 + top_arr[i+1].y1 + top_arr[i+2].y1 + bottom_arr[i-2].y0 + bottom_arr[i-1].y0 + bottom_arr[i].y0 + bottom_arr[i+1].y0 + bottom_arr[i+2].y0) / 5
    });
  }

  // set the dimensions and margins of the graph
  var margin = {top: 30, right: 30, bottom: 70, left: 60},
      width = 300 - margin.left - margin.right,
      height = 300 - margin.top - margin.bottom;

  // append the svg object to the body of the page
  var svg = d3.select(`#${html_target_id}`)
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform",
            "translate(" + margin.left + "," + margin.top + ")");
  
  // Add X axis --> it is a date format
  var x = d3.scaleTime()
    .domain(d3.extent(top_arr, function(d) { return d.x; }))
    .range([ 0, width ]);
  svg.append("g")
    .attr("transform", "translate(0," + height + ")")
    .call(d3.axisBottom(x));
  
  // Add Y axis
  var y = d3.scaleLinear()
    .domain([min, max])
    .range([ height, 0 ]);
  svg.append("g")
    .call(d3.axisLeft(y));
  
  // Add the top area
  svg.append("path")
    .datum(top_arr)
    .attr("fill", "#99b399")
    .attr("stroke", "#33b333")
    .attr("stroke-width", 1)
    .attr("d", d3.area()
      .x(function(d) { return x(d.x) })
      .y0(function(d) { return y(d.y0) })
      .y1(function(d) { return y(d.y1) })
      )
  // Add the bottom area
  svg.append("path")
    .datum(bottom_arr)
    .attr("fill", "#b39999")
    .attr("stroke", "#b33333")
    .attr("stroke-width", 1)
    .attr("d", d3.area()
      .x(function(d) { return x(d.x) })
      .y0(function(d) { return y(d.y0) })
      .y1(function(d) { return y(d.y1) })
      )

  // Add the top average
  svg.append("path")
    .datum(top_avg_arr)
    .attr("fill", "none")
    .attr("stroke", "#006600")
    .attr("stroke-width", 2)
    .attr("d", d3.line()
      .x(function(d) { return x(d.x) })
      .y(function(d) { return y(d.y) })
      )
  // Add the bottom average
  svg.append("path")
    .datum(bottom_avg_arr)
    .attr("fill", "none")
    .attr("stroke", "#660000")
    .attr("stroke-width", 2)
    .attr("d", d3.line()
      .x(function(d) { return x(d.x) })
      .y(function(d) { return y(d.y) })
      )
  // Add the average
  svg.append("path")
    .datum(average)
    .attr("fill", "none")
    .attr("stroke", "black")
    .attr("stroke-width", 3)
    .attr("d", d3.line()
      .x(function(d) { return x(d.x) })
      .y(function(d) { return y(d.y) })
      )
}
