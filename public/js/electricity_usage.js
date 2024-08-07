const logs = JSON.parse(document.getElementById("logs").innerHTML);
/**
 * 'logs' is an array of objects in the following format:
{
  device: "device id",
  timestamp: <Date object>
  power: <number, power usage in milliwatt>
}
*/

// Temporary fix after changing device ids, can be removed after 5 days 27/7/2024
const map = {
  "192.168.0.39": "L-AC",
  "192.168.0.27": "L-AC",
  "192.168.0.45": "L-PC",
  "192.168.0.31": "L-PC",
  "192.168.0.46": "Ma-AC",
  "192.168.0.29": "Ma-AC",
  "192.168.0.47": "L-AC",
  "192.168.0.28": "Bed-AC",
}
const keys = Object.keys(map);
logs.forEach(d => {
  if (keys.indexOf(d.device) >= 0) {
    d.device = map[d.device];
  }
})

const summary = JSON.parse(document.getElementById("summary").innerHTML);
/**
 * 'summary' is an array of objects in the following format:
{
  device: "device id",
  timestamp: <Date object>
  power: <number, power usage of the day in watt-hours>
}
*/

function PlotRealTimeGraph(parent_element) {
  // Set the dimensions and margins of the graph
  const margin = {top: 30, right: 130, bottom: 50, left: 60};
  const width = 900 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  // Set the ranges
  const x = d3.scaleTime().range([0, width]);
  const y = d3.scaleLinear().range([height, 0]);

  // Define color scale
  const color = d3.scaleOrdinal(d3.schemeCategory10);

  // Define the line
  const valueline = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y(d.power));

  // Append the svg object to the body of the page
  const svg = d3.select("#" + parent_element).append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Format the data
  logs.forEach(d => {
    d.timestamp = new Date(d.timestamp);
    d.power = +d.power / 1000;  // Convert mW to W
  });

  // Group the data by device
  const devices = d3.group(logs, d => d.device);

  // Calculate 3-point min-max average
  function calculateMinMaxAverage(data, windowSize = 7) {
    return data.map((d, i, arr) => {
      const start = Math.max(0, i - windowSize + 1);
      const window = arr.slice(start, i + 1);
      const minPower = d3.min(window, w => w.power);
      const maxPower = d3.max(window, w => w.power);
      return {
        timestamp: d.timestamp,
        power: (minPower + maxPower) / 2
      };
    });
  }

  // Scale the range of the data
  x.domain(d3.extent(logs, d => d.timestamp));
  y.domain([0, d3.max(logs, d => d.power)]);

  // Add the original lines (thinner and dashed)
  devices.forEach((values, key) => {
    svg.append("path")
      .data([values])
      .attr("class", "line original")
      .attr("d", valueline)
      .attr("fill", "none")
      .attr("stroke", color(key))
      .attr("stroke-width", 0.2)
      .attr("stroke-dasharray", "4,4");
  });

  // Add the min-max average lines
  devices.forEach((values, key) => {
    const minMaxAverageData = calculateMinMaxAverage(values);
    svg.append("path")
      .data([minMaxAverageData])
      .attr("class", "line average")
      .attr("d", valueline)
      .attr("fill", "none")
      .attr("stroke", color(key))
      .attr("stroke-width", 2);
  });

  // Add the X Axis
  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x));

  // Add the Y Axis
  svg.append("g")
    .call(d3.axisLeft(y));

  // X axis label
  svg.append("text")
    .attr("transform", `translate(${width/2},${height + margin.top + 20})`)
    .style("text-anchor", "middle")
    .text("Time");

  // Y axis label
  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("y", 0 - margin.left)
    .attr("x", 0 - (height / 2))
    .attr("dy", "1em")
    .style("text-anchor", "middle")
    .text("Power (Watts)");

  // Title
  svg.append("text")
    .attr("x", (width / 2))
    .attr("y", 0 - (margin.top / 2))
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .text("Power Usage Over Time");

  // Add a legend
  const legend = svg.selectAll(".legend")
    .data(color.domain())
    .enter().append("g")
    .attr("class", "legend")
    .attr("transform", (d, i) => `translate(0,${i * 20})`);

  legend.append("rect")
    .attr("x", width + 10)
    .attr("width", 18)
    .attr("height", 18)
    .style("fill", color);

  legend.append("text")
    .attr("x", width + 35)
    .attr("y", 9)
    .attr("dy", ".35em")
    .style("text-anchor", "start")
    .text(d => d);

  // Add legend for line types
  const lineTypeLegend = svg.append("g")
    .attr("class", "line-type-legend")
    .attr("transform", `translate(${width + 10}, ${color.domain().length * 20 + 20})`);

  lineTypeLegend.append("line")
    .attr("x1", 0)
    .attr("y1", 0)
    .attr("x2", 20)
    .attr("y2", 0)
    .attr("stroke", "black")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,4");

  lineTypeLegend.append("text")
    .attr("x", 25)
    .attr("y", 4)
    .text("Raw Data");

  lineTypeLegend.append("line")
    .attr("x1", 0)
    .attr("y1", 20)
    .attr("x2", 20)
    .attr("y2", 20)
    .attr("stroke", "black")
    .attr("stroke-width", 2);

  lineTypeLegend.append("text")
    .attr("x", 25)
    .attr("y", 24)
    .text("7-point Min-Max Average");

  return color;
}

