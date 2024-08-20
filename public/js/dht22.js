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
  min: { type: Object },//{temperature:26.2, humidity:55}
  max: { type: Object },//{temperature:26.4, humidity:55.2}
  avg: { type: Object },//{temperature:26.268, humidity:55.112}
  timestamp: { type: Date },
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

  const lineAvg = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y0(d.avg ? d.avg.temperature : d.temperature));

  const lineMin = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y0(d.min ? d.min.temperature : d.temperature));

  const lineMax = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y0(d.max ? d.max.temperature : d.temperature));

  const lineHumidityAvg = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y1(d.avg ? d.avg.humidity : d.humidity));

  const lineHumidityMin = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y1(d.min ? d.min.humidity : d.humidity));

  const lineHumidityMax = d3.line()
    .x(d => x(d.timestamp))
    .y(d => y1(d.max ? d.max.humidity : d.humidity));

  detailed_data.forEach(d => {
    d.timestamp = new Date(d.timestamp);
  });

  x.domain(d3.extent(detailed_data, d => d.timestamp));
  y0.domain([
    d3.min(detailed_data, d => Math.min(d.min ? d.min.temperature : d.temperature, d.avg ? d.avg.temperature : d.temperature)) - 1,
    d3.max(detailed_data, d => Math.max(d.max ? d.max.temperature : d.temperature, d.avg ? d.avg.temperature : d.temperature)) + 1
  ]);
  y1.domain([
    d3.min(detailed_data, d => Math.min(d.min ? d.min.humidity : d.humidity, d.avg ? d.avg.humidity : d.humidity)) - 1,
    d3.max(detailed_data, d => Math.max(d.max ? d.max.humidity : d.humidity, d.avg ? d.avg.humidity : d.humidity)) + 1
  ]);

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

  // Temperature lines
  svg.append("path")
      .datum(detailed_data)
      .attr("class", "line")
      .attr("d", lineAvg)
      .attr("stroke", "red")
      .attr("fill", "none");

  // svg.append("path")
  //     .datum(detailed_data)
  //     .attr("class", "line")
  //     .attr("d", lineMin)
  //     .attr("stroke", "red")
  //     .attr("stroke-dasharray", "3,3")
  //     .attr("stroke-width", "1")
  //     .attr("fill", "none");

  // svg.append("path")
  //     .datum(detailed_data)
  //     .attr("class", "line")
  //     .attr("d", lineMax)
  //     .attr("stroke", "red")
  //     .attr("stroke-dasharray", "3,3")
  //     .attr("stroke-width", "1")
  //     .attr("fill", "none");

  // Humidity lines
  svg.append("path")
      .datum(detailed_data)
      .attr("class", "line")
      .attr("d", lineHumidityAvg)
      .attr("stroke", "blue")
      .attr("fill", "none");

  // svg.append("path")
  //     .datum(detailed_data)
  //     .attr("class", "line")
  //     .attr("d", lineHumidityMin)
  //     .attr("stroke", "blue")
  //     .attr("stroke-dasharray", "3,3")
  //     .attr("stroke-width", "1")
  //     .attr("fill", "none");

  // svg.append("path")
  //     .datum(detailed_data)
  //     .attr("class", "line")
  //     .attr("d", lineHumidityMax)
  //     .attr("stroke", "blue")
  //     .attr("stroke-dasharray", "3,3")
  //     .attr("stroke-width", "1")
  //     .attr("fill", "none");
}

function PlotHistograms(parent_element) {
  const margin = {top: 20, right: 30, bottom: 30, left: 40};
  const width = 480 - margin.left - margin.right;
  const height = 300 - margin.top - margin.bottom;

  // Filter detailed data to only include entries from the last 24 hours
  const now = new Date();
  const last24HoursData = detailed_data.filter(d => {
    const timestamp = new Date(d.timestamp);
    return (now - timestamp) <= 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  });

  // Extract temperature and humidity values using the new data format
  const temperatures = last24HoursData.map(d => d.avg ? d.avg.temperature : d.temperature);
  const humidities = last24HoursData.map(d => d.avg ? d.avg.humidity : d.humidity);

  // Temperature Histogram
  const svgTemp = d3.select("#" + parent_element)
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  const x_temp = d3.scaleLinear()
    .domain([d3.min(temperatures), d3.max(temperatures)])
    .range([0, width]);

  const histogram_temp = d3.histogram()
    .domain(x_temp.domain())
    .thresholds(x_temp.ticks(20));

  const bins_temp = histogram_temp(temperatures);

  const y_temp = d3.scaleLinear()
    .range([height, 0])
    .domain([0, d3.max(bins_temp, d => d.length)]);

  svgTemp.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x_temp));

  svgTemp.append("g")
    .call(d3.axisLeft(y_temp));

  svgTemp.selectAll("rect")
    .data(bins_temp)
    .enter()
    .append("rect")
      .attr("x", 1)
      .attr("transform", d => `translate(${x_temp(d.x0)}, ${y_temp(d.length)})`)
      .attr("width", d => x_temp(d.x1) - x_temp(d.x0) - 1)
      .attr("height", d => height - y_temp(d.length))
      .style("fill", "red");

  svgTemp.append("text")
    .attr("x", width / 2)
    .attr("y", 0)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .text("Temperature Distribution");

  // Humidity Histogram
  const svgHum = d3.select("#" + parent_element)
    .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  const x_hum = d3.scaleLinear()
    .domain([d3.min(humidities), d3.max(humidities)])
    .range([0, width]);

  const histogram_hum = d3.histogram()
    .domain(x_hum.domain())
    .thresholds(x_hum.ticks(20));

  const bins_hum = histogram_hum(humidities);

  const y_hum = d3.scaleLinear()
    .range([height, 0])
    .domain([0, d3.max(bins_hum, d => d.length)]);

  svgHum.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x_hum));

  svgHum.append("g")
    .call(d3.axisLeft(y_hum));

  svgHum.selectAll("rect")
    .data(bins_hum)
    .enter()
    .append("rect")
      .attr("x", 1)
      .attr("transform", d => `translate(${x_hum(d.x0)}, ${y_hum(d.length)})`)
      .attr("width", d => x_hum(d.x1) - x_hum(d.x0) - 1)
      .attr("height", d => height - y_hum(d.length))
      .style("fill", "blue");

  svgHum.append("text")
    .attr("x", width / 2)
    .attr("y", 0)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .text("Humidity Distribution");
}

function PlotGraphs() {
  PlotAggregatedGraph("average");
  PlotDetailedGraph("detailed");
  PlotHistograms("histogram");
}

document.addEventListener('DOMContentLoaded', (event) => {
  PlotGraphs();
});
