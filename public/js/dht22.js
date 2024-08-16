const aggregated_data = JSON.parse(document.getElementById("aggregated_data").innerHTML);
/**
 * 'aggregated_data' is an array of objects in the following format:
const Dht22AggregatedData = new mongoose.Schema({
  timestamp: { type: Date },
  average_temperature: { type: Number },
  average_humidity: { type: Number },
});
*/

const detailed_data = JSON.parse(document.getElementById("detailed_data").innerHTML);
/**
 * 'detailed_data' is an array of objects in the following format:
const Dht22DetailedData = new mongoose.Schema({
  timestamp: { type: Date },
  temperature: { type: Number },
  humidity: { type: Number },
});
*/

function PlotAggregatedGraph(parent_element) {
  const margin = {top: 20, right: 80, bottom: 30, left: 50};
  const width = 960 - margin.left - margin.right;
  const height = 500 - margin.top - margin.bottom;

  const svg = d3.select("#" + parent_element)
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleTime().range([0, width]);
  const y0 = d3.scaleLinear().range([height, 0]);
  const y1 = d3.scaleLinear().range([height, 0]);

  const xAxis = d3.axisBottom(x);
  const yAxisLeft = d3.axisLeft(y0).tickFormat(d3.format(".1f"));
  const yAxisRight = d3.axisRight(y1).tickFormat(d3.format(".1f"));

  const line0 = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y0(d.average_temperature));

  const line1 = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y1(d.average_humidity));

  aggregated_data.forEach(d => {
    d.timestamp = new Date(d.timestamp);
  });

  x.domain(d3.extent(aggregated_data, d => d.timestamp));
  y0.domain([d3.min(aggregated_data, d => d.average_temperature) - 1, d3.max(aggregated_data, d => d.average_temperature) + 1]);
  y1.domain([d3.min(aggregated_data, d => d.average_humidity) - 1, d3.max(aggregated_data, d => d.average_humidity) + 1]);

  svg.append("g")
      .attr("class", "x axis")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis);

  svg.append("g")
      .attr("class", "y axis")
      .call(yAxisLeft)
    .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 6)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text("Temperature (°C)");

  svg.append("g")
      .attr("class", "y axis")
      .attr("transform", `translate(${width}, 0)`)
      .call(yAxisRight)
    .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -15)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text("Humidity (%)");

  svg.append("path")
      .datum(aggregated_data)
      .attr("class", "line")
      .attr("d", line0)
      .attr("stroke", "red")
      .attr("fill", "none");

  svg.append("path")
      .datum(aggregated_data)
      .attr("class", "line")
      .attr("d", line1)
      .attr("stroke", "blue")
      .attr("fill", "none");
}

function PlotDetailedGraph(parent_element) {
  const margin = {top: 20, right: 80, bottom: 30, left: 50};
  const width = 960 - margin.left - margin.right;
  const height = 500 - margin.top - margin.bottom;

  const svg = d3.select("#" + parent_element)
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleTime().range([0, width]);
  const y0 = d3.scaleLinear().range([height, 0]);
  const y1 = d3.scaleLinear().range([height, 0]);

  const xAxis = d3.axisBottom(x);
  const yAxisLeft = d3.axisLeft(y0).tickFormat(d3.format(".1f"));
  const yAxisRight = d3.axisRight(y1).tickFormat(d3.format(".1f"));

  const line0 = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y0(d.temperature));

  const line1 = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y1(d.humidity));

  detailed_data.forEach(d => {
    d.timestamp = new Date(d.timestamp);
  });

  x.domain(d3.extent(detailed_data, d => d.timestamp));
  y0.domain([d3.min(detailed_data, d => d.temperature) - 1, d3.max(detailed_data, d => d.temperature) + 1]);
  y1.domain([d3.min(detailed_data, d => d.humidity) - 1, d3.max(detailed_data, d => d.humidity) + 1]);

  svg.append("g")
      .attr("class", "x axis")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis);

  svg.append("g")
      .attr("class", "y axis")
      .call(yAxisLeft)
    .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 6)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text("Temperature (°C)");

  svg.append("g")
      .attr("class", "y axis")
      .attr("transform", `translate(${width}, 0)`)
      .call(yAxisRight)
    .append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", -15)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text("Humidity (%)");

  svg.append("path")
      .datum(detailed_data)
      .attr("class", "line")
      .attr("d", line0)
      .attr("stroke", "red")
      .attr("fill", "none");

  svg.append("path")
      .datum(detailed_data)
      .attr("class", "line")
      .attr("d", line1)
      .attr("stroke", "blue")
      .attr("fill", "none");
}

function PlotGraphs() {
  PlotAggregatedGraph("average");
  PlotDetailedGraph("detailed");
}

document.addEventListener('DOMContentLoaded', (event) => {
  PlotGraphs();
});
