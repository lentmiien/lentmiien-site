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

function ExecuteCode() {
  const userCode = document.getElementById('playground_in').value;
  try {
    new Function(userCode)();
  } catch (e) {
    console.error('Error executing user code:', e);
  }
}

let session_id = null;
const context = `You are assisting with data analysis for a personal butget. The user will provide a questions for what they want to know, and you are to provide the necessary JavaScript code for performing the necessary analysis, and output the analysis result to the HTML element with id attribute 'playground_out'. You may make use D3 from the 'd3.js' library, as it's available to the code. The data available to you are as listed below, with 1 example data from each database array.

#### 'database.old_transactions'

\`\`\`
{
  "_id": "63aaf2d8229f9a2a68954e1f",
  "transaction_date": "2022-12-27T00:00:00.000Z",
  "account_id": "5dbad16fa6a8a9001728a37c",
  "amount": -1489,
  "category_id": "5dba210e4d8ddc0017981372",
  "tag_id": "5dba22014d8ddc001798137b",
  "__v": 0
}
\`\`\`

#### 'database.old_accounts'

\`\`\`
{
  "_id": "5dbad16fa6a8a9001728a37c",
  "account_name": "Wallet",
  "__v": 0
}
\`\`\`

#### 'database.old_categories'

\`\`\`
{
  "_id": "5dba210e4d8ddc0017981372",
  "category_name": "Living expenses",
  "__v": 0
}
\`\`\`

#### 'database.old_tags'

\`\`\`
{
  "_id": "5dba21d04d8ddc0017981379",
  "tag_name": "Salary",
  "__v": 0
}
\`\`\`

#### 'database.new_transactions'

\`\`\`
{
  "_id": "65ba1751d9e25d1d88f127a1",
  "from_account": "63aafe30fb2f5072d6609331",
  "to_account": "EXT",
  "from_fee": 0,
  "to_fee": 0,
  "amount": 5143,
  "date": 20240131,
  "transaction_business": "Inageya",
  "type": "expense",
  "categories": "63a0825d4796a649f99264c8@100",
  "tags": "food",
  "__v": 0
}
\`\`\`

#### 'database.new_accounts'

\`\`\`
{
  "_id": "63aafe30fb2f5072d6609331",
  "name": "Wallet",
  "balance": 15776,
  "balance_date": 20221227,
  "currency": "JPY",
  "__v": 0
}
\`\`\`

#### 'database.new_categories'

\`\`\`
{
  "_id": "63a082114796a649f99264c2",
  "title": "Salary",
  "type": "income",
  "__v": 0
}
\`\`\``;
async function AskChatGPT() {
  const post_body = {};
  if (session_id) post_body['id'] = session_id;
  post_body['context'] = context;
  post_body['prompt'] = document.getElementById('playground_chat').value;
  // Send relevant context, user inquiry and session_id to chat API
  const response = await fetch("/chat3/post_simple_chat", {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify(post_body), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);
  if(status.status === "OK") {
    // Output response to HTML response container
    document.getElementById('chat_output').innerHTML = status.data.response;
    session_id = status.data.id;
  } else {
    // Alert error message
    alert(status.msg);
  }
}
