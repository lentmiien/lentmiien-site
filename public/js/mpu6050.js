const aggregated_data = JSON.parse(document.getElementById("aggregated_data").innerHTML);
/**
 * 'aggregated_data' is an array of objects in the following format:
const AggregatedData = new mongoose.Schema({
  min: { type: Object }, // Example: {"accel_x": 276,"accel_y": 186,"accel_z": 15736}
  max: { type: Object }, // Example: {"accel_x": 830,"accel_y": 552,"accel_z": 16192}
  avg: { type: Object }, // Example: {"accel_x": 682.1981400645284,"accel_y": 379.4541658758778,"accel_z": 15974.600493452268}
  timestamp: { type: Date },
});

*/

const detailed_data = JSON.parse(document.getElementById("detailed_data").innerHTML);
/**
 * 'detailed_data' is an array of objects in the following format:
const DetailedData = new mongoose.Schema({
  timestamp: { type: Date },
  accel_x: { type: Number },
  accel_y: { type: Number },
  accel_z: { type: Number },
});
*/

function PlotAggregatedGraph(parent_element) {
  const margin = {top: 20, right: 20, bottom: 30, left: 50};
  const width = 800 - margin.left - margin.right;
  const height = 600 - margin.top - margin.bottom;

  const svg = d3.select(`#${parent_element}`)
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleTime().range([0, width]);
  const y = d3.scaleLinear().range([height/3, 0]);

  const xAxis = d3.axisBottom(x);
  const yAxis = d3.axisLeft(y);

  const area = d3.area()
    .x(d => x(new Date(d.timestamp)))
    .y0(d => y(d.min))
    .y1(d => y(d.max));

  const line = d3.line()
    .x(d => x(new Date(d.timestamp)))
    .y(d => y(d.avg));

  const axes = ['accel_x', 'accel_y', 'accel_z'];
  const colors = ['red', 'green', 'blue'];

  axes.forEach((axis, index) => {
    const yOffset = index * (height / 3);

    x.domain(d3.extent(aggregated_data, d => new Date(d.timestamp)));
    y.domain([
      d3.min(aggregated_data, d => d.min[axis]),
      d3.max(aggregated_data, d => d.max[axis])
    ]);

    svg.append("g")
      .attr("transform", `translate(0,${yOffset + height/3})`)
      .call(xAxis);

    svg.append("g")
      .attr("transform", `translate(0,${yOffset})`)
      .call(yAxis);

    svg.append("path")
      .datum(aggregated_data)
      .attr("fill", "lightgray")
      .attr("opacity", 0.5)
      .attr("transform", `translate(0,${yOffset})`)
      .attr("d", area.y0(d => y(d.min[axis])).y1(d => y(d.max[axis])));

    svg.append("path")
      .datum(aggregated_data)
      .attr("fill", "none")
      .attr("stroke", colors[index])
      .attr("stroke-width", 1.5)
      .attr("transform", `translate(0,${yOffset})`)
      .attr("d", line.y(d => y(d.avg[axis])));

    svg.append("text")
      .attr("x", 10)
      .attr("y", yOffset + 20)
      .attr("fill", colors[index])
      .text(axis.toUpperCase());
  });
}

function PlotDetailedGraph(parent_element) {
  const margin = {top: 20, right: 20, bottom: 30, left: 50};
  const width = 800 - margin.left - margin.right;
  const height = 400 - margin.top - margin.bottom;

  const svg = d3.select(`#${parent_element}`)
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleTime().range([0, width]);
  const y = d3.scaleLinear().range([height, 0]);

  const xAxis = d3.axisBottom(x);
  const yAxis = d3.axisLeft(y);

  const line = d3.line()
    .x(d => x(new Date(d.timestamp)))
    .y(d => y(d.value));

  x.domain(d3.extent(detailed_data, d => new Date(d.timestamp)));
  y.domain([
    d3.min(detailed_data, d => Math.min(d.accel_x, d.accel_y, d.accel_z)),
    d3.max(detailed_data, d => Math.max(d.accel_x, d.accel_y, d.accel_z))
  ]);

  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(xAxis);

  svg.append("g")
    .call(yAxis);

  const axes = ['accel_x', 'accel_y', 'accel_z'];
  const colors = ['red', 'green', 'blue'];

  axes.forEach((axis, index) => {
    svg.append("path")
      .datum(detailed_data)
      .attr("fill", "none")
      .attr("stroke", colors[index])
      .attr("stroke-width", 1.5)
      .attr("d", line.y(d => y(d[axis])));

    svg.append("text")
      .attr("x", width - 50)
      .attr("y", 20 + index * 20)
      .attr("fill", colors[index])
      .text(axis.toUpperCase());
  });
}

function PlotGraphs() {
  PlotAggregatedGraph("chunk");
  PlotDetailedGraph("detailed");
}

document.addEventListener('DOMContentLoaded', (event) => {
  PlotGraphs();
});
