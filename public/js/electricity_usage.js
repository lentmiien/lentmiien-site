const logs = JSON.parse(document.getElementById("logs").innerHTML);
/**
 * 'logs' is an array of objects in the following format:
{
  device: "device id",
  timestamp: <Date object>
  power: <number, power usage in watt>
}
 */

function PlotGraph(parent_element = "output") {
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

  // Scale the range of the data
  x.domain(d3.extent(logs, d => d.timestamp));
  y.domain([0, d3.max(logs, d => d.power)]);

  // Add the valueline path for each device
  devices.forEach((values, key) => {
    svg.append("path")
      .data([values])
      .attr("class", "line")
      .attr("d", valueline)
      .attr("fill", "none")
      .attr("stroke", color(key))
      .attr("stroke-width", 1.5);
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
}

document.addEventListener('DOMContentLoaded', (event) => {
  PlotGraph();
});
