(function () {
  const dataElement = document.getElementById('tapoDashboardData');
  if (!dataElement || typeof d3 === 'undefined') {
    return;
  }

  let payload = {};
  try {
    payload = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    console.error('Failed to parse Tapo dashboard payload.', error);
    return;
  }

  const palette = [
    '#ff6a1f',
    '#3da0ff',
    '#36c275',
    '#ffc247',
    '#d76dff',
    '#26d9d0',
    '#ff5c8a',
    '#a3e635',
  ];
  const color = d3.scaleOrdinal(palette);
  const parseDay = d3.timeParse('%Y-%m-%d');
  const parseMonth = d3.timeParse('%Y-%m');
  const formatTime = d3.timeFormat('%m/%d %H:%M');
  const formatDay = d3.timeFormat('%m/%d');
  const formatMonth = d3.timeFormat('%Y-%m');
  const formatDateTime = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const numberFormat = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  });

  const resizeCallbacks = [];
  let resizeFrame = null;

  function scheduleResize() {
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = requestAnimationFrame(() => {
      resizeCallbacks.forEach((callback) => callback());
    });
  }

  window.addEventListener('resize', scheduleResize);

  function emptyChart(container, message) {
    container.innerHTML = `<div class="tapo-chart-empty">${message}</div>`;
  }

  function createTooltip(container) {
    const tooltip = document.createElement('div');
    tooltip.className = 'tapo-chart-tooltip';
    container.appendChild(tooltip);
    return tooltip;
  }

  function showTooltip(tooltip, event, html) {
    tooltip.innerHTML = html;
    tooltip.style.opacity = '1';
    const rect = event.currentTarget.ownerSVGElement
      ? event.currentTarget.ownerSVGElement.getBoundingClientRect()
      : event.currentTarget.getBoundingClientRect();
    tooltip.style.transform = `translate(${event.clientX - rect.left + 12}px, ${event.clientY - rect.top + 12}px)`;
  }

  function hideTooltip(tooltip) {
    tooltip.style.opacity = '0';
    tooltip.style.transform = 'translate(-9999px, -9999px)';
  }

  function renderLegend(container, devices) {
    const legend = document.createElement('div');
    legend.className = 'tapo-chart-legend';
    devices.forEach((device) => {
      const item = document.createElement('span');
      item.className = 'tapo-chart-legend__item';
      const swatch = document.createElement('span');
      swatch.className = 'tapo-chart-legend__swatch';
      swatch.style.backgroundColor = color(device);
      const label = document.createElement('span');
      label.textContent = device;
      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  function getChartSize(container, minHeight) {
    const width = Math.max(320, container.clientWidth || container.parentElement?.clientWidth || 720);
    const height = Math.max(minHeight, Math.floor(width * 0.42));
    return { width, height };
  }

  function padDateDomain(domain, padMs) {
    if (!domain[0] || !domain[1]) {
      return [new Date(Date.now() - padMs), new Date(Date.now() + padMs)];
    }
    if (domain[0].getTime() === domain[1].getTime()) {
      return [
        new Date(domain[0].getTime() - padMs),
        new Date(domain[1].getTime() + padMs),
      ];
    }
    return domain;
  }

  function renderMultiLineChart(containerId, sourceSeries, options) {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }

    const series = sourceSeries
      .map((entry) => ({
        deviceName: entry.deviceName,
        x: options.parseX(entry),
        y: Number(entry[options.yKey]),
        label: options.labelX(entry),
      }))
      .filter((entry) => entry.deviceName && entry.x instanceof Date && !Number.isNaN(entry.x.getTime()) && Number.isFinite(entry.y))
      .sort((a, b) => a.x - b.x);

    if (!series.length) {
      emptyChart(container, options.emptyMessage);
      return;
    }

    container.innerHTML = '';
    const tooltip = createTooltip(container);
    const { width, height } = getChartSize(container, options.minHeight || 300);
    const margin = {
      top: 24,
      right: Math.max(24, Math.min(92, width * 0.08)),
      bottom: width < 560 ? 64 : 48,
      left: 68,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const devices = Array.from(new Set(series.map((entry) => entry.deviceName))).sort();
    const grouped = d3.group(series, (entry) => entry.deviceName);
    const xScale = d3.scaleTime()
      .domain(padDateDomain(d3.extent(series, (entry) => entry.x), options.domainPadMs || MS_PER_HOUR))
      .range([0, innerWidth]);
    const maxY = d3.max(series, (entry) => entry.y) || 0;
    const yScale = d3.scaleLinear()
      .domain([0, maxY <= 0 ? 1 : maxY * 1.12])
      .nice()
      .range([innerHeight, 0]);

    chart.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yScale.ticks(6))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (tick) => yScale(tick))
      .attr('y2', (tick) => yScale(tick));

    const line = d3.line()
      .curve(d3.curveMonotoneX)
      .x((entry) => xScale(entry.x))
      .y((entry) => yScale(entry.y));

    grouped.forEach((values, deviceName) => {
      chart.append('path')
        .datum(values)
        .attr('fill', 'none')
        .attr('stroke', color(deviceName))
        .attr('stroke-width', 2)
        .attr('d', line);
    });

    chart.selectAll('.tapo-point')
      .data(series)
      .join('circle')
      .attr('class', 'tapo-point')
      .attr('cx', (entry) => xScale(entry.x))
      .attr('cy', (entry) => yScale(entry.y))
      .attr('r', 3)
      .attr('fill', (entry) => color(entry.deviceName))
      .attr('stroke', '#0e0f13')
      .attr('stroke-width', 1)
      .on('mouseenter', (event, entry) => {
        showTooltip(
          tooltip,
          event,
          `<strong>${entry.deviceName}</strong><br>${entry.label}<br>${numberFormat.format(entry.y)} ${options.unit}`
        );
      })
      .on('mousemove', (event, entry) => {
        showTooltip(
          tooltip,
          event,
          `<strong>${entry.deviceName}</strong><br>${entry.label}<br>${numberFormat.format(entry.y)} ${options.unit}`
        );
      })
      .on('mouseleave', () => hideTooltip(tooltip));

    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.min(width < 560 ? 4 : 8, series.length))
      .tickFormat(options.formatX);
    const yAxis = d3.axisLeft(yScale)
      .ticks(6)
      .tickFormat((value) => `${numberFormat.format(value)} ${options.unit}`);

    const xAxisGroup = chart.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);

    if (width < 760) {
      xAxisGroup.selectAll('text')
        .attr('transform', 'rotate(-30)')
        .style('text-anchor', 'end');
    }

    chart.append('g')
      .attr('class', 'axis')
      .call(yAxis);

    renderLegend(container, devices);
  }

  function renderMonthlyStackedBars() {
    const container = document.getElementById('tapoMonthlyChart');
    if (!container) {
      return;
    }

    const series = Array.isArray(payload.monthlySeries) ? payload.monthlySeries : [];
    const rows = series
      .map((entry) => ({
        deviceName: entry.deviceName,
        monthKey: entry.monthKey,
        consumptionKwh: Number(entry.consumptionKwh),
      }))
      .filter((entry) => entry.deviceName && entry.monthKey && Number.isFinite(entry.consumptionKwh));

    if (!rows.length) {
      emptyChart(container, 'No monthly snapshot data yet.');
      return;
    }

    container.innerHTML = '';
    const tooltip = createTooltip(container);
    const { width, height } = getChartSize(container, 320);
    const margin = {
      top: 24,
      right: 28,
      bottom: width < 560 ? 70 : 52,
      left: 72,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const devices = Array.from(new Set(rows.map((entry) => entry.deviceName))).sort();
    const months = Array.from(new Set(rows.map((entry) => entry.monthKey))).sort();
    const monthRows = months.map((monthKey) => {
      const monthRow = { monthKey };
      devices.forEach((deviceName) => {
        monthRow[deviceName] = 0;
      });
      rows
        .filter((entry) => entry.monthKey === monthKey)
        .forEach((entry) => {
          monthRow[entry.deviceName] = entry.consumptionKwh;
        });
      return monthRow;
    });

    const stack = d3.stack().keys(devices)(monthRows);
    const totals = monthRows.map((row) => devices.reduce((sum, deviceName) => sum + row[deviceName], 0));
    const xScale = d3.scaleBand()
      .domain(months)
      .range([0, innerWidth])
      .padding(0.2);
    const yScale = d3.scaleLinear()
      .domain([0, (d3.max(totals) || 0) * 1.12 || 1])
      .nice()
      .range([innerHeight, 0]);

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    chart.append('g')
      .attr('class', 'grid')
      .selectAll('line')
      .data(yScale.ticks(6))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (tick) => yScale(tick))
      .attr('y2', (tick) => yScale(tick));

    chart.selectAll('g.stack')
      .data(stack)
      .join('g')
      .attr('class', 'stack')
      .attr('fill', (layer) => color(layer.key))
      .selectAll('rect')
      .data((layer) => layer.map((segment) => ({ ...segment, deviceName: layer.key })))
      .join('rect')
      .attr('x', (segment) => xScale(segment.data.monthKey))
      .attr('y', (segment) => yScale(segment[1]))
      .attr('height', (segment) => Math.max(0, yScale(segment[0]) - yScale(segment[1])))
      .attr('width', xScale.bandwidth())
      .on('mouseenter', (event, segment) => {
        const value = segment[1] - segment[0];
        showTooltip(
          tooltip,
          event,
          `<strong>${segment.deviceName}</strong><br>${segment.data.monthKey}<br>${numberFormat.format(value)} kWh`
        );
      })
      .on('mousemove', (event, segment) => {
        const value = segment[1] - segment[0];
        showTooltip(
          tooltip,
          event,
          `<strong>${segment.deviceName}</strong><br>${segment.data.monthKey}<br>${numberFormat.format(value)} kWh`
        );
      })
      .on('mouseleave', () => hideTooltip(tooltip));

    const xAxis = chart.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickFormat((value) => {
        const date = parseMonth(value);
        return date ? formatMonth(date) : value;
      }));

    if (width < 760 || months.length > 10) {
      xAxis.selectAll('text')
        .attr('transform', 'rotate(-30)')
        .style('text-anchor', 'end');
    }

    chart.append('g')
      .attr('class', 'axis')
      .call(d3.axisLeft(yScale).ticks(6).tickFormat((value) => `${numberFormat.format(value)} kWh`));

    renderLegend(container, devices);
  }

  const MS_PER_HOUR = 60 * 60 * 1000;
  const MS_PER_DAY = 24 * MS_PER_HOUR;

  function renderAll() {
    renderMultiLineChart('tapoPowerChart', Array.isArray(payload.powerSeries) ? payload.powerSeries : [], {
      yKey: 'currentPowerW',
      unit: 'W',
      minHeight: 320,
      emptyMessage: 'No raw power readings in this range.',
      parseX: (entry) => new Date(entry.timestamp),
      labelX: (entry) => {
        const date = new Date(entry.timestamp);
        return Number.isNaN(date.getTime()) ? entry.timestamp : formatDateTime.format(date);
      },
      formatX: formatTime,
      domainPadMs: MS_PER_HOUR,
    });

    renderMultiLineChart('tapoDailyChart', Array.isArray(payload.dailySeries) ? payload.dailySeries : [], {
      yKey: 'consumptionKwh',
      unit: 'kWh',
      minHeight: 320,
      emptyMessage: 'No daily consumption snapshots yet.',
      parseX: (entry) => parseDay(entry.dateKey),
      labelX: (entry) => entry.dateKey,
      formatX: formatDay,
      domainPadMs: MS_PER_DAY,
    });

    renderMonthlyStackedBars();
  }

  renderAll();
  resizeCallbacks.push(renderAll);
})();
