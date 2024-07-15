const logs = JSON.parse(document.getElementById("logs").innerHTML);
/**
 * 'logs' is an array of objects in the following format:
{
  device: "device id",
  timestamp: <Date object>
  power: <number, power usage in milliwatt>
}
*/

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

  // Parse the date / time
  const parseTime = d3.timeParse("%Y-%m-%dT%H:%M:%S.%LZ");

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
    d.timestamp = parseTime(d.timestamp);
    d.power = +d.power / 1000;  // Convert mW to W
  });

  // Group the data by device
  const devices = d3.group(logs, d => d.device);

  // Calculate 9-point rolling average
  function calculateRollingAverage(data, windowSize = 9) {
    return data.map((d, i, arr) => {
      const start = Math.max(0, i - windowSize + 1);
      const window = arr.slice(start, i + 1);
      const sum = window.reduce((acc, curr) => acc + curr.power, 0);
      return {
        timestamp: d.timestamp,
        power: sum / window.length
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

  // Add the rolling average lines
  devices.forEach((values, key) => {
    const rollingAverageData = calculateRollingAverage(values);
    svg.append("path")
      .data([rollingAverageData])
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
    .text("9-point Rolling Average");

  return color;
}

function PlotDailySummaryGraph(parent_element, color) {
  const margin = {top: 30, right: 130, bottom: 50, left: 60};
  const width = 900 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  const parseTime = d3.timeParse("%Y-%m-%dT%H:%M:%S.%LZ");

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
    d.timestamp = parseTime(d.timestamp);
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
  PlotDailySummaryGraph("daily-summary", color);
  PlotPieChart("pie-chart", color);
}

document.addEventListener('DOMContentLoaded', (event) => {
  PlotGraphs();
});
