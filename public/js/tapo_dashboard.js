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
  const DEFAULT_VISIBLE_DEVICE_COUNT = 3;
  const VIEW_MODES = {
    device: { label: 'Device' },
    room: { label: 'Room' },
    usage: { label: 'Usage' },
  };
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
  const fractionalNumberFormat = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
  });
  const smallNumberFormat = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
  });

  seedDeviceColors(payload);

  const resizeCallbacks = [];
  let resizeFrame = null;
  const chartVisibilityState = new Map();
  let activeViewMode = 'device';

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
      label.className = 'tapo-chart-legend__label';
      label.textContent = device;
      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  function getDeviceScores(series) {
    const scores = new Map();
    series.forEach((entry) => {
      const currentScore = scores.get(entry.deviceName);
      if (!Number.isFinite(currentScore) || entry.y > currentScore) {
        scores.set(entry.deviceName, entry.y);
      }
    });
    return scores;
  }

  function rankDevicesByScore(devices, scores) {
    return devices.slice().sort((a, b) => {
      const scoreDiff = (scores.get(b) || 0) - (scores.get(a) || 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.localeCompare(b);
    });
  }

  function getInitialVisibleDevices(visibilityKey, devices, scores) {
    if (chartVisibilityState.has(visibilityKey)) {
      const savedDevices = chartVisibilityState.get(visibilityKey);
      return new Set(devices.filter((device) => savedDevices.has(device)));
    }
    return new Set(rankDevicesByScore(devices, scores).slice(0, DEFAULT_VISIBLE_DEVICE_COUNT));
  }

  function renderDeviceToggleLegend(container, devices, visibleDevices, scores, options, onToggle) {
    const legend = document.createElement('div');
    legend.className = 'tapo-chart-legend tapo-chart-legend--toggles';
    const controls = new Map();

    rankDevicesByScore(devices, scores).forEach((device) => {
      const item = document.createElement('label');
      item.className = 'tapo-chart-legend__toggle';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = visibleDevices.has(device);
      checkbox.addEventListener('change', () => onToggle(device, checkbox.checked));

      const swatch = document.createElement('span');
      swatch.className = 'tapo-chart-legend__swatch';
      swatch.style.backgroundColor = color(device);

      const label = document.createElement('span');
      label.className = 'tapo-chart-legend__label';
      label.textContent = device;

      const score = scores.get(device);
      const value = document.createElement('span');
      value.className = 'tapo-chart-legend__value';
      value.textContent = Number.isFinite(score)
        ? `${formatMetricValue(score, options)} ${options.unit}`
        : '';

      item.appendChild(checkbox);
      item.appendChild(swatch);
      item.appendChild(label);
      item.appendChild(value);
      legend.appendChild(item);
      controls.set(device, { item, checkbox });
    });

    container.appendChild(legend);

    return function updateLegend() {
      controls.forEach(({ item, checkbox }, device) => {
        const isVisible = visibleDevices.has(device);
        checkbox.checked = isVisible;
        item.classList.toggle('is-active', isVisible);
      });
    };
  }

  function parseDeviceNameParts(deviceName) {
    const name = String(deviceName || '').trim();
    const separatorIndex = name.indexOf('-');
    if (separatorIndex > 0 && separatorIndex < name.length - 1) {
      return {
        room: name.slice(0, separatorIndex).trim(),
        usage: name.slice(separatorIndex + 1).trim(),
      };
    }
    return {
      room: name || 'Unknown',
      usage: name || 'Unknown',
    };
  }

  function getSeriesNameForView(deviceName, viewMode) {
    if (viewMode === 'device') {
      return deviceName;
    }

    const parts = parseDeviceNameParts(deviceName);
    if (viewMode === 'room') {
      return `Room ${parts.room}`;
    }
    if (viewMode === 'usage') {
      return `Usage ${parts.usage}`;
    }
    return deviceName;
  }

  function aggregateSeriesByView(sourceSeries, viewMode, options) {
    const safeSeries = Array.isArray(sourceSeries) ? sourceSeries : [];
    if (viewMode === 'device') {
      return safeSeries;
    }

    const aggregated = new Map();
    safeSeries.forEach((entry) => {
      const seriesName = getSeriesNameForView(entry && entry.deviceName, viewMode);
      const xValue = typeof options.getXValue === 'function'
        ? options.getXValue(entry)
        : entry && entry[options.xKey];
      const yValue = Number(entry && entry[options.yKey]);
      if (!seriesName || !xValue || !Number.isFinite(yValue)) {
        return;
      }

      const aggregateKey = `${seriesName}\u0000${xValue}`;
      if (!aggregated.has(aggregateKey)) {
        aggregated.set(aggregateKey, {
          deviceName: seriesName,
          [options.xKey]: xValue,
          [options.yKey]: 0,
          sourceCount: 0,
          ...(typeof options.extraFields === 'function' ? options.extraFields(entry, xValue) : {}),
        });
      }

      const row = aggregated.get(aggregateKey);
      row[options.yKey] += yValue;
      row.sourceCount += 1;
    });

    return Array.from(aggregated.values()).sort((a, b) => {
      const xDiff = String(a[options.xKey]).localeCompare(String(b[options.xKey]));
      if (xDiff !== 0) {
        return xDiff;
      }
      return a.deviceName.localeCompare(b.deviceName);
    });
  }

  function setupViewControls() {
    const controls = Array.from(document.querySelectorAll('[data-tapo-view]'));
    if (!controls.length) {
      return;
    }

    controls.forEach((control) => {
      control.addEventListener('click', () => {
        const viewMode = control.getAttribute('data-tapo-view');
        if (!VIEW_MODES[viewMode] || viewMode === activeViewMode) {
          return;
        }
        activeViewMode = viewMode;
        updateViewControls();
        renderAll();
      });
    });

    updateViewControls();
  }

  function updateViewControls() {
    document.querySelectorAll('[data-tapo-view]').forEach((control) => {
      const isActive = control.getAttribute('data-tapo-view') === activeViewMode;
      control.classList.toggle('is-active', isActive);
      control.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function seedDeviceColors(dashboardPayload) {
    if (!dashboardPayload || typeof dashboardPayload !== 'object') {
      return;
    }
    const seriesNamesByView = {
      device: new Set(),
      room: new Set(),
      usage: new Set(),
    };
    const addDeviceAndGroupLabels = (deviceName) => {
      if (!deviceName) {
        return;
      }
      Object.keys(VIEW_MODES).forEach((viewMode) => {
        seriesNamesByView[viewMode].add(getSeriesNameForView(deviceName, viewMode));
      });
    };
    if (Array.isArray(dashboardPayload.deviceStats)) {
      dashboardPayload.deviceStats.forEach((entry) => {
        addDeviceAndGroupLabels(entry && entry.deviceName);
      });
    }
    ['powerSeries', 'dailySeries', 'monthlySeries'].forEach((key) => {
      if (!Array.isArray(dashboardPayload[key])) {
        return;
      }
      dashboardPayload[key].forEach((entry) => {
        addDeviceAndGroupLabels(entry && entry.deviceName);
      });
    });
    color.domain(Object.keys(VIEW_MODES).flatMap((viewMode) => (
      Array.from(seriesNamesByView[viewMode]).sort()
    )));
  }

  function formatMetricValue(value, options) {
    if (typeof options.formatValue === 'function') {
      return options.formatValue(value);
    }
    const absoluteValue = Math.abs(Number(value));
    if (absoluteValue > 0 && absoluteValue < 0.1) {
      return smallNumberFormat.format(value);
    }
    if (absoluteValue > 0 && absoluteValue < 1) {
      return fractionalNumberFormat.format(value);
    }
    return numberFormat.format(value);
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

  function normalizeLineSeries(sourceSeries, options) {
    if (!Array.isArray(sourceSeries)) {
      return [];
    }
    return sourceSeries
      .map((entry) => ({
        source: entry,
        deviceName: entry && entry.deviceName,
        x: entry ? options.parseX(entry) : null,
        y: Number(entry && entry[options.yKey]),
        label: entry ? options.labelX(entry) : '',
      }))
      .filter((entry) => (
        entry.deviceName
        && entry.x instanceof Date
        && !Number.isNaN(entry.x.getTime())
        && Number.isFinite(entry.y)
      ))
      .sort((a, b) => a.x - b.x);
  }

  function movingAverage(values, windowSize) {
    const size = Math.max(1, Math.floor(windowSize || 1));
    if (size <= 1 || values.length < 3) {
      return values;
    }
    const radius = Math.floor(size / 2);
    return values.map((entry, index) => {
      const start = Math.max(0, index - radius);
      const end = Math.min(values.length, index + radius + 1);
      const average = d3.mean(values.slice(start, end), (value) => value.y);
      return {
        ...entry,
        rawY: entry.y,
        y: Number.isFinite(average) ? average : entry.y,
      };
    });
  }

  function renderMultiLineChart(containerId, sourceSeries, options) {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }

    const series = normalizeLineSeries(sourceSeries, options);

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
      left: options.unit === 'kWh' ? 78 : 68,
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
    const scores = getDeviceScores(series);
    const visibilityKey = `${containerId}:${options.viewMode || 'device'}`;
    const visibleDevices = getInitialVisibleDevices(visibilityKey, devices, scores);
    chartVisibilityState.set(visibilityKey, new Set(visibleDevices));
    const xScale = d3.scaleTime()
      .domain(padDateDomain(d3.extent(series, (entry) => entry.x), options.domainPadMs || MS_PER_HOUR))
      .range([0, innerWidth]);
    const yScale = d3.scaleLinear()
      .range([innerHeight, 0]);

    const gridGroup = chart.append('g')
      .attr('class', 'grid');

    const line = d3.line()
      .curve(d3.curveMonotoneX)
      .x((entry) => xScale(entry.x))
      .y((entry) => yScale(entry.y));
    const smoothingWindow = Math.max(1, Math.floor(options.smoothWindow || 1));
    const drawSmoothed = smoothingWindow > 1;
    const lineGroup = chart.append('g')
      .attr('class', 'tapo-lines');
    const pointGroup = chart.append('g')
      .attr('class', 'tapo-points');
    const noVisibleMessage = chart.append('text')
      .attr('class', 'tapo-chart-no-visible')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight / 2)
      .attr('text-anchor', 'middle')
      .text('No series selected.');

    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.min(width < 560 ? 4 : 8, series.length))
      .tickFormat(options.formatX);
    const yAxis = d3.axisLeft(yScale)
      .ticks(6)
      .tickFormat((value) => `${formatMetricValue(value, options)} ${options.unit}`);

    const xAxisGroup = chart.append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);

    if (width < 760) {
      xAxisGroup.selectAll('text')
        .attr('transform', 'rotate(-30)')
        .style('text-anchor', 'end');
    }

    const yAxisGroup = chart.append('g')
      .attr('class', 'axis')
      .call(yAxis);

    const updateLegend = renderDeviceToggleLegend(
      container,
      devices,
      visibleDevices,
      scores,
      options,
      (device, checked) => {
        if (checked) {
          visibleDevices.add(device);
        } else {
          visibleDevices.delete(device);
        }
        chartVisibilityState.set(visibilityKey, new Set(visibleDevices));
        updateChart();
        updateLegend();
      }
    );

    function visibleLineData() {
      return devices
        .filter((device) => visibleDevices.has(device) && grouped.has(device))
        .map((device) => ({
          deviceName: device,
          values: grouped.get(device).slice().sort((a, b) => a.x - b.x),
        }));
    }

    function pointKey(entry) {
      return `${entry.deviceName}|${entry.x.getTime()}|${entry.y}`;
    }

    function updateChart() {
      hideTooltip(tooltip);
      const visibleSeries = series.filter((entry) => visibleDevices.has(entry.deviceName));
      const maxY = d3.max(visibleSeries, (entry) => entry.y) || 0;
      yScale
        .domain([0, maxY <= 0 ? 1 : maxY * 1.12])
        .nice();

      gridGroup.selectAll('line')
        .data(yScale.ticks(6))
        .join('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', (tick) => yScale(tick))
        .attr('y2', (tick) => yScale(tick));

      yAxisGroup.call(yAxis);

      lineGroup.selectAll('.tapo-line')
        .data(visibleLineData(), (entry) => entry.deviceName)
        .join(
          (enter) => enter.append('path')
            .attr('class', drawSmoothed ? 'tapo-line tapo-line--smooth' : 'tapo-line')
            .attr('fill', 'none')
            .attr('stroke-width', drawSmoothed ? 2.6 : 2),
          (update) => update,
          (exit) => exit.remove()
        )
        .attr('stroke', (entry) => color(entry.deviceName))
        .attr('d', (entry) => {
          const values = drawSmoothed
            ? movingAverage(entry.values, smoothingWindow)
            : entry.values;
          return line(values);
        });

      pointGroup.selectAll('.tapo-point')
        .data(visibleSeries, pointKey)
        .join(
          (enter) => enter.append('circle')
            .attr('class', 'tapo-point tapo-point--raw')
            .attr('r', drawSmoothed ? 2.25 : 3)
            .attr('stroke', '#0e0f13')
            .attr('stroke-width', 1)
            .on('mouseenter', (event, entry) => {
              showTooltip(
                tooltip,
                event,
                `<strong>${entry.deviceName}</strong><br>${entry.label}<br>${formatMetricValue(entry.y, options)} ${options.unit}`
              );
            })
            .on('mousemove', (event, entry) => {
              showTooltip(
                tooltip,
                event,
                `<strong>${entry.deviceName}</strong><br>${entry.label}<br>${formatMetricValue(entry.y, options)} ${options.unit}`
              );
            })
            .on('mouseleave', () => hideTooltip(tooltip)),
          (update) => update,
          (exit) => exit.remove()
        )
        .attr('cx', (entry) => xScale(entry.x))
        .attr('cy', (entry) => yScale(entry.y))
        .attr('fill', (entry) => color(entry.deviceName));

      noVisibleMessage.style('display', visibleSeries.length ? 'none' : 'block');
    }

    updateChart();
    updateLegend();
  }

  function renderMonthlyStackedBars(sourceSeries) {
    const container = document.getElementById('tapoMonthlyChart');
    if (!container) {
      return;
    }

    const series = Array.isArray(sourceSeries) ? sourceSeries : [];
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
    const powerSeries = aggregateSeriesByView(payload.powerSeries, activeViewMode, {
      yKey: 'currentPowerW',
      xKey: 'timestamp',
      getXValue: (entry) => entry && (entry.bucketStart || entry.timestamp),
      extraFields: (entry, xValue) => ({ bucketStart: xValue }),
    });
    const powerOptions = {
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
      smoothWindow: 21,
      viewMode: activeViewMode,
    };
    renderMultiLineChart('tapoPowerChart', powerSeries, powerOptions);

    const dailySeries = aggregateSeriesByView(payload.dailySeries, activeViewMode, {
      yKey: 'consumptionKwh',
      xKey: 'dateKey',
      getXValue: (entry) => entry && entry.dateKey,
    });
    const dailyOptions = {
      yKey: 'consumptionKwh',
      unit: 'kWh',
      minHeight: 320,
      emptyMessage: 'No daily consumption snapshots yet.',
      parseX: (entry) => parseDay(entry.dateKey),
      labelX: (entry) => entry.dateKey,
      formatX: formatDay,
      domainPadMs: MS_PER_DAY,
      smoothWindow: 3,
      viewMode: activeViewMode,
    };
    renderMultiLineChart('tapoDailyChart', dailySeries, dailyOptions);

    const monthlySeries = aggregateSeriesByView(payload.monthlySeries, activeViewMode, {
      yKey: 'consumptionKwh',
      xKey: 'monthKey',
      getXValue: (entry) => entry && entry.monthKey,
    });
    renderMonthlyStackedBars(monthlySeries);
  }

  setupViewControls();
  renderAll();
  resizeCallbacks.push(renderAll);
})();
