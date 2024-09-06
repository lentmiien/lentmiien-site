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

  // Add horizontal lines for humidity values
  svg.append("line")
    .attr("x1", 0)
    .attr("x2", width)
    .attr("y1", y1(30))
    .attr("y2", y1(30))
    .attr("stroke", "green")
    .attr("stroke-dasharray", "5,5");

  svg.append("line")
    .attr("x1", 0)
    .attr("x2", width)
    .attr("y1", y1(50))
    .attr("y2", y1(50))
    .attr("stroke", "green")
    .attr("stroke-dasharray", "5,5");
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

  // Humidity lines
  svg.append("path")
      .datum(detailed_data)
      .attr("class", "line")
      .attr("d", lineHumidityAvg)
      .attr("stroke", "blue")
      .attr("fill", "none");

  // Add horizontal lines for humidity values
  svg.append("line")
    .attr("x1", 0)
    .attr("x2", width)
    .attr("y1", y1(30))
    .attr("y2", y1(30))
    .attr("stroke", "green")
    .attr("stroke-dasharray", "5,5");

  svg.append("line")
    .attr("x1", 0)
    .attr("x2", width)
    .attr("y1", y1(50))
    .attr("y2", y1(50))
    .attr("stroke", "green")
    .attr("stroke-dasharray", "5,5");
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

  // Add vertical lines for humidity values
  svgHum.append("line")
    .attr("x1", x_hum(30))
    .attr("x2", x_hum(30))
    .attr("y1", height)
    .attr("y2", 0)
    .attr("stroke", "green")
    .attr("stroke-dasharray", "5,5");

  svgHum.append("line")
    .attr("x1", x_hum(50))
    .attr("x2", x_hum(50))
    .attr("y1", height)
    .attr("y2", 0)
    .attr("stroke", "green")
    .attr("stroke-dasharray", "5,5");
}

function generateAnalyticsTable() {
  const now = new Date();
  const last24Hours = detailed_data.filter(d => (now - new Date(d.timestamp)) <= 24 * 60 * 60 * 1000);
  const previous24Hours = detailed_data.filter(d => (now - new Date(d.timestamp)) > 24 * 60 * 60 * 1000 && (now - new Date(d.timestamp)) <= 48 * 60 * 60 * 1000);
  const twoPeriodsAgo = detailed_data.filter(d => (now - new Date(d.timestamp)) > 48 * 60 * 60 * 1000 && (now - new Date(d.timestamp)) <= 72 * 60 * 60 * 1000);

  function calculateMetrics(data) {
    const temperatures = data.map(d => d.avg.temperature);
    const humidities = data.map(d => d.avg.humidity);
    
    return {
      avgTemp: d3.mean(temperatures).toFixed(2),
      avgHumidity: d3.mean(humidities).toFixed(2),
      minTemp: d3.min(temperatures).toFixed(2),
      maxTemp: d3.max(temperatures).toFixed(2),
      minHumidity: d3.min(humidities).toFixed(2),
      maxHumidity: d3.max(humidities).toFixed(2),
      humidityInRange: (humidities.filter(h => h >= 30 && h <= 50).length / humidities.length * 100).toFixed(2),
      tempVariation: (d3.deviation(temperatures) || 0).toFixed(2),
      humidityVariation: (d3.deviation(humidities) || 0).toFixed(2)
    };
  }

  const last24HoursMetrics = calculateMetrics(last24Hours);
  const previous24HoursMetrics = calculateMetrics(previous24Hours);
  const twoPeriodsAgoMetrics = calculateMetrics(twoPeriodsAgo);

  const table = d3.select("#analytics")
    .append("table")
    .attr("class", "analytics-table table table-striped");

  const thead = table.append("thead");
  const tbody = table.append("tbody");

  thead.append("tr")
    .selectAll("th")
    .data(["Metric", "Last 24 Hours", "24-48 Hours Ago", "48-72 Hours Ago"])
    .enter()
    .append("th")
    .text(d => d);

  const rows = [
    {name: "Average Temperature (°C)", current: last24HoursMetrics.avgTemp, previous: previous24HoursMetrics.avgTemp, oldest: twoPeriodsAgoMetrics.avgTemp},
    {name: "Average Humidity (%)", current: last24HoursMetrics.avgHumidity, previous: previous24HoursMetrics.avgHumidity, oldest: twoPeriodsAgoMetrics.avgHumidity},
    {name: "Temperature Range (°C)", current: `${last24HoursMetrics.minTemp} - ${last24HoursMetrics.maxTemp}`, previous: `${previous24HoursMetrics.minTemp} - ${previous24HoursMetrics.maxTemp}`, oldest: `${twoPeriodsAgoMetrics.minTemp} - ${twoPeriodsAgoMetrics.maxTemp}`},
    {name: "Humidity Range (%)", current: `${last24HoursMetrics.minHumidity} - ${last24HoursMetrics.maxHumidity}`, previous: `${previous24HoursMetrics.minHumidity} - ${previous24HoursMetrics.maxHumidity}`, oldest: `${twoPeriodsAgoMetrics.minHumidity} - ${twoPeriodsAgoMetrics.maxHumidity}`},
    {name: "Humidity in 30-50% Range (%)", current: last24HoursMetrics.humidityInRange, previous: previous24HoursMetrics.humidityInRange, oldest: twoPeriodsAgoMetrics.humidityInRange},
    {name: "Temperature Variation (°C)", current: last24HoursMetrics.tempVariation, previous: previous24HoursMetrics.tempVariation, oldest: twoPeriodsAgoMetrics.tempVariation},
    {name: "Humidity Variation (%)", current: last24HoursMetrics.humidityVariation, previous: previous24HoursMetrics.humidityVariation, oldest: twoPeriodsAgoMetrics.humidityVariation}
  ];

  tbody.selectAll("tr")
    .data(rows)
    .enter()
    .append("tr")
    .html(d => `
      <td>${d.name}</td>
      <td>${formatWithChange(d.current, d.previous)}</td>
      <td>${formatWithChange(d.previous, d.oldest)}</td>
      <td>${d.oldest}</td>
    `);

  function formatWithChange(current, previous) {
    if (current.includes('-') || previous.includes('-')) return current;
    const change = (parseFloat(current) - parseFloat(previous)).toFixed(2);
    const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
    return `${current} (${Math.abs(change)} ${arrow})`;
  }
}

function PlotGraphs() {
  PlotAggregatedGraph("average");
  PlotDetailedGraph("detailed");
  PlotHistograms("histogram");
  generateAnalyticsTable();
}

document.addEventListener('DOMContentLoaded', (event) => {
  PlotGraphs();
});
