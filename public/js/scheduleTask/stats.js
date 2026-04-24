(function () {
  const payloadElement = document.getElementById('scheduleTaskStatsData');
  if (!payloadElement || typeof d3 === 'undefined') {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(payloadElement.textContent || '{}');
  } catch (error) {
    console.error('Failed to parse schedule task stats payload.', error);
    return;
  }

  const rootStyles = getComputedStyle(document.documentElement);
  const colors = {
    brand: rootStyles.getPropertyValue('--brand').trim() || '#FF6A1F',
    accent: rootStyles.getPropertyValue('--accent').trim() || '#FFC247',
    surface: rootStyles.getPropertyValue('--surface-1').trim() || '#171A20',
    text: rootStyles.getPropertyValue('--text').trim() || '#E8ECF2',
    textSecondary: rootStyles.getPropertyValue('--text-secondary').trim() || '#C1C7D3',
    divider: rootStyles.getPropertyValue('--divider').trim() || '#2B313C',
    danger: rootStyles.getPropertyValue('--danger').trim() || '#FF4D4F',
    currentUser: '#17C696'
  };

  const timeParse = d3.timeParse('%Y-%m-%d');
  const percentFormat = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });

  const resizeCallbacks = [];
  let resizeRaf = null;

  const scheduleResize = () => {
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
    }
    resizeRaf = requestAnimationFrame(() => {
      resizeCallbacks.forEach((callback) => {
        try {
          callback();
        } catch (error) {
          console.error('Failed to render schedule task stats chart.', error);
        }
      });
    });
  };

  window.addEventListener('resize', scheduleResize);

  function ensureTooltip(container) {
    let tooltip = container.querySelector('.chart-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'chart-tooltip';
      container.appendChild(tooltip);
    }
    return tooltip;
  }

  function setLegend(container, items) {
    let legend = container.querySelector('.chart-legend');
    if (!legend) {
      legend = document.createElement('div');
      legend.className = 'chart-legend';
      container.prepend(legend);
    }

    legend.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('span');
      row.className = 'chart-legend__item';

      const swatch = document.createElement('span');
      swatch.className = 'chart-legend__swatch';
      swatch.style.background = item.color;
      if (item.border) {
        swatch.style.boxShadow = `0 0 0 1px ${item.border}`;
      }

      const label = document.createElement('span');
      label.textContent = item.label;

      row.appendChild(swatch);
      row.appendChild(label);
      legend.appendChild(row);
    });
  }

  function renderEmpty(container, message) {
    container.innerHTML = '';
    const legend = container.querySelector('.chart-legend');
    if (legend) legend.remove();
    const empty = document.createElement('div');
    empty.className = 'chart-empty';
    empty.textContent = message;
    container.appendChild(empty);
  }

  function renderActivityChart() {
    const container = document.getElementById('activityChart');
    const rawSeries = Array.isArray(payload?.charts?.activity28d) ? payload.charts.activity28d : [];
    if (!container) return;

    const series = rawSeries
      .map((entry) => ({
        dateKey: entry.dateKey,
        label: entry.label,
        date: timeParse(entry.dateKey),
        created: Number(entry.created) || 0,
        completed: Number(entry.completed) || 0,
        onWindow: Number(entry.onWindow) || 0,
        late: Number(entry.late) || 0
      }))
      .filter((entry) => entry.date instanceof Date && !Number.isNaN(entry.date.getTime()));

    if (!series.length) {
      renderEmpty(container, 'No activity in the last 28 days.');
      return;
    }

    setLegend(container, [
      { label: 'Created', color: colors.brand },
      { label: 'Completed', color: colors.accent },
      { label: 'Late completions', color: colors.danger }
    ]);

    const tooltip = ensureTooltip(container);
    const width = Math.max(320, container.clientWidth || 320);
    const height = Math.max(280, Math.floor(width * 0.58));
    const margin = { top: 20, right: 28, bottom: 56, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const oldSvg = container.querySelector('svg');
    if (oldSvg) oldSvg.remove();

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'scheduleActivityCompletedGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', colors.accent)
      .attr('stop-opacity', 0.28);

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', colors.accent)
      .attr('stop-opacity', 0.02);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleTime()
      .domain(d3.extent(series, (entry) => entry.date))
      .range([0, innerWidth]);

    const maxValue = d3.max(series, (entry) => Math.max(entry.created, entry.completed, entry.late)) || 0;
    const yScale = d3.scaleLinear()
      .domain([0, maxValue <= 0 ? 1 : maxValue * 1.25])
      .nice()
      .range([innerHeight, 0]);

    chart.append('g')
      .attr('class', 'chart-grid')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (value) => yScale(value))
      .attr('y2', (value) => yScale(value));

    const areaGenerator = d3.area()
      .curve(d3.curveMonotoneX)
      .x((entry) => xScale(entry.date))
      .y0(innerHeight)
      .y1((entry) => yScale(entry.completed));

    chart.append('path')
      .datum(series)
      .attr('fill', 'url(#scheduleActivityCompletedGradient)')
      .attr('d', areaGenerator);

    const lineGenerator = (key) => d3.line()
      .curve(d3.curveMonotoneX)
      .x((entry) => xScale(entry.date))
      .y((entry) => yScale(entry[key]));

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', colors.brand)
      .attr('stroke-width', 2.4)
      .attr('d', lineGenerator('created'));

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', colors.accent)
      .attr('stroke-width', 2.8)
      .attr('d', lineGenerator('completed'));

    const barWidth = Math.max(4, innerWidth / Math.max(series.length * 2.1, 1));
    chart.selectAll('.late-bar')
      .data(series)
      .join('rect')
      .attr('class', 'late-bar')
      .attr('x', (entry) => xScale(entry.date) - (barWidth / 2))
      .attr('y', (entry) => yScale(entry.late))
      .attr('width', barWidth)
      .attr('height', (entry) => innerHeight - yScale(entry.late))
      .attr('rx', 6)
      .attr('fill', 'rgba(255, 77, 79, 0.28)');

    chart.selectAll('.completed-dot')
      .data(series)
      .join('circle')
      .attr('class', 'completed-dot')
      .attr('cx', (entry) => xScale(entry.date))
      .attr('cy', (entry) => yScale(entry.completed))
      .attr('r', 3.8)
      .attr('fill', colors.accent)
      .attr('stroke', colors.surface)
      .attr('stroke-width', 1.8);

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3.axisBottom(xScale)
          .ticks(Math.min(7, series.length))
          .tickFormat((value) => d3.timeFormat('%b %d')(value))
      )
      .selectAll('text')
      .attr('transform', 'rotate(-30)')
      .style('text-anchor', 'end')
      .style('fill', colors.textSecondary);

    chart.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickSizeOuter(0))
      .selectAll('text')
      .style('fill', colors.textSecondary);

    chart.selectAll('.overlay-hit')
      .data(series)
      .join('rect')
      .attr('class', 'overlay-hit')
      .attr('x', (_, index) => {
        const current = xScale(series[index].date);
        const previous = index === 0 ? current : xScale(series[index - 1].date);
        return index === 0 ? 0 : (current + previous) / 2;
      })
      .attr('y', 0)
      .attr('width', (_, index) => {
        const current = xScale(series[index].date);
        const previous = index === 0 ? current : xScale(series[index - 1].date);
        const next = index === series.length - 1 ? current : xScale(series[index + 1].date);
        const left = index === 0 ? 0 : (current + previous) / 2;
        const right = index === series.length - 1 ? innerWidth : (current + next) / 2;
        return right - left;
      })
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .on('mouseenter', function (event, entry) {
        tooltip.innerHTML = `<strong>${entry.label}</strong><br>Created: ${entry.created}<br>Completed: ${entry.completed}<br>Within window: ${entry.onWindow}<br>Late: ${entry.late}`;
        tooltip.style.opacity = '1';
      })
      .on('mousemove', function (event) {
        const bounds = container.getBoundingClientRect();
        tooltip.style.transform = `translate(${event.clientX - bounds.left + 14}px, ${event.clientY - bounds.top + 14}px)`;
      })
      .on('mouseleave', function () {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translate(-9999px, -9999px)';
      });
  }

  function renderScoreChart() {
    const container = document.getElementById('scoreChart');
    const rawSeries = Array.isArray(payload?.charts?.score90d) ? payload.charts.score90d : [];
    if (!container) return;

    const series = rawSeries.map((entry) => ({
      userId: entry.userId,
      score: Number(entry.score) || 0,
      completedCount: Number(entry.completedCount) || 0,
      windowHitRate: Number(entry.windowHitRate) || 0,
      overdueOpenCount: Number(entry.overdueOpenCount) || 0,
      isCurrentUser: Boolean(entry.isCurrentUser)
    }));

    if (!series.length) {
      renderEmpty(container, 'No leaderboard entries in the last 3 months.');
      return;
    }

    setLegend(container, [
      { label: 'Overall score', color: colors.brand },
      { label: 'Window-hit accuracy', color: colors.accent },
      { label: 'Current user', color: colors.currentUser }
    ]);

    const tooltip = ensureTooltip(container);
    const width = Math.max(320, container.clientWidth || 320);
    const height = Math.max(280, Math.floor(width * 0.58));
    const margin = { top: 24, right: 48, bottom: 70, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const oldSvg = container.querySelector('svg');
    if (oldSvg) oldSvg.remove();

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient')
      .attr('id', 'scheduleScoreGradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', colors.accent);
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', colors.brand);

    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleBand()
      .domain(series.map((entry) => entry.userId))
      .range([0, innerWidth])
      .padding(0.28);

    const yScore = d3.scaleLinear()
      .domain([0, Math.max(100, d3.max(series, (entry) => entry.score) || 0) * 1.15])
      .nice()
      .range([innerHeight, 0]);

    const yRate = d3.scaleLinear()
      .domain([0, 1])
      .range([innerHeight, 0]);

    chart.append('g')
      .attr('class', 'chart-grid')
      .selectAll('line')
      .data(yScore.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (value) => yScore(value))
      .attr('y2', (value) => yScore(value));

    chart.selectAll('.score-bar')
      .data(series)
      .join('rect')
      .attr('class', 'score-bar')
      .attr('x', (entry) => xScale(entry.userId))
      .attr('y', (entry) => yScore(entry.score))
      .attr('width', xScale.bandwidth())
      .attr('height', (entry) => innerHeight - yScore(entry.score))
      .attr('rx', 12)
      .attr('fill', (entry) => entry.isCurrentUser ? colors.currentUser : 'url(#scheduleScoreGradient)')
      .attr('opacity', 0.9);

    const line = d3.line()
      .curve(d3.curveMonotoneX)
      .x((entry) => (xScale(entry.userId) || 0) + (xScale.bandwidth() / 2))
      .y((entry) => yRate(entry.windowHitRate));

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', colors.accent)
      .attr('stroke-width', 2.5)
      .attr('d', line);

    chart.selectAll('.rate-dot')
      .data(series)
      .join('circle')
      .attr('class', 'rate-dot')
      .attr('cx', (entry) => (xScale(entry.userId) || 0) + (xScale.bandwidth() / 2))
      .attr('cy', (entry) => yRate(entry.windowHitRate))
      .attr('r', 4.5)
      .attr('fill', colors.accent)
      .attr('stroke', colors.surface)
      .attr('stroke-width', 1.8);

    chart.selectAll('.score-label')
      .data(series)
      .join('text')
      .attr('class', 'score-label')
      .attr('x', (entry) => (xScale(entry.userId) || 0) + (xScale.bandwidth() / 2))
      .attr('y', (entry) => Math.max(14, yScore(entry.score) - 8))
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text)
      .attr('font-size', 11)
      .attr('font-weight', 700)
      .text((entry) => entry.score);

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale))
      .selectAll('text')
      .attr('transform', 'rotate(-30)')
      .style('text-anchor', 'end')
      .style('fill', colors.textSecondary);

    chart.append('g')
      .call(d3.axisLeft(yScore).ticks(5).tickSizeOuter(0))
      .selectAll('text')
      .style('fill', colors.textSecondary);

    chart.append('g')
      .attr('transform', `translate(${innerWidth},0)`)
      .call(d3.axisRight(yRate).ticks(4).tickFormat((value) => percentFormat.format(value)).tickSizeOuter(0))
      .selectAll('text')
      .style('fill', colors.textSecondary);

    chart.selectAll('.hover-column')
      .data(series)
      .join('rect')
      .attr('class', 'hover-column')
      .attr('x', (entry) => xScale(entry.userId))
      .attr('y', 0)
      .attr('width', xScale.bandwidth())
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .on('mouseenter', function (event, entry) {
        tooltip.innerHTML = `<strong>${entry.userId}</strong><br>Score: ${entry.score}<br>Completed: ${entry.completedCount}<br>Window hit: ${percentFormat.format(entry.windowHitRate)}<br>Overdue open: ${entry.overdueOpenCount}`;
        tooltip.style.opacity = '1';
      })
      .on('mousemove', function (event) {
        const bounds = container.getBoundingClientRect();
        tooltip.style.transform = `translate(${event.clientX - bounds.left + 14}px, ${event.clientY - bounds.top + 14}px)`;
      })
      .on('mouseleave', function () {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translate(-9999px, -9999px)';
      });
  }

  renderActivityChart();
  renderScoreChart();

  resizeCallbacks.push(renderActivityChart);
  resizeCallbacks.push(renderScoreChart);
})();
