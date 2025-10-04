(function () {
  const dataElement = document.getElementById('openaiUsageData');
  if (!dataElement) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    console.error('Failed to parse OpenAI usage data payload.', error);
    return;
  }

  const monthlyTimeline = Array.isArray(payload.monthlyTimeline) ? payload.monthlyTimeline : [];
  const monthlyCards = Array.isArray(payload.monthlyCards) ? payload.monthlyCards : [];

  const parseMonth = d3.timeParse('%Y-%m');
  const parseDay = d3.timeParse('%Y-%m-%d');
  const formatMonth = d3.timeFormat('%b %Y');
  const formatDay = d3.timeFormat('%b %d, %Y');

  const currencyCompact = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  const currencyDetailed = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formatCurrencyExact = (value) => {
    if (value >= 100) {
      return currencyCompact.format(value);
    }
    return currencyDetailed.format(value);
  };

  const formatCurrencyTick = (value) => {
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}k`;
    }
    if (value >= 100) {
      return currencyCompact.format(value);
    }
    return currencyDetailed.format(value);
  };

  const timelineSeries = monthlyTimeline
    .map((entry) => ({
      month: entry.month,
      label: entry.label,
      date: parseMonth(entry.month),
      totalCost: Number(entry.totalCost) || 0,
    }))
    .filter((entry) => entry.date instanceof Date && !Number.isNaN(entry.date.getTime()))
    .sort((a, b) => a.date - b.date);

  const monthlyDetailSeries = monthlyCards.map((month) => ({
    month: month.month,
    label: month.label,
    totalCost: Number(month.totalCost) || 0,
    dailyEntries: Array.isArray(month.dailyEntries)
      ? month.dailyEntries
        .map((entry) => ({
          dateString: entry.date,
          date: parseDay(entry.date),
          cost: Number(entry.cost) || 0,
        }))
        .filter((entry) => entry.date instanceof Date && !Number.isNaN(entry.date.getTime()))
        .sort((a, b) => a.date - b.date)
      : [],
  }));

  const monthlyDetailMap = new Map(monthlyDetailSeries.map((entry) => [entry.month, entry]));

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
          console.error('Failed to execute resize callback.', error);
        }
      });
    });
  };

  window.addEventListener('resize', scheduleResize);

  const ensureTooltip = (container) => {
    let tooltip = container.querySelector('.chart-tooltip');
    if (tooltip) {
      return tooltip;
    }
    tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.style.opacity = '0';
    container.appendChild(tooltip);
    return tooltip;
  };

  const renderMonthlyTimelineChart = () => {
    const container = document.getElementById('monthlyUsageChart');
    if (!container || !timelineSeries.length) {
      return;
    }

    const width = container.clientWidth || container.parentElement?.clientWidth || 600;
    const height = Math.max(280, Math.floor(width * 0.45));
    const margin = { top: 32, right: 32, bottom: 56, left: 72 };
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
      .domain(d3.extent(timelineSeries, (d) => d.date))
      .range([0, innerWidth]);

    const maxCost = d3.max(timelineSeries, (d) => d.totalCost) || 0;
    const yScale = d3.scaleLinear()
      .domain([0, maxCost <= 0 ? 1 : maxCost * 1.15])
      .nice()
      .range([innerHeight, 0]);

    const horizontalGrid = chart.append('g')
      .attr('class', 'grid grid-horizontal')
      .attr('stroke', 'rgba(148, 163, 184, 0.25)')
      .attr('stroke-dasharray', '4 4');

    horizontalGrid.selectAll('line')
      .data(yScale.ticks(6))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));

    const areaGenerator = d3.area()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y0(innerHeight)
      .y1((d) => yScale(d.totalCost));

    chart.append('path')
      .datum(timelineSeries)
      .attr('fill', 'rgba(37, 99, 235, 0.18)')
      .attr('d', areaGenerator);

    const lineGenerator = d3.line()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.totalCost));

    chart.append('path')
      .datum(timelineSeries)
      .attr('fill', 'none')
      .attr('stroke', '#2563eb')
      .attr('stroke-width', 2.5)
      .attr('d', lineGenerator);

    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.min(10, timelineSeries.length))
      .tickFormat(formatMonth);

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-30)')
      .style('text-anchor', 'end');

    const yAxis = d3.axisLeft(yScale)
      .ticks(6)
      .tickFormat((value) => formatCurrencyTick(value));

    chart.append('g')
      .call(yAxis);

    const tooltip = ensureTooltip(container);

    chart.selectAll('circle')
      .data(timelineSeries)
      .enter()
      .append('circle')
      .attr('cx', (d) => xScale(d.date))
      .attr('cy', (d) => yScale(d.totalCost))
      .attr('r', 4.5)
      .attr('fill', '#1d4ed8')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5)
      .on('mouseenter', (event, d) => {
        tooltip.innerHTML = `<strong>${formatMonth(d.date)}</strong><br>${formatCurrencyExact(d.totalCost)}`;
        tooltip.style.opacity = '1';
        tooltip.style.pointerEvents = 'none';
      })
      .on('mousemove', (event) => {
        const { offsetX, offsetY } = event;
        tooltip.style.transform = `translate(${offsetX + 12}px, ${offsetY + 12}px)`;
      })
      .on('mouseleave', () => {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translate(-9999px, -9999px)';
      });
  };

  if (timelineSeries.length) {
    renderMonthlyTimelineChart();
    resizeCallbacks.push(renderMonthlyTimelineChart);
  }

  const renderDailyChart = (monthKey, container) => {
    const monthData = monthlyDetailMap.get(monthKey);
    if (!monthData || !container) {
      return;
    }

    const series = monthData.dailyEntries;
    if (!series.length) {
      container.innerHTML = '<div class="chart-empty">No daily data.</div>';
      return;
    }

    const width = container.clientWidth || container.parentElement?.clientWidth || 400;
    const height = Math.max(220, Math.floor(width * 0.5));
    const margin = { top: 16, right: 24, bottom: 48, left: 64 };
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

    const maxCost = d3.max(series, (d) => d.cost) || 0;
    const yScale = d3.scaleLinear()
      .domain([0, maxCost <= 0 ? 1 : maxCost * 1.2])
      .nice()
      .range([innerHeight, 0]);

    chart.append('g')
      .attr('stroke', 'rgba(148, 163, 184, 0.2)')
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d));

    const areaGenerator = d3.area()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y0(innerHeight)
      .y1((d) => yScale(d.cost));

    chart.append('path')
      .datum(series)
      .attr('fill', 'rgba(14, 165, 233, 0.2)')
      .attr('d', areaGenerator);

    const lineGenerator = d3.line()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.cost));

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#0ea5e9')
      .attr('stroke-width', 2.2)
      .attr('d', lineGenerator);

    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.min(8, series.length))
      .tickFormat((value) => d3.timeFormat('%b %d')(value));

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-30)')
      .style('text-anchor', 'end');

    const yAxis = d3.axisLeft(yScale)
      .ticks(5)
      .tickFormat((value) => formatCurrencyTick(value));

    chart.append('g')
      .call(yAxis);

    const tooltip = ensureTooltip(container);

    const focusGroup = chart.append('g');

    focusGroup.selectAll('circle')
      .data(series)
      .enter()
      .append('circle')
      .attr('cx', (d) => xScale(d.date))
      .attr('cy', (d) => yScale(d.cost))
      .attr('r', 4)
      .attr('fill', '#0284c7')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5)
      .on('mouseenter', (event, d) => {
        tooltip.innerHTML = `<strong>${formatDay(d.date)}</strong><br>${formatCurrencyExact(d.cost)}`;
        tooltip.style.opacity = '1';
        tooltip.style.pointerEvents = 'none';
      })
      .on('mousemove', (event) => {
        const { offsetX, offsetY } = event;
        tooltip.style.transform = `translate(${offsetX + 12}px, ${offsetY + 12}px)`;
      })
      .on('mouseleave', () => {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translate(-9999px, -9999px)';
      });
  };

  const renderedMonths = new Set();

  document.querySelectorAll('details.month-card').forEach((card) => {
    const monthKey = card.dataset.month;
    const chartContainer = card.querySelector('.month-card__chart-container');
    if (!monthKey || !chartContainer) {
      return;
    }

    const renderIfNeeded = () => {
      if (card.open) {
        renderDailyChart(monthKey, chartContainer);
        renderedMonths.add(monthKey);
      }
    };

    card.addEventListener('toggle', () => {
      if (card.open) {
        renderIfNeeded();
      }
    });

    resizeCallbacks.push(() => {
      if (card.open && renderedMonths.has(monthKey)) {
        renderDailyChart(monthKey, chartContainer);
      }
    });

    if (card.open) {
      renderIfNeeded();
    }
  });

  if (window.IntersectionObserver) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const card = entry.target;
          if (card instanceof HTMLDetailsElement && card.open && card.dataset.month) {
            const chartContainer = card.querySelector('.month-card__chart-container');
            if (chartContainer && !renderedMonths.has(card.dataset.month)) {
              renderDailyChart(card.dataset.month, chartContainer);
              renderedMonths.add(card.dataset.month);
            }
          }
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('details.month-card').forEach((card) => observer.observe(card));
  }

  dataElement.remove();
})();
