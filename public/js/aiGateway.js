(function () {
  const dataElement = document.getElementById('aiGatewayData');

  let payload = {};
  if (!dataElement) {
    console.warn('AI gateway payload element missing; rendering with defaults.');
  } else {
    try {
      payload = JSON.parse(dataElement.textContent || '{}');
    } catch (error) {
      console.error('Failed to parse AI gateway payload.', error);
      payload = {};
    }
  }

  const chartData = payload.chartData || {};
  const routeOverview = Array.isArray(chartData.routeOverview) ? chartData.routeOverview : [];
  const llmThroughput = Array.isArray(chartData.llmThroughput) ? chartData.llmThroughput : [];
  const ocrTimings = Array.isArray(chartData.ocrTimings) ? chartData.ocrTimings : [];
  const ttsBackends = Array.isArray(chartData.ttsBackends) ? chartData.ttsBackends : [];
  const gpuTimeline = chartData.gpuTimeline || {};
  const gpu = payload.gpu || {};
  const autoStop = payload.autoStop || null;

  const STATUS_LABELS = {
    success: '2xx success',
    clientError: '4xx error',
    serverError: '5xx error',
    other: 'Other',
  };

  const asNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const formatInteger = (value) => {
    const num = asNumber(value);
    return num === null ? 'N/A' : Math.round(num).toLocaleString('en-US');
  };

  const formatPercentValue = (value, digits = 1) => {
    const num = asNumber(value);
    return num === null ? 'N/A' : `${num.toFixed(digits)}%`;
  };

  const formatBytesCompact = (bytes) => {
    const num = asNumber(bytes);
    if (num === null) return 'N/A';
    if (num === 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    const exponent = Math.min(units.length - 1, Math.floor(Math.log(num) / Math.log(1024)));
    const value = num / (1024 ** exponent);
    const digits = value >= 100 ? 0 : (value >= 10 ? 1 : 2);
    return `${value.toFixed(digits)} ${units[exponent]}`;
  };

  const formatSeconds = (seconds) => {
    const num = asNumber(seconds);
    if (num === null) return 'N/A';
    if (num < 1) return `${Math.round(num * 1000)} ms`;
    if (num < 10) return `${num.toFixed(2)} s`;
    if (num < 60) return `${num.toFixed(1)} s`;
    if (num < 3600) {
      const minutes = Math.floor(num / 60);
      const remaining = Math.round(num % 60);
      return `${minutes}m ${remaining}s`;
    }
    const hours = Math.floor(num / 3600);
    const minutes = Math.round((num % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const axisTickSeconds = (value) => {
    const num = asNumber(value);
    if (num === null) return '';
    if (num < 1) return `${Math.round(num * 1000)}ms`;
    if (num < 10) return `${num.toFixed(1)}s`;
    if (num < 60) return `${Math.round(num)}s`;
    return `${Math.round(num / 60)}m`;
  };

  const appendLegend = (container, items) => {
    if (!container || !Array.isArray(items) || !items.length) {
      return;
    }
    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'chart-legend__item';
      const swatch = document.createElement('span');
      swatch.className = 'chart-legend__swatch';
      swatch.style.backgroundColor = item.color;
      if (item.borderColor) {
        swatch.style.borderColor = item.borderColor;
      }
      const label = document.createElement('span');
      label.textContent = item.label;
      row.appendChild(swatch);
      row.appendChild(label);
      legend.appendChild(row);
    });
    container.appendChild(legend);
  };

  const drawHorizontalGrid = (chart, yScale, innerWidth) => {
    chart.append('g')
      .attr('stroke', 'rgba(148, 163, 184, 0.18)')
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(yScale.ticks ? yScale.ticks(5) : [])
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));
  };

  const drawVerticalGrid = (chart, xScale, innerHeight, ticks) => {
    const values = Array.isArray(ticks) && ticks.length ? ticks : (xScale.ticks ? xScale.ticks(5) : []);
    chart.append('g')
      .attr('stroke', 'rgba(148, 163, 184, 0.18)')
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(values)
      .join('line')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerHeight);
  };

  const resizeCallbacks = [];
  let resizeRaf = null;

  const scheduleResize = () => {
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
    }
    resizeRaf = requestAnimationFrame(() => {
      resizeCallbacks.forEach((cb) => {
        try {
          cb();
        } catch (error) {
          console.error('Resize callback failed', error);
        }
      });
    });
  };

  window.addEventListener('resize', scheduleResize);

  const showEmpty = (container, message) => {
    if (!container) return;
    container.innerHTML = `<div class="chart-empty">${message}</div>`;
  };

  const renderRequestVolumeChart = () => {
    const container = document.getElementById('requestVolumeChart');
    if (!container) {
      return;
    }

    const data = routeOverview
      .filter((entry) => entry && entry.count)
      .slice()
      .sort((a, b) => (b.count || 0) - (a.count || 0));

    if (!data.length) {
      showEmpty(container, 'No recent route logs yet.');
      return;
    }

    const statusKeys = ['success', 'clientError', 'serverError', 'other']
      .filter((key) => data.some((entry) => (entry.statusBuckets?.[key] || 0) > 0));

    const seriesData = data.map((entry) => ({
      label: entry.label || entry.route,
      success: asNumber(entry.statusBuckets?.success) || 0,
      clientError: asNumber(entry.statusBuckets?.clientError) || 0,
      serverError: asNumber(entry.statusBuckets?.serverError) || 0,
      other: asNumber(entry.statusBuckets?.other) || 0,
      total: entry.count || 0,
    }));

    const width = container.clientWidth || 560;
    const height = Math.max(260, Math.floor(width * 0.58));
    const margin = { top: 20, right: 20, bottom: 84, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const color = d3.scaleOrdinal()
      .domain(statusKeys)
      .range(['#22c55e', '#f59e0b', '#ef4444', '#94a3b8']);
    const stack = d3.stack().keys(statusKeys)(seriesData);

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleBand()
      .domain(seriesData.map((d) => d.label))
      .range([0, innerWidth])
      .padding(0.2);

    const maxValue = d3.max(seriesData, (d) => d.total) || 1;
    const yScale = d3.scaleLinear()
      .domain([0, maxValue * 1.15])
      .nice()
      .range([innerHeight, 0]);

    drawHorizontalGrid(chart, yScale, innerWidth);

    chart.append('g')
      .selectAll('g')
      .data(stack)
      .join('g')
      .attr('fill', (d) => color(d.key))
      .selectAll('rect')
      .data((d) => d)
      .join('rect')
      .attr('x', (d) => xScale(d.data.label))
      .attr('y', (d) => yScale(d[1]))
      .attr('width', xScale.bandwidth())
      .attr('height', (d) => yScale(d[0]) - yScale(d[1]))
      .attr('rx', 5);

    chart.append('g')
      .selectAll('text')
      .data(seriesData)
      .join('text')
      .attr('x', (d) => (xScale(d.label) || 0) + (xScale.bandwidth() / 2))
      .attr('y', (d) => yScale(d.total) - 8)
      .attr('fill', '#cbd5e1')
      .attr('font-size', 11)
      .attr('text-anchor', 'middle')
      .text((d) => formatInteger(d.total));

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .attr('transform', 'rotate(-24)')
      .style('text-anchor', 'end');

    chart.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickFormat((value) => formatInteger(value)));

    appendLegend(container, statusKeys.map((key) => ({
      label: STATUS_LABELS[key] || key,
      color: color(key),
    })));
  };

  const renderRouteLatencyChart = () => {
    const container = document.getElementById('routeLatencyChart');
    if (!container) {
      return;
    }

    const data = routeOverview
      .filter((entry) => entry && entry.avgDurationSec !== null && entry.avgDurationSec !== undefined)
      .slice()
      .sort((a, b) => (b.avgDurationSec || 0) - (a.avgDurationSec || 0));

    if (!data.length) {
      showEmpty(container, 'No recent duration logs yet.');
      return;
    }

    const width = container.clientWidth || 680;
    const height = Math.max(280, data.length * 54 + 56);
    const margin = { top: 18, right: 86, bottom: 44, left: 156 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxValue = d3.max(data, (d) => Math.max(d.avgDurationSec || 0, d.p95DurationSec || 0, d.avgQueueSec || 0)) || 1;

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const yScale = d3.scaleBand()
      .domain(data.map((d) => d.label || d.route))
      .range([0, innerHeight])
      .padding(0.32);

    const xScale = d3.scaleLinear()
      .domain([0, maxValue * 1.12])
      .nice()
      .range([0, innerWidth]);

    drawVerticalGrid(chart, xScale, innerHeight);

    chart.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', (d) => yScale(d.label || d.route))
      .attr('width', (d) => xScale(d.avgDurationSec || 0))
      .attr('height', yScale.bandwidth())
      .attr('rx', 7)
      .attr('fill', '#38bdf8');

    chart.selectAll('line.p95')
      .data(data)
      .join('line')
      .attr('class', 'p95')
      .attr('x1', (d) => xScale(d.p95DurationSec || d.avgDurationSec || 0))
      .attr('x2', (d) => xScale(d.p95DurationSec || d.avgDurationSec || 0))
      .attr('y1', (d) => (yScale(d.label || d.route) || 0) - 2)
      .attr('y2', (d) => (yScale(d.label || d.route) || 0) + yScale.bandwidth() + 2)
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 3);

    chart.selectAll('circle.queue')
      .data(data.filter((d) => (d.avgQueueSec || 0) > 0))
      .join('circle')
      .attr('class', 'queue')
      .attr('cx', (d) => xScale(d.avgQueueSec || 0))
      .attr('cy', (d) => (yScale(d.label || d.route) || 0) + yScale.bandwidth() / 2)
      .attr('r', 4.5)
      .attr('fill', '#f87171');

    chart.selectAll('text.value')
      .data(data)
      .join('text')
      .attr('class', 'value')
      .attr('x', (d) => Math.min(innerWidth - 4, xScale(Math.max(d.avgDurationSec || 0, d.p95DurationSec || 0)) + 8))
      .attr('y', (d) => (yScale(d.label || d.route) || 0) + yScale.bandwidth() / 2 + 4)
      .attr('fill', '#cbd5e1')
      .attr('font-size', 11)
      .text((d) => `${formatSeconds(d.avgDurationSec)} avg`);

    chart.append('g').call(d3.axisLeft(yScale));
    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5).tickFormat(axisTickSeconds));

    appendLegend(container, [
      { label: 'Average duration', color: '#38bdf8' },
      { label: 'P95 duration', color: '#f59e0b' },
      { label: 'Average queue wait', color: '#f87171' },
    ]);
  };

  const renderVramPressureChart = () => {
    const container = document.getElementById('vramPressureChart');
    if (!container) {
      return;
    }

    const data = routeOverview
      .filter((entry) => entry && ((entry.avgVramDeltaBytes || 0) > 0 || (entry.maxVramDeltaBytes || 0) > 0))
      .slice()
      .sort((a, b) => (b.maxVramDeltaBytes || 0) - (a.maxVramDeltaBytes || 0));

    if (!data.length) {
      showEmpty(container, 'No VRAM delta logs yet.');
      return;
    }

    const keys = ['avg', 'max'];
    const width = container.clientWidth || 560;
    const height = Math.max(260, data.length * 64 + 36);
    const margin = { top: 18, right: 82, bottom: 44, left: 164 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const yScale = d3.scaleBand()
      .domain(data.map((d) => d.label || d.route))
      .range([0, innerHeight])
      .padding(0.18);
    const seriesScale = d3.scaleBand()
      .domain(keys)
      .range([0, yScale.bandwidth()])
      .padding(0.18);
    const maxValue = d3.max(data, (d) => Math.max((d.avgVramDeltaBytes || 0), (d.maxVramDeltaBytes || 0))) || 1;
    const xScale = d3.scaleLinear()
      .domain([0, maxValue * 1.12])
      .nice()
      .range([0, innerWidth]);
    const colors = {
      avg: '#38bdf8',
      max: '#f59e0b',
    };

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    drawVerticalGrid(chart, xScale, innerHeight);

    keys.forEach((key) => {
      const accessor = key === 'avg' ? 'avgVramDeltaBytes' : 'maxVramDeltaBytes';
      chart.selectAll(`rect.${key}`)
        .data(data)
        .join('rect')
        .attr('class', key)
        .attr('x', 0)
        .attr('y', (d) => (yScale(d.label || d.route) || 0) + (seriesScale(key) || 0))
        .attr('width', (d) => xScale(d[accessor] || 0))
        .attr('height', seriesScale.bandwidth())
        .attr('rx', 6)
        .attr('fill', colors[key]);

      chart.selectAll(`text.${key}`)
        .data(data)
        .join('text')
        .attr('class', key)
        .attr('x', (d) => Math.min(innerWidth - 4, xScale(d[accessor] || 0) + 8))
        .attr('y', (d) => (yScale(d.label || d.route) || 0) + (seriesScale(key) || 0) + seriesScale.bandwidth() / 2 + 4)
        .attr('fill', '#cbd5e1')
        .attr('font-size', 11)
        .text((d) => formatBytesCompact(d[accessor]));
    });

    chart.append('g').call(d3.axisLeft(yScale));
    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5).tickFormat((value) => formatBytesCompact(value)));

    appendLegend(container, [
      { label: 'Average delta', color: colors.avg },
      { label: 'Largest delta', color: colors.max },
    ]);
  };

  const renderGpuTimelineChart = () => {
    const container = document.getElementById('gpuTimelineChart');
    if (!container) {
      return;
    }

    const totalBytes = asNumber(gpu.totalBytes);
    const points = Array.isArray(gpuTimeline.points) ? [...gpuTimeline.points] : [];
    if (gpuTimeline.latest && gpuTimeline.latest.tsMs) {
      const lastPoint = points[points.length - 1];
      if (!lastPoint || lastPoint.tsMs !== gpuTimeline.latest.tsMs) {
        points.push(gpuTimeline.latest);
      }
    }

    const series = points
      .map((point) => ({
        date: point.tsMs ? new Date(point.tsMs) : null,
        busy: asNumber(point.busyPercent),
        vramPercent: totalBytes && asNumber(point.vramUsedBytes) !== null
          ? (asNumber(point.vramUsedBytes) / totalBytes) * 100
          : null,
        tempC: asNumber(point.tempC),
      }))
      .filter((point) => point.date instanceof Date && !Number.isNaN(point.date.getTime()))
      .sort((a, b) => a.date - b.date);

    if (!series.length) {
      showEmpty(container, 'No GPU samples yet.');
      return;
    }

    const width = container.clientWidth || 680;
    const height = Math.max(300, Math.floor(width * 0.46));
    const margin = { top: 18, right: 54, bottom: 52, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const extent = d3.extent(series, (d) => d.date);
    let [minDate, maxDate] = extent;
    if (!minDate || !maxDate || minDate.getTime() === maxDate.getTime()) {
      const center = minDate || new Date();
      minDate = new Date(center.getTime() - 30000);
      maxDate = new Date(center.getTime() + 30000);
    }

    const tempValues = series.map((d) => d.tempC).filter((value) => value !== null && value !== undefined);
    const tempMin = tempValues.length ? Math.max(0, (d3.min(tempValues) || 0) - 5) : 0;
    const tempMax = tempValues.length ? Math.min(100, (d3.max(tempValues) || 0) + 5) : 100;

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleTime()
      .domain([minDate, maxDate])
      .range([0, innerWidth]);
    const yScale = d3.scaleLinear()
      .domain([0, 100])
      .range([innerHeight, 0]);
    const tempScale = d3.scaleLinear()
      .domain([tempMin, tempMax])
      .range([innerHeight, 0]);

    drawHorizontalGrid(chart, yScale, innerWidth);

    const vramArea = d3.area()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y0(innerHeight)
      .y1((d) => yScale(d.vramPercent || 0));

    const vramLine = d3.line()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.vramPercent || 0));

    const busyLine = d3.line()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.busy || 0));

    const tempLine = d3.line()
      .defined((d) => d.tempC !== null && d.tempC !== undefined)
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => tempScale(d.tempC));

    chart.append('path')
      .datum(series)
      .attr('fill', 'rgba(56, 189, 248, 0.12)')
      .attr('stroke', 'none')
      .attr('d', vramArea);

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#38bdf8')
      .attr('stroke-width', 2.4)
      .attr('d', vramLine);

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#22c55e')
      .attr('stroke-width', 2.4)
      .attr('d', busyLine);

    if (tempValues.length) {
      chart.append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', '#fb923c')
        .attr('stroke-width', 2.1)
        .attr('d', tempLine);
    }

    const latestPoint = series[series.length - 1];
    [
      { value: latestPoint.vramPercent, color: '#38bdf8', y: yScale },
      { value: latestPoint.busy, color: '#22c55e', y: yScale },
      ...(tempValues.length ? [{ value: latestPoint.tempC, color: '#fb923c', y: tempScale }] : []),
    ].forEach((entry) => {
      if (entry.value === null || entry.value === undefined) return;
      chart.append('circle')
        .attr('cx', xScale(latestPoint.date))
        .attr('cy', entry.y(entry.value))
        .attr('r', 4.5)
        .attr('fill', entry.color)
        .attr('stroke', '#0f172a')
        .attr('stroke-width', 1.5);
    });

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%H:%M:%S')))
      .selectAll('text')
      .attr('transform', 'rotate(-18)')
      .style('text-anchor', 'end');

    chart.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickFormat((value) => `${Math.round(value)}%`));

    if (tempValues.length) {
      chart.append('g')
        .attr('transform', `translate(${innerWidth},0)`)
        .call(d3.axisRight(tempScale).ticks(4).tickFormat((value) => `${Math.round(value)}C`));
    }

    const latestTemp = asNumber(latestPoint.tempC);
    appendLegend(container, [
      { label: `GPU busy (${formatPercentValue(latestPoint.busy)})`, color: '#22c55e' },
      { label: `VRAM used (${formatPercentValue(latestPoint.vramPercent)})`, color: '#38bdf8' },
      ...(latestTemp !== null ? [{ label: `Temp (${latestTemp.toFixed(1)} C)`, color: '#fb923c' }] : []),
    ]);
  };

  const renderLlmThroughputChart = () => {
    const container = document.getElementById('llmThroughputChart');
    if (!container) {
      return;
    }

    const data = llmThroughput
      .filter((entry) => entry && ((entry.avgPromptTokPerSec || 0) > 0 || (entry.avgGenTokPerSec || 0) > 0))
      .slice()
      .sort((a, b) => (b.avgGenTokPerSec || 0) - (a.avgGenTokPerSec || 0));

    if (!data.length) {
      showEmpty(container, 'No LLM throughput logs yet.');
      return;
    }

    const values = data.flatMap((entry) => [entry.avgPromptTokPerSec, entry.avgGenTokPerSec])
      .filter((value) => value !== null && value !== undefined && value > 0);
    const minValue = d3.min(values) || 1;
    const maxValue = d3.max(values) || 10;
    const width = container.clientWidth || 560;
    const height = Math.max(250, data.length * 52 + 48);
    const margin = { top: 18, right: 84, bottom: 44, left: 168 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const yScale = d3.scaleBand()
      .domain(data.map((d) => d.label || d.model))
      .range([0, innerHeight])
      .padding(0.34);
    const xScale = d3.scaleLog()
      .domain([Math.max(1, minValue * 0.8), maxValue * 1.2])
      .range([0, innerWidth]);
    const tickValues = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]
      .filter((value) => value >= xScale.domain()[0] && value <= xScale.domain()[1]);
    const resolvedTickValues = tickValues.length ? tickValues : xScale.ticks(6);

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    drawVerticalGrid(chart, xScale, innerHeight, resolvedTickValues);

    chart.selectAll('line.range')
      .data(data)
      .join('line')
      .attr('class', 'range')
      .attr('x1', (d) => xScale(Math.min(d.avgPromptTokPerSec || d.avgGenTokPerSec || minValue, d.avgGenTokPerSec || d.avgPromptTokPerSec || minValue)))
      .attr('x2', (d) => xScale(Math.max(d.avgPromptTokPerSec || d.avgGenTokPerSec || minValue, d.avgGenTokPerSec || d.avgPromptTokPerSec || minValue)))
      .attr('y1', (d) => (yScale(d.label || d.model) || 0) + yScale.bandwidth() / 2)
      .attr('y2', (d) => (yScale(d.label || d.model) || 0) + yScale.bandwidth() / 2)
      .attr('stroke', 'rgba(148, 163, 184, 0.45)')
      .attr('stroke-width', 2);

    chart.selectAll('circle.prompt')
      .data(data.filter((d) => (d.avgPromptTokPerSec || 0) > 0))
      .join('circle')
      .attr('class', 'prompt')
      .attr('cx', (d) => xScale(d.avgPromptTokPerSec))
      .attr('cy', (d) => (yScale(d.label || d.model) || 0) + yScale.bandwidth() / 2)
      .attr('r', 5.5)
      .attr('fill', '#f59e0b');

    chart.selectAll('circle.gen')
      .data(data.filter((d) => (d.avgGenTokPerSec || 0) > 0))
      .join('circle')
      .attr('class', 'gen')
      .attr('cx', (d) => xScale(d.avgGenTokPerSec))
      .attr('cy', (d) => (yScale(d.label || d.model) || 0) + yScale.bandwidth() / 2)
      .attr('r', 5.5)
      .attr('fill', '#38bdf8');

    chart.selectAll('text.meta')
      .data(data)
      .join('text')
      .attr('class', 'meta')
      .attr('x', innerWidth + 8)
      .attr('y', (d) => (yScale(d.label || d.model) || 0) + yScale.bandwidth() / 2 + 4)
      .attr('fill', '#cbd5e1')
      .attr('font-size', 11)
      .text((d) => `n=${formatInteger(d.count)}`);

    chart.append('g').call(d3.axisLeft(yScale));
    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickValues(resolvedTickValues).tickFormat((value) => {
        if (value >= 1000) return `${Math.round(value / 1000)}k`;
        return String(value);
      }));

    appendLegend(container, [
      { label: 'Generation tok/s', color: '#38bdf8' },
      { label: 'Prompt tok/s', color: '#f59e0b' },
    ]);
  };

  const renderOcrTimingChart = () => {
    const container = document.getElementById('ocrTimingChart');
    if (!container) {
      return;
    }

    const data = ocrTimings
      .filter((entry) => entry && ((entry.average || 0) > 0 || (entry.p95 || 0) > 0))
      .slice();

    if (!data.length) {
      showEmpty(container, 'No OCR timing summaries yet.');
      return;
    }

    const values = data.flatMap((entry) => [entry.average, entry.p95]).filter((value) => value !== null && value !== undefined && value > 0);
    const minValue = d3.min(values) || 0.001;
    const maxValue = d3.max(values) || 1;
    const width = container.clientWidth || 560;
    const height = Math.max(250, data.length * 48 + 48);
    const margin = { top: 18, right: 70, bottom: 44, left: 160 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const yScale = d3.scaleBand()
      .domain(data.map((d) => d.label || d.stage))
      .range([0, innerHeight])
      .padding(0.34);
    const xScale = d3.scaleLog()
      .domain([minValue * 0.8, maxValue * 1.2])
      .range([0, innerWidth]);
    const tickValues = [0.001, 0.01, 0.1, 1, 10, 100]
      .filter((value) => value >= xScale.domain()[0] && value <= xScale.domain()[1]);
    const resolvedTickValues = tickValues.length ? tickValues : xScale.ticks(6);

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    drawVerticalGrid(chart, xScale, innerHeight, resolvedTickValues);

    chart.selectAll('line.range')
      .data(data)
      .join('line')
      .attr('class', 'range')
      .attr('x1', (d) => xScale(Math.min(d.average || minValue, d.p95 || minValue)))
      .attr('x2', (d) => xScale(Math.max(d.average || minValue, d.p95 || minValue)))
      .attr('y1', (d) => (yScale(d.label || d.stage) || 0) + yScale.bandwidth() / 2)
      .attr('y2', (d) => (yScale(d.label || d.stage) || 0) + yScale.bandwidth() / 2)
      .attr('stroke', 'rgba(148, 163, 184, 0.45)')
      .attr('stroke-width', 2);

    chart.selectAll('circle.avg')
      .data(data.filter((d) => (d.average || 0) > 0))
      .join('circle')
      .attr('class', 'avg')
      .attr('cx', (d) => xScale(d.average))
      .attr('cy', (d) => (yScale(d.label || d.stage) || 0) + yScale.bandwidth() / 2)
      .attr('r', 5.5)
      .attr('fill', '#38bdf8');

    chart.selectAll('circle.p95')
      .data(data.filter((d) => (d.p95 || 0) > 0))
      .join('circle')
      .attr('class', 'p95')
      .attr('cx', (d) => xScale(d.p95))
      .attr('cy', (d) => (yScale(d.label || d.stage) || 0) + yScale.bandwidth() / 2)
      .attr('r', 5.5)
      .attr('fill', '#f59e0b');

    chart.append('g').call(d3.axisLeft(yScale));
    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickValues(resolvedTickValues).tickFormat(axisTickSeconds));

    appendLegend(container, [
      { label: 'Average stage time', color: '#38bdf8' },
      { label: 'P95 stage time', color: '#f59e0b' },
    ]);
  };

  const renderTtsRtfChart = () => {
    const container = document.getElementById('ttsRtfChart');
    if (!container) {
      return;
    }

    const data = ttsBackends
      .filter((entry) => entry && ((entry.averageRtf || 0) > 0 || (entry.p95Rtf || 0) > 0))
      .slice()
      .sort((a, b) => (b.averageRtf || 0) - (a.averageRtf || 0));

    if (!data.length) {
      showEmpty(container, 'No TTS backend logs yet.');
      return;
    }

    const width = container.clientWidth || 560;
    const height = Math.max(230, data.length * 52 + 48);
    const margin = { top: 18, right: 74, bottom: 42, left: 144 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxValue = d3.max(data, (d) => Math.max(d.averageRtf || 0, d.p95Rtf || 0)) || 1;
    const yScale = d3.scaleBand()
      .domain(data.map((d) => d.label || d.backend))
      .range([0, innerHeight])
      .padding(0.34);
    const xScale = d3.scaleLinear()
      .domain([0, maxValue * 1.15])
      .nice()
      .range([0, innerWidth]);

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    drawVerticalGrid(chart, xScale, innerHeight);

    chart.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', 0)
      .attr('y', (d) => yScale(d.label || d.backend))
      .attr('width', (d) => xScale(d.averageRtf || 0))
      .attr('height', yScale.bandwidth())
      .attr('rx', 7)
      .attr('fill', '#38bdf8');

    chart.selectAll('line.p95')
      .data(data)
      .join('line')
      .attr('class', 'p95')
      .attr('x1', (d) => xScale(d.p95Rtf || d.averageRtf || 0))
      .attr('x2', (d) => xScale(d.p95Rtf || d.averageRtf || 0))
      .attr('y1', (d) => (yScale(d.label || d.backend) || 0) - 2)
      .attr('y2', (d) => (yScale(d.label || d.backend) || 0) + yScale.bandwidth() + 2)
      .attr('stroke', '#f59e0b')
      .attr('stroke-width', 3);

    chart.selectAll('text')
      .data(data)
      .join('text')
      .attr('x', (d) => Math.min(innerWidth - 4, xScale(Math.max(d.averageRtf || 0, d.p95Rtf || 0)) + 8))
      .attr('y', (d) => (yScale(d.label || d.backend) || 0) + yScale.bandwidth() / 2 + 4)
      .attr('fill', '#cbd5e1')
      .attr('font-size', 11)
      .text((d) => `${(d.averageRtf || 0).toFixed(3)} avg`);

    chart.append('g').call(d3.axisLeft(yScale));
    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5).tickFormat((value) => value.toFixed(2)));

    appendLegend(container, [
      { label: 'Average RTF', color: '#38bdf8' },
      { label: 'P95 RTF', color: '#f59e0b' },
    ]);
  };

  const initAutoStopControls = () => {
    const toggle = document.getElementById('autoStopToggle');
    if (!toggle) {
      return;
    }

    const statusEl = document.getElementById('autoStopStatus');
    const timeoutEl = document.getElementById('autoStopTimeout');
    const dockerEl = document.getElementById('autoStopDocker');
    const containerEl = document.getElementById('autoStopContainer');
    const feedbackEl = document.getElementById('autoStopFeedback');

    const setFeedback = (message, isError) => {
      if (!feedbackEl) return;
      feedbackEl.textContent = message || '';
      feedbackEl.classList.toggle('auto-stop__feedback--error', Boolean(isError));
    };

    const updateAutoStopUI = (state) => {
      if (!state) return;
      const enabled = state.enabled === true;
      if (statusEl) {
        statusEl.textContent = state.enabledDisplay || (enabled ? 'Enabled' : 'Disabled');
        statusEl.classList.toggle('auto-stop__badge--on', enabled);
        statusEl.classList.toggle('auto-stop__badge--off', !enabled);
      }
      if (timeoutEl) {
        timeoutEl.textContent = state.idleTimeoutDisplay || (
          Number.isFinite(state.idleTimeoutSec) ? `${state.idleTimeoutSec}s` : 'N/A'
        );
      }
      if (dockerEl) {
        dockerEl.textContent = state.dockerAvailableDisplay || (
          state.dockerAvailable === true
            ? 'Available'
            : (state.dockerAvailable === false ? 'Unavailable' : 'Unknown')
        );
      }
      if (containerEl) {
        containerEl.textContent = state.containerStateDisplay || state.containerState || 'Unknown';
      }
      toggle.checked = enabled;
    };

    updateAutoStopUI(autoStop);

    toggle.addEventListener('change', async () => {
      const enabled = toggle.checked;
      toggle.disabled = true;
      setFeedback('Saving...', false);

      try {
        const response = await fetch('/admin/ai-gateway/auto-stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Request failed (${response.status})`);
        }
        updateAutoStopUI(data.autoStop || { enabled });
        setFeedback('Saved.', false);
        window.setTimeout(() => setFeedback('', false), 2000);
      } catch (error) {
        toggle.checked = !enabled;
        setFeedback(error.message || 'Update failed.', true);
      } finally {
        toggle.disabled = false;
      }
    });
  };

  const initMonitorControls = () => {
    const form = document.getElementById('monitorForm');
    if (!form) {
      return;
    }

    const select = document.getElementById('monitorFolderSelect');
    const input = document.getElementById('monitorFolderInput');
    const applyButton = document.getElementById('monitorApply');
    const stopButton = document.getElementById('monitorStop');
    const feedbackEl = document.getElementById('monitorFeedback');
    const currentEl = document.getElementById('monitorCurrent');
    const statusEl = document.getElementById('monitorStatus');
    const updatedEl = document.getElementById('monitorUpdated');

    const setFeedback = (message, isError) => {
      if (!feedbackEl) return;
      feedbackEl.textContent = message || '';
      feedbackEl.classList.toggle('monitor-controls__feedback--error', Boolean(isError));
    };

    const setButtonsDisabled = (disabled) => {
      if (applyButton) applyButton.disabled = disabled;
      if (stopButton) stopButton.disabled = disabled;
    };

    const formatEpoch = (value) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      const ms = num > 1e11 ? num : num * 1000;
      return new Date(ms).toLocaleString();
    };

    const updateMonitorUI = (monitor, fallbackSelection) => {
      const selection = monitor?.selected || fallbackSelection || 'None';
      if (currentEl) {
        currentEl.textContent = selection || 'None';
      }
      if (statusEl) {
        statusEl.textContent = monitor ? (monitor.monitoring ? 'Active' : 'Stopped') : 'Unknown';
      }
      let timeDisplay = monitor?.lastStatus?.timeDisplay;
      if (!timeDisplay) {
        const rawTime = monitor?.lastStatus?.time ?? monitor?.last_status?.time;
        timeDisplay = rawTime ? formatEpoch(rawTime) : null;
      }
      if (updatedEl) {
        updatedEl.textContent = timeDisplay || '—';
      }
    };

    const resolveFolder = () => {
      const inputValue = input ? input.value.trim() : '';
      if (inputValue) return inputValue;
      const selectValue = select ? select.value.trim() : '';
      return selectValue || null;
    };

    if (select && input) {
      select.addEventListener('change', () => {
        if (select.value) {
          input.value = '';
        }
      });
      input.addEventListener('input', () => {
        if (input.value.trim()) {
          select.value = '';
        }
      });
    }

    const submitMonitorUpdate = async (folder) => {
      setButtonsDisabled(true);
      setFeedback('Saving...', false);

      try {
        const response = await fetch('/admin/ai-gateway/monitor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Request failed (${response.status})`);
        }
        updateMonitorUI(data.monitor, folder);
        setFeedback(folder ? `Monitoring ${folder}.` : 'Monitoring stopped.', false);
        window.setTimeout(() => setFeedback('', false), 2000);
      } catch (error) {
        setFeedback(error.message || 'Update failed.', true);
      } finally {
        setButtonsDisabled(false);
      }
    };

    if (applyButton) {
      applyButton.addEventListener('click', (event) => {
        event.preventDefault();
        const folder = resolveFolder();
        if (!folder) {
          setFeedback('Select or enter a folder first.', true);
          return;
        }
        submitMonitorUpdate(folder);
      });
    }

    if (stopButton) {
      stopButton.addEventListener('click', (event) => {
        event.preventDefault();
        submitMonitorUpdate(null);
      });
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const folder = resolveFolder();
      if (!folder) {
        setFeedback('Select or enter a folder first.', true);
        return;
      }
      submitMonitorUpdate(folder);
    });
  };

  const safeRender = (fn, label) => () => {
    try {
      fn();
    } catch (error) {
      console.error(`Failed to render ${label}.`, error);
    }
  };

  const safeRequestChart = safeRender(renderRequestVolumeChart, 'request volume chart');
  safeRequestChart();
  resizeCallbacks.push(safeRequestChart);

  const safeLatencyChart = safeRender(renderRouteLatencyChart, 'route latency chart');
  safeLatencyChart();
  resizeCallbacks.push(safeLatencyChart);

  const safeGpuChart = safeRender(renderGpuTimelineChart, 'GPU timeline chart');
  safeGpuChart();
  resizeCallbacks.push(safeGpuChart);

  const safeVramChart = safeRender(renderVramPressureChart, 'VRAM pressure chart');
  safeVramChart();
  resizeCallbacks.push(safeVramChart);

  const safeLlmChart = safeRender(renderLlmThroughputChart, 'LLM throughput chart');
  safeLlmChart();
  resizeCallbacks.push(safeLlmChart);

  const safeOcrChart = safeRender(renderOcrTimingChart, 'OCR timing chart');
  safeOcrChart();
  resizeCallbacks.push(safeOcrChart);

  const safeTtsChart = safeRender(renderTtsRtfChart, 'TTS RTF chart');
  safeTtsChart();
  resizeCallbacks.push(safeTtsChart);

  initAutoStopControls();
  initMonitorControls();
})();
