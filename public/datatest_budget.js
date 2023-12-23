const database = JSON.parse(document.getElementById("database").innerHTML);

// Check if #output exists, if not, append to body
if (!document.getElementById('output')) {
  const output = document.createElement('div');
  output.id = 'output';
  document.body.appendChild(output);
}

ProcessData(
  database.old_transactions,
  database.new_transactions,
  database.old_accounts,
  database.new_accounts,
  database.old_categories,
  database.new_categories,
  database.old_tags
  );

function ProcessData(
  old_transactions,
  new_transactions,
  old_accounts,
  new_accounts,
  old_categories,
  new_categories,
  old_tags
  ) {
    plotBarCharts(SumAllNewAndOldTransactionByAccount(new_transactions, old_transactions, new_accounts, old_accounts));
}

function SumAllNewTransactionByAccount(transactions) {
  // Map to store monthly totals for each account
  const yearlyTotalsMap = {};

  transactions.forEach(transaction => {
    const yearKey = Math.floor(transaction.date / 10000); // Extract the month and year (e.g., 202212)

    // Update monthly total for from_account
    if (!yearlyTotalsMap[transaction.from_account]) {
      yearlyTotalsMap[transaction.from_account] = {};
    }
    if (!yearlyTotalsMap[transaction.from_account][yearKey]) {
      yearlyTotalsMap[transaction.from_account][yearKey] = 0;
    }
    yearlyTotalsMap[transaction.from_account][yearKey] -= (transaction.amount + transaction.from_fee);

    // Update monthly total for to_account
    if (!yearlyTotalsMap[transaction.to_account]) {
      yearlyTotalsMap[transaction.to_account] = {};
    }
    if (!yearlyTotalsMap[transaction.to_account][yearKey]) {
      yearlyTotalsMap[transaction.to_account][yearKey] = 0;
    }
    yearlyTotalsMap[transaction.to_account][yearKey] += (transaction.amount - transaction.to_fee);
  });

  // Convert map to array format for output
  const result = [];
  for (const accountId in yearlyTotalsMap) {
    for (const year in yearlyTotalsMap[accountId]) {
      result.push({
        account: accountId,
        year: parseInt(year),
        total: yearlyTotalsMap[accountId][year]
      });
    }
  }

  return result;
}

function SumAllNewAndOldTransactionByAccount(new_transactions, old_transactions, new_accounts, old_accounts) {
  // Map to store monthly totals for each account
  const yearlyTotalsMap = {};

  const account_map = {};
  new_accounts.forEach(d => account_map[d._id] = d.name);
  old_accounts.forEach(d => account_map[d._id] = d.account_name);

  new_transactions.forEach(transaction => {
    const yearKey = Math.floor(transaction.date / 10000);

    if (transaction.from_account != "EXT") {
      const accountKey = account_map[transaction.from_account];
      
      if (!yearlyTotalsMap[accountKey]) {
        yearlyTotalsMap[accountKey] = {};
      }
      if (!yearlyTotalsMap[accountKey][yearKey]) {
        yearlyTotalsMap[accountKey][yearKey] = 0;
      }
      yearlyTotalsMap[accountKey][yearKey] -= (transaction.amount + transaction.from_fee);
    }

    if (transaction.to_account != "EXT") {
      const accountKey = account_map[transaction.to_account];
      
      if (!yearlyTotalsMap[accountKey]) {
        yearlyTotalsMap[accountKey] = {};
      }
      if (!yearlyTotalsMap[accountKey][yearKey]) {
        yearlyTotalsMap[accountKey][yearKey] = 0;
      }
      yearlyTotalsMap[accountKey][yearKey] += (transaction.amount - transaction.to_fee);
    }
  });

  old_transactions.forEach(transaction => {
    const yearKey = parseInt(transaction.transaction_date.split('-')[0]);
    const accountKey = account_map[transaction.account_id];

    if (!yearlyTotalsMap[accountKey]) {
      yearlyTotalsMap[accountKey] = {};
    }
    if (!yearlyTotalsMap[accountKey][yearKey]) {
      yearlyTotalsMap[accountKey][yearKey] = 0;
    }
    yearlyTotalsMap[accountKey][yearKey] += transaction.amount;
  });

  // Convert map to array format for output
  const result = [];
  for (const accountId in yearlyTotalsMap) {
    for (const year in yearlyTotalsMap[accountId]) {
      result.push({
        account: accountId,
        year: parseInt(year),
        total: yearlyTotalsMap[accountId][year]
      });
    }
  }

  return result;
}

function plotBarCharts(data) {
  // Compute sum of accounts for each month
  const summedData = [];
  data.forEach(entry => {
    if (entry.account !== "EXT") {
      const existingEntry = summedData.find(e => ("month" in e && e.month === entry.month) || ("year" in e && e.year === entry.year));
      if (existingEntry) {
        existingEntry.total += entry.total;
      } else {
        if ("month" in entry) summedData.push({ month: entry.month, total: entry.total });
        else summedData.push({ year: entry.year, total: entry.total });
      }
    }
  });

  // Plot combined bar chart
  plotAccountBarChart(summedData, "Combined Total");
}

// Function to plot individual account bar chart
function plotAccountBarChart(accountData, accountName) {
  const margin = { top: 40, right: 20, bottom: 30, left: 60 };
  const width = 500 - margin.left - margin.right;
  const height = 300 - margin.top - margin.bottom;

  const svg = d3.select("#output").append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  // Add title
  svg.append("text")
      .attr("x", width / 2)
      .attr("y", -margin.top / 2)
      .attr("text-anchor", "middle")
      .style("font-weight", "bold")
      .text(accountName);

  // X scale
  const x = d3.scaleBand()
      .range([0, width])
      .domain(accountData.map(d => "month" in d ? d.month : d.year))
      .padding(0.1);

  svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x));

  // Y scale
  const domain = [d3.min(accountData, d => d.total), d3.max(accountData, d => d.total)];
  if (domain[0] < 0 && domain[1] < 0) domain[1] = 0;
  if (domain[0] > 0 && domain[1] > 0) domain[0] = 0;
  const y = d3.scaleLinear()
      .domain(domain)
      .range([height, 0]);

  svg.append("g")
      .call(d3.axisLeft(y));

  // Bars
  svg.selectAll(".bar")
      .data(accountData)
      .enter().append("rect")
      .attr("class", "bar")
      .attr("x", d => x("month" in d ? d.month : d.year))
      .attr("y", d => y(Math.max(0, d.total)))
      .attr("width", x.bandwidth())
      .attr("height", d => Math.abs(y(d.total) - y(0)))
      .attr("fill", d => d.total > 0 ? "lightgreen" : "lightcoral");
}