function PlotLastHourAvgGauge(parent_element, color) {
  // Set the dimensions and margins of the graph
  const margin = {top: 30, right: 30, bottom: 70, left: 60};
  const width = 600 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  // Create SVG element
  const svg = d3.select("#" + parent_element)
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  // Calculate the time one hour ago
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Filter and process the data
  const lastHourData = logs.filter(d => d.timestamp >= oneHourAgo);
  const deviceAverages = d3.rollup(lastHourData,
    v => d3.mean(v, d => d.power),
    d => d.device
  );

  const data = Array.from(deviceAverages, ([device, avg]) => ({device, avg}));

  // X axis
  const x = d3.scaleBand()
    .range([0, width])
    .domain(data.map(d => d.device))
    .padding(0.2);
  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
      .attr("transform", "translate(-10,0)rotate(-45)")
      .style("text-anchor", "end");

  // Y axis
  const y = d3.scaleLinear()
    .domain([0, d3.max(data, d => d.avg)])
    .range([height, 0]);
  svg.append("g")
    .call(d3.axisLeft(y));

  // Bars
  svg.selectAll("mybar")
    .data(data)
    .join("rect")
      .attr("x", d => x(d.device))
      .attr("y", d => y(d.avg))
      .attr("width", x.bandwidth())
      .attr("height", d => height - y(d.avg))
      .attr("fill", d => color(d.device));

  // X axis label
  svg.append("text")
    .attr("text-anchor", "end")
    .attr("x", width / 2 + margin.left)
    .attr("y", height + margin.top + 40)
    .text("Device");

  // Y axis label
  svg.append("text")
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-90)")
    .attr("y", -margin.left + 20)
    .attr("x", -height / 2)
    .text("Average Power (Watts)");

  // Title
  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 0 - (margin.top / 2))
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .text("Average Power Usage in the Last Hour");
}

function PlotDailySummaryGraph(parent_element, color) {
  const margin = {top: 30, right: 130, bottom: 50, left: 60};
  const width = 900 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  const x = d3.scaleTime().range([0, width]);
  const y = d3.scaleLinear().range([height, 0]);

  const valueline = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y(d.power));

  const svg = d3.select("#" + parent_element).append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  summary.forEach(d => {
    d.timestamp = new Date((new Date(d.timestamp)).getTime() - (1000*60*60*24));
    d.power = +d.power;
  });

  const devices = d3.group(summary, d => d.device);

  x.domain(d3.extent(summary, d => d.timestamp));
  y.domain([0, d3.max(summary, d => d.power)]);

  devices.forEach((values, key) => {
    svg.append("path")
      .data([values])
      .attr("class", "line")
      .attr("d", valueline)
      .attr("fill", "none")
      .attr("stroke", color(key))
      .attr("stroke-width", 1.5);
  });

  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x));

  svg.append("g")
    .call(d3.axisLeft(y));

  svg.append("text")
    .attr("transform", `translate(${width/2},${height + margin.top + 20})`)
    .style("text-anchor", "middle")
    .text("Date");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("y", 0 - margin.left)
    .attr("x", 0 - (height / 2))
    .attr("dy", "1em")
    .style("text-anchor", "middle")
    .text("Power (Watt-hours)");

  svg.append("text")
    .attr("x", (width / 2))
    .attr("y", 0 - (margin.top / 2))
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .text("Daily Power Usage Summary");

  const legend = svg.selectAll(".legend")
    .data(color.domain())
    .enter().append("g")
    .attr("class", "legend")
    .attr("transform", (d, i) => `translate(0,${i * 20})`);

  legend.append("rect")
    .attr("x", width + 10)
    .attr("width", 18)
    .attr("height", 18)
    .style("fill", color);

  legend.append("text")
    .attr("x", width + 35)
    .attr("y", 9)
    .attr("dy", ".35em")
    .style("text-anchor", "start")
    .text(d => d);
}

function PlotPieChart(parent_element, color) {
  const width = 450;
  const height = 480;  // Increased height by 30 pixels
  const radius = Math.min(width, height - 30) / 2;  // Adjusted radius calculation

  const svg = d3.select("#" + parent_element).append("svg")
    .attr("width", width)
    .attr("height", height)
    .append("g")
    .attr("transform", `translate(${width / 2},${(height / 2) + 15})`);  // Adjusted vertical position

  const pie = d3.pie()
    .value(d => d.power)
    .sort(null);

  const arc = d3.arc()
    .innerRadius(0)
    .outerRadius(radius);

  // Get the last 14 days of data
  const last14Days = summary.filter(d => {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    return new Date(d.timestamp) >= twoWeeksAgo;
  });

  // Aggregate data by device
  const deviceTotals = d3.rollup(last14Days, 
    v => d3.sum(v, d => d.power),
    d => d.device
  );

  const data = Array.from(deviceTotals, ([device, power]) => ({device, power}));

  const arcs = svg.selectAll("arc")
    .data(pie(data))
    .enter()
    .append("g")
    .attr("class", "arc");

  arcs.append("path")
    .attr("d", arc)
    .attr("fill", d => color(d.data.device));

  arcs.append("text")
    .attr("transform", d => `translate(${arc.centroid(d)})`)
    .attr("text-anchor", "middle")
    .text(d => `${d.data.device}: ${(d.data.power/1000).toFixed(2)}kWh`);

  // Adjusted title position
  svg.append("text")
    .attr("x", 0)
    .attr("y", -height / 2)  // Adjusted y position
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .text("Power Consumption Distribution (Last 14 Days)");
}

function PlotGraphs() {
  const color = PlotRealTimeGraph("output");
  PlotLastHourAvgGauge("hourly-average", color)
  PlotDailySummaryGraph("daily-summary", color);
  PlotPieChart("pie-chart", color);
}

document.addEventListener('DOMContentLoaded', (event) => {
  PlotGraphs();
});
