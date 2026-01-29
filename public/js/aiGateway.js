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
  const requests = Array.isArray(chartData.requests) ? chartData.requests : [];
  const durations = Array.isArray(chartData.durations) ? chartData.durations : [];
  const gpuTimeline = chartData.gpuTimeline || {};
  const gpu = payload.gpu || {};
  const autoStop = payload.autoStop || null;

  const asNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
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

    const routes = requests.filter((r) => r && r.route);
    if (!routes.length) {
      showEmpty(container, 'No request data yet.');
      return;
    }

    const statuses = Array.from(new Set(routes.flatMap((route) => Object.keys(route.statuses || {})))).sort();
    if (!statuses.length) {
      showEmpty(container, 'No status codes to visualize.');
      return;
    }

    const seriesData = routes.map((route) => {
      const entry = { route: route.route };
      statuses.forEach((status) => {
        entry[status] = Number(route.statuses?.[status]) || 0;
      });
      return entry;
    });

    const stack = d3.stack().keys(statuses)(seriesData);
    const width = container.clientWidth || 600;
    const height = Math.max(260, Math.floor(width * 0.5));
    const margin = { top: 20, right: 20, bottom: 80, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const color = d3.scaleOrdinal()
      .domain(statuses)
      .range(['#22d3ee', '#22c55e', '#fbbf24', '#f97316', '#ef4444', '#a855f7']);

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleBand()
      .domain(seriesData.map((d) => d.route))
      .range([0, innerWidth])
      .padding(0.2);

    const maxStackValue = d3.max(stack[stack.length - 1], (d) => d[1]) || 0;
    const yScale = d3.scaleLinear()
      .domain([0, maxStackValue > 0 ? maxStackValue * 1.15 : 1])
      .nice()
      .range([innerHeight, 0]);

    chart.append('g')
      .attr('class', 'grid grid-horizontal')
      .attr('stroke', 'rgba(148, 163, 184, 0.25)')
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));

    chart.append('g')
      .selectAll('g')
      .data(stack)
      .join('g')
      .attr('fill', (d) => color(d.key))
      .selectAll('rect')
      .data((d) => d)
      .join('rect')
      .attr('x', (d) => xScale(d.data.route))
      .attr('y', (d) => yScale(d[1]))
      .attr('height', (d) => yScale(d[0]) - yScale(d[1]))
      .attr('width', xScale.bandwidth());

    const xAxis = d3.axisBottom(xScale);
    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-25)')
      .style('text-anchor', 'end');

    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d3.format('~s'));
    chart.append('g').call(yAxis);

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    statuses.forEach((status) => {
      const item = document.createElement('div');
      item.className = 'chart-legend__item';
      const swatch = document.createElement('span');
      swatch.className = 'chart-legend__swatch';
      swatch.style.backgroundColor = color(status);
      const label = document.createElement('span');
      label.textContent = status;
      item.appendChild(swatch);
      item.appendChild(label);
      legend.appendChild(item);
    });
    container.appendChild(legend);
  };

  const renderDurationChart = () => {
    const container = document.getElementById('durationChart');
    if (!container) {
      return;
    }

    const data = durations.slice(0, 6);
    if (!data.length) {
      showEmpty(container, 'No duration data yet.');
      return;
    }

    const width = container.clientWidth || 600;
    const height = Math.max(240, Math.floor(width * 0.45));
    const margin = { top: 10, right: 24, bottom: 40, left: 120 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const maxValue = d3.max(data, (d) => d.averageSeconds) || 1;

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const yScale = d3.scaleBand()
      .domain(data.map((d) => d.route))
      .range([0, innerHeight])
      .padding(0.25);

    const xScale = d3.scaleLinear()
      .domain([0, maxValue * 1.15])
      .range([0, innerWidth]);

    chart.append('g')
      .attr('class', 'grid grid-horizontal')
      .attr('stroke', 'rgba(148, 163, 184, 0.25)')
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(xScale.ticks(4))
      .join('line')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerHeight);

    chart.selectAll('rect')
      .data(data)
      .join('rect')
      .attr('y', (d) => yScale(d.route))
      .attr('height', yScale.bandwidth())
      .attr('x', 0)
      .attr('width', (d) => xScale(d.averageSeconds))
      .attr('rx', 6)
      .attr('fill', '#22d3ee');

    chart.selectAll('text')
      .data(data)
      .join('text')
      .attr('x', (d) => xScale(d.averageSeconds) + 8)
      .attr('y', (d) => (yScale(d.route) || 0) + yScale.bandwidth() / 2 + 4)
      .attr('fill', '#cbd5e1')
      .text((d) => `${d.averageSeconds.toFixed(2)}s`);

    chart.append('g').call(d3.axisLeft(yScale));
    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(4).tickFormat((value) => `${value.toFixed(1)}s`));
  };

  const renderGpuTimelineChart = () => {
    const container = document.getElementById('gpuTimelineChart');
    if (!container) {
      return;
    }

    const totalBytes = asNumber(gpu.totalBytes);
    const points = Array.isArray(gpuTimeline.points) ? [...gpuTimeline.points] : [];

    if (gpuTimeline.latest && gpuTimeline.latest.tsMs) {
      points.push(gpuTimeline.latest);
    }

    const series = points
      .map((point) => ({
        date: point.tsMs ? new Date(point.tsMs) : null,
        busy: asNumber(point.busyPercent),
        vramPercent: totalBytes ? (asNumber(point.vramUsedBytes) || 0) / totalBytes * 100 : null,
      }))
      .filter((point) => point.date instanceof Date && !Number.isNaN(point.date.getTime()))
      .sort((a, b) => a.date - b.date);

    if (!series.length) {
      showEmpty(container, 'No GPU samples yet.');
      return;
    }

    const width = container.clientWidth || 620;
    const height = Math.max(260, Math.floor(width * 0.45));
    const margin = { top: 20, right: 28, bottom: 50, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    container.innerHTML = '';

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleTime()
      .domain(d3.extent(series, (d) => d.date))
      .range([0, innerWidth]);

    const yScale = d3.scaleLinear()
      .domain([0, 100])
      .range([innerHeight, 0]);

    const busyLine = d3.line()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.busy || 0));

    const vramLine = d3.line()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.vramPercent || 0));

    chart.append('g')
      .attr('class', 'grid grid-horizontal')
      .attr('stroke', 'rgba(148, 163, 184, 0.25)')
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#22c55e')
      .attr('stroke-width', 2.2)
      .attr('d', busyLine);

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#38bdf8')
      .attr('stroke-width', 2.2)
      .attr('d', vramLine);

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%H:%M:%S')))
      .selectAll('text')
      .attr('transform', 'rotate(-20)')
      .style('text-anchor', 'end');

    chart.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickFormat((value) => `${value.toFixed(0)}%`));

    const legend = document.createElement('div');
    legend.className = 'chart-legend';

    [
      { label: 'GPU busy', color: '#22c55e' },
      { label: 'VRAM used', color: '#38bdf8' },
    ].forEach((item) => {
      const el = document.createElement('div');
      el.className = 'chart-legend__item';
      const swatch = document.createElement('span');
      swatch.className = 'chart-legend__swatch';
      swatch.style.backgroundColor = item.color;
      const text = document.createElement('span');
      text.textContent = item.label;
      el.appendChild(swatch);
      el.appendChild(text);
      legend.appendChild(el);
    });

    container.appendChild(legend);
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

  const safeDurationChart = safeRender(renderDurationChart, 'duration chart');
  safeDurationChart();
  resizeCallbacks.push(safeDurationChart);

  const safeGpuChart = safeRender(renderGpuTimelineChart, 'GPU timeline chart');
  safeGpuChart();
  resizeCallbacks.push(safeGpuChart);

  initAutoStopControls();
  initMonitorControls();
})();
