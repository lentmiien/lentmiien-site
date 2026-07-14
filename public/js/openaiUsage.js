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
  const completionInsights = payload.completionInsights && typeof payload.completionInsights === 'object'
    ? payload.completionInsights
    : null;
  const spendingInsights = payload.spendingInsights && typeof payload.spendingInsights === 'object'
    ? payload.spendingInsights
    : null;

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

  const numberDetailed = new Intl.NumberFormat('en-US');
  const numberCompact = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
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
      apiCost: Number(entry.apiCost) || 0,
      subscriptionCost: Number(entry.subscriptionCost) || 0,
      totalCost: Number(entry.totalCost) || 0,
      subscriptionPlanName: entry.subscriptionPlanName || 'Free',
    }))
    .filter((entry) => entry.date instanceof Date && !Number.isNaN(entry.date.getTime()))
    .sort((a, b) => a.date - b.date);

  const monthlyDetailSeries = monthlyCards.map((month) => ({
    month: month.month,
    label: month.label,
    apiCost: Number(month.apiCost) || 0,
    subscriptionCost: Number(month.subscriptionCost) || 0,
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

  const spendingTimelineSeries = (Array.isArray(spendingInsights?.monthlySpending)
    ? spendingInsights.monthlySpending
    : [])
    .map((entry) => ({
      month: entry.month,
      label: entry.label,
      date: parseMonth(entry.month),
      totalCost: Number(entry.totalCost) || 0,
      centeredAverageCost: entry.centeredAverageCost === null
        || entry.centeredAverageCost === undefined
        ? null
        : Number(entry.centeredAverageCost),
      averageWindowStart: entry.averageWindowStart,
      averageWindowEnd: entry.averageWindowEnd,
    }))
    .filter((entry) => entry.date instanceof Date
      && !Number.isNaN(entry.date.getTime())
      && (entry.centeredAverageCost === null || Number.isFinite(entry.centeredAverageCost)))
    .sort((a, b) => a.date - b.date);

  const weekdaySpendingSeries = (Array.isArray(spendingInsights?.weekdaySpending)
    ? spendingInsights.weekdaySpending
    : [])
    .map((entry) => ({
      label: entry.label,
      shortLabel: entry.shortLabel,
      totalCost: Number(entry.totalCost) || 0,
      averageCost: Number(entry.averageCost) || 0,
      trackedDays: Number(entry.trackedDays) || 0,
      sharePercent: Number(entry.sharePercent) || 0,
    }));

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

  const cssColor = (token, fallback) => {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return value || fallback;
  };

  const escapeHtml = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const renderRollingSpendingChart = () => {
    const container = document.getElementById('rollingSpendingChart');
    const averageSeries = spendingTimelineSeries
      .filter((entry) => entry.centeredAverageCost !== null);
    if (!container || !spendingTimelineSeries.length || !averageSeries.length) {
      return;
    }

    const width = container.clientWidth || container.parentElement?.clientWidth || 640;
    const isCompactLegend = width < 560;
    const height = Math.max(300, Math.min(420, Math.floor(width * 0.46)));
    const margin = {
      top: isCompactLegend ? 58 : 38,
      right: width < 480 ? 18 : 30,
      bottom: 58,
      left: width < 480 ? 54 : 72,
    };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);
    const brand = cssColor('--brand', '#FF6A1F');
    const accent = cssColor('--accent', '#FFC247');
    const divider = cssColor('--divider', '#2B313C');
    const textMuted = cssColor('--text-muted', '#9AA3B2');

    container.innerHTML = '';
    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);
    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);
    const xScale = d3.scaleTime()
      .domain(d3.extent(spendingTimelineSeries, (entry) => entry.date))
      .range([0, innerWidth]);
    const maxCost = d3.max(spendingTimelineSeries, (entry) => Math.max(
      entry.totalCost,
      entry.centeredAverageCost || 0,
    )) || 0;
    const yScale = d3.scaleLinear()
      .domain([0, maxCost <= 0 ? 1 : maxCost * 1.15])
      .nice()
      .range([innerHeight, 0]);

    chart.append('g')
      .attr('stroke', divider)
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(yScale.ticks(6))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (value) => yScale(value))
      .attr('y2', (value) => yScale(value));

    const pointSpacing = spendingTimelineSeries.length > 1
      ? innerWidth / (spendingTimelineSeries.length - 1)
      : innerWidth;
    const barWidth = Math.max(2, Math.min(18, pointSpacing * 0.58));
    chart.selectAll('.monthly-total-bar')
      .data(spendingTimelineSeries)
      .join('rect')
      .attr('class', 'monthly-total-bar')
      .attr('x', (entry) => xScale(entry.date) - (barWidth / 2))
      .attr('y', (entry) => yScale(entry.totalCost))
      .attr('width', barWidth)
      .attr('height', (entry) => innerHeight - yScale(entry.totalCost))
      .attr('rx', Math.min(3, barWidth / 2))
      .attr('fill', brand)
      .attr('opacity', 0.38);

    const averageLine = d3.line()
      .defined((entry) => entry.centeredAverageCost !== null)
      .curve(d3.curveMonotoneX)
      .x((entry) => xScale(entry.date))
      .y((entry) => yScale(entry.centeredAverageCost));
    chart.append('path')
      .datum(spendingTimelineSeries)
      .attr('fill', 'none')
      .attr('stroke', accent)
      .attr('stroke-width', 3)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', averageLine);
    chart.selectAll('.rolling-average-point')
      .data(averageSeries)
      .join('circle')
      .attr('class', 'rolling-average-point')
      .attr('cx', (entry) => xScale(entry.date))
      .attr('cy', (entry) => yScale(entry.centeredAverageCost))
      .attr('r', 3.5)
      .attr('fill', accent)
      .attr('stroke', cssColor('--surface-1', '#171A20'))
      .attr('stroke-width', 1.5);

    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.min(width < 520 ? 5 : 10, spendingTimelineSeries.length))
      .tickFormat(formatMonth);
    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-30)')
      .style('text-anchor', 'end');
    chart.append('g')
      .call(d3.axisLeft(yScale).ticks(6).tickFormat(formatCurrencyTick));

    const legend = svg.append('g')
      .attr('class', 'chart-legend')
      .attr('transform', `translate(${margin.left},12)`);
    [
      { label: 'Combined monthly spend', color: brand, type: 'bar' },
      { label: 'Centered 5-month average', color: accent, type: 'line' },
    ].forEach((item, index) => {
      const group = legend.append('g')
        .attr('transform', isCompactLegend
          ? `translate(0,${index * 19})`
          : `translate(${index * 205},0)`);
      if (item.type === 'line') {
        group.append('line')
          .attr('x1', 0)
          .attr('x2', 12)
          .attr('y1', 6)
          .attr('y2', 6)
          .attr('stroke', item.color)
          .attr('stroke-width', 3)
          .attr('stroke-linecap', 'round');
      } else {
        group.append('rect')
          .attr('width', 11)
          .attr('height', 11)
          .attr('rx', 2)
          .attr('fill', item.color)
          .attr('opacity', 0.55);
      }
      group.append('text')
        .attr('x', 18)
        .attr('y', 10)
        .attr('fill', textMuted)
        .text(item.label);
    });

    const tooltip = ensureTooltip(container);
    const hitWidth = Math.max(10, pointSpacing);
    chart.selectAll('.rolling-spending-hit-area')
      .data(spendingTimelineSeries)
      .join('rect')
      .attr('class', 'rolling-spending-hit-area')
      .attr('x', (entry) => Math.max(0, xScale(entry.date) - (hitWidth / 2)))
      .attr('y', 0)
      .attr('width', Math.min(hitWidth, innerWidth))
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .on('mouseenter', (event, entry) => {
        const details = [
          `<strong>${escapeHtml(entry.label || formatMonth(entry.date))}</strong>`,
          `Combined spend ${formatCurrencyExact(entry.totalCost)}`,
        ];
        if (entry.centeredAverageCost !== null) {
          const windowStart = parseMonth(entry.averageWindowStart);
          const windowEnd = parseMonth(entry.averageWindowEnd);
          const windowLabel = windowStart && windowEnd
            ? ` (${formatMonth(windowStart)}–${formatMonth(windowEnd)})`
            : '';
          details.push(`5-month average ${formatCurrencyExact(entry.centeredAverageCost)}${windowLabel}`);
        } else {
          details.push('5-month average unavailable');
        }
        tooltip.innerHTML = details.join('<br>');
        tooltip.style.opacity = '1';
      })
      .on('mousemove', (event) => {
        tooltip.style.transform = `translate(${event.offsetX + 12}px, ${event.offsetY + 12}px)`;
      })
      .on('mouseleave', () => {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translate(-9999px, -9999px)';
      });
  };

  const renderWeekdaySpendingChart = () => {
    const container = document.getElementById('weekdaySpendingChart');
    if (!container || !weekdaySpendingSeries.length) {
      return;
    }

    const width = container.clientWidth || container.parentElement?.clientWidth || 640;
    const height = Math.max(270, Math.min(340, Math.floor(width * 0.36)));
    const margin = {
      top: 24,
      right: width < 480 ? 14 : 28,
      bottom: 44,
      left: width < 480 ? 54 : 72,
    };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);
    const brand = cssColor('--brand', '#FF6A1F');
    const accent = cssColor('--accent', '#FFC247');
    const divider = cssColor('--divider', '#2B313C');
    const highestAverage = d3.max(weekdaySpendingSeries, (entry) => entry.averageCost) || 0;

    container.innerHTML = '';
    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);
    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);
    const xScale = d3.scaleBand()
      .domain(weekdaySpendingSeries.map((entry) => entry.shortLabel))
      .range([0, innerWidth])
      .padding(0.28);
    const yScale = d3.scaleLinear()
      .domain([0, highestAverage <= 0 ? 1 : highestAverage * 1.16])
      .nice()
      .range([innerHeight, 0]);

    chart.append('g')
      .attr('stroke', divider)
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (value) => yScale(value))
      .attr('y2', (value) => yScale(value));

    chart.selectAll('.weekday-spending-bar')
      .data(weekdaySpendingSeries)
      .join('rect')
      .attr('class', 'weekday-spending-bar')
      .attr('x', (entry) => xScale(entry.shortLabel))
      .attr('y', (entry) => yScale(entry.averageCost))
      .attr('width', xScale.bandwidth())
      .attr('height', (entry) => innerHeight - yScale(entry.averageCost))
      .attr('rx', Math.min(6, xScale.bandwidth() / 3))
      .attr('fill', (entry) => (
        highestAverage > 0 && entry.averageCost === highestAverage ? accent : brand
      ))
      .attr('opacity', (entry) => (entry.trackedDays > 0 ? 0.82 : 0.2));

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickSizeOuter(0));
    chart.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickFormat(formatCurrencyTick));

    const tooltip = ensureTooltip(container);
    chart.selectAll('.weekday-spending-hit-area')
      .data(weekdaySpendingSeries)
      .join('rect')
      .attr('class', 'weekday-spending-hit-area')
      .attr('x', (entry) => xScale(entry.shortLabel))
      .attr('y', 0)
      .attr('width', xScale.bandwidth())
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .on('mouseenter', (event, entry) => {
        const dayLabel = `${entry.trackedDays} tracked ${entry.trackedDays === 1 ? 'day' : 'days'}`;
        tooltip.innerHTML = [
          `<strong>${escapeHtml(entry.label)}</strong>`,
          `Average ${formatCurrencyExact(entry.averageCost)}`,
          `Total API spend ${formatCurrencyExact(entry.totalCost)}`,
          `${dayLabel} · ${entry.sharePercent}% of API spend`,
        ].join('<br>');
        tooltip.style.opacity = '1';
      })
      .on('mousemove', (event) => {
        tooltip.style.transform = `translate(${event.offsetX + 12}px, ${event.offsetY + 12}px)`;
      })
      .on('mouseleave', () => {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translate(-9999px, -9999px)';
      });
  };

  if (spendingTimelineSeries.some((entry) => entry.centeredAverageCost !== null)) {
    renderRollingSpendingChart();
    resizeCallbacks.push(renderRollingSpendingChart);
  }

  if (weekdaySpendingSeries.some((entry) => entry.trackedDays > 0)) {
    renderWeekdaySpendingChart();
    resizeCallbacks.push(renderWeekdaySpendingChart);
  }

  const renderCompletionActivityChart = () => {
    const container = document.getElementById('completionActivityChart');
    const rawSeries = Array.isArray(completionInsights?.dailyActivity)
      ? completionInsights.dailyActivity
      : [];
    if (!container || !rawSeries.length) {
      return;
    }

    const series = rawSeries
      .map((entry) => ({
        dateString: entry.date,
        date: parseDay(entry.date),
        tracked: entry.tracked === true,
        requests: Number(entry.requests) || 0,
        tokens: Number(entry.tokens) || 0,
        models: Array.isArray(entry.models) ? entry.models : [],
      }))
      .filter((entry) => entry.date instanceof Date && !Number.isNaN(entry.date.getTime()));

    if (!series.length || !series.some((entry) => entry.requests > 0)) {
      container.innerHTML = '<div class="chart-empty">No request activity to chart.</div>';
      return;
    }

    series.forEach((entry, index) => {
      const rollingWindow = series.slice(Math.max(0, index - 6), index + 1);
      const trackedWindow = rollingWindow.filter((day) => day.tracked);
      entry.rollingAverage = trackedWindow.length
        ? d3.sum(trackedWindow, (day) => day.requests) / trackedWindow.length
        : 0;
    });

    const width = container.clientWidth || container.parentElement?.clientWidth || 640;
    const height = Math.max(260, Math.min(310, Math.floor(width * 0.48)));
    const margin = {
      top: 12,
      right: 20,
      bottom: 44,
      left: width < 480 ? 44 : 54,
    };
    const innerWidth = Math.max(1, width - margin.left - margin.right);
    const innerHeight = Math.max(1, height - margin.top - margin.bottom);
    const accent = cssColor('--accent', '#FFC247');
    const brand = cssColor('--brand', '#FF6A1F');
    const divider = cssColor('--divider', '#2B313C');

    container.innerHTML = '';
    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);
    const chart = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleBand()
      .domain(series.map((entry) => entry.dateString))
      .range([0, innerWidth])
      .padding(0.24);
    const maxValue = d3.max(series, (entry) => Math.max(entry.requests, entry.rollingAverage)) || 0;
    const yScale = d3.scaleLinear()
      .domain([0, maxValue <= 0 ? 1 : maxValue * 1.12])
      .nice()
      .range([innerHeight, 0]);

    chart.append('g')
      .attr('stroke', divider)
      .attr('stroke-dasharray', '4 4')
      .selectAll('line')
      .data(yScale.ticks(5))
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (value) => yScale(value))
      .attr('y2', (value) => yScale(value));

    chart.selectAll('.completion-request-bar')
      .data(series)
      .join('rect')
      .attr('class', 'completion-request-bar')
      .attr('x', (entry) => xScale(entry.dateString))
      .attr('y', (entry) => yScale(entry.requests))
      .attr('width', xScale.bandwidth())
      .attr('height', (entry) => innerHeight - yScale(entry.requests))
      .attr('rx', Math.min(3, xScale.bandwidth() / 2))
      .attr('fill', accent)
      .attr('opacity', (entry) => (entry.tracked ? 0.78 : 0.22));

    const averageLine = d3.line()
      .curve(d3.curveMonotoneX)
      .x((entry) => (xScale(entry.dateString) || 0) + (xScale.bandwidth() / 2))
      .y((entry) => yScale(entry.rollingAverage));

    chart.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', brand)
      .attr('stroke-width', 2.25)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('d', averageLine);

    const desiredTickCount = width < 520 ? 4 : 7;
    const tickStep = Math.max(1, Math.ceil(series.length / desiredTickCount));
    const tickValues = series
      .filter((entry, index) => index % tickStep === 0 || index === series.length - 1)
      .map((entry) => entry.dateString);
    const xAxis = d3.axisBottom(xScale)
      .tickValues(Array.from(new Set(tickValues)))
      .tickSizeOuter(0)
      .tickFormat((value) => {
        const date = parseDay(value);
        return date ? d3.timeFormat('%b %e')(date) : value;
      });

    chart.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis);
    chart.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickSizeOuter(0).tickFormat(d3.format('~s')));

    const tooltip = ensureTooltip(container);
    chart.selectAll('.completion-request-hit-area')
      .data(series)
      .join('rect')
      .attr('class', 'completion-request-hit-area')
      .attr('x', (entry) => xScale(entry.dateString))
      .attr('y', 0)
      .attr('width', xScale.bandwidth())
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .on('mouseenter', (event, entry) => {
        const modelSummary = entry.models
          .slice(0, 3)
          .map((model) => `${escapeHtml(model.model)}: ${numberDetailed.format(Number(model.requests) || 0)}`);
        const detail = entry.tracked
          ? [
            `${numberDetailed.format(entry.requests)} requests`,
            `${numberCompact.format(entry.tokens)} tokens`,
            ...modelSummary,
          ]
          : ['No stored usage entry'];
        tooltip.innerHTML = [`<strong>${formatDay(entry.date)}</strong>`, ...detail].join('<br>');
        tooltip.style.opacity = '1';
      })
      .on('mousemove', (event) => {
        tooltip.style.transform = `translate(${event.offsetX + 12}px, ${event.offsetY + 12}px)`;
      })
      .on('mouseleave', () => {
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translate(-9999px, -9999px)';
      });
  };

  if (completionInsights?.hasActivity) {
    renderCompletionActivityChart();
    resizeCallbacks.push(renderCompletionActivityChart);
  }

  const renderMonthlyTimelineChart = () => {
    const container = document.getElementById('monthlyUsageChart');
    if (!container || !timelineSeries.length) {
      return;
    }

    const width = container.clientWidth || container.parentElement?.clientWidth || 600;
    const height = Math.max(280, Math.floor(width * 0.45));
    const isCompactLegend = width < 520;
    const margin = { top: isCompactLegend ? 52 : 32, right: 32, bottom: 56, left: 72 };
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

    const apiAreaGenerator = d3.area()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y0(innerHeight)
      .y1((d) => yScale(d.apiCost));

    chart.append('path')
      .datum(timelineSeries)
      .attr('fill', 'rgba(37, 99, 235, 0.18)')
      .attr('d', apiAreaGenerator);

    const subscriptionAreaGenerator = d3.area()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y0((d) => yScale(d.apiCost))
      .y1((d) => yScale(d.totalCost));

    chart.append('path')
      .datum(timelineSeries)
      .attr('fill', 'rgba(20, 184, 166, 0.24)')
      .attr('d', subscriptionAreaGenerator);

    const apiLineGenerator = d3.line()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.apiCost));

    chart.append('path')
      .datum(timelineSeries)
      .attr('fill', 'none')
      .attr('stroke', '#2563eb')
      .attr('stroke-width', 2)
      .attr('d', apiLineGenerator);

    const totalLineGenerator = d3.line()
      .curve(d3.curveMonotoneX)
      .x((d) => xScale(d.date))
      .y((d) => yScale(d.totalCost));

    chart.append('path')
      .datum(timelineSeries)
      .attr('fill', 'none')
      .attr('stroke', '#14b8a6')
      .attr('stroke-width', 2.5)
      .attr('d', totalLineGenerator);

    const legend = svg.append('g')
      .attr('class', 'chart-legend')
      .attr('transform', `translate(${margin.left},12)`);

    [
      { label: 'API usage', color: '#2563eb' },
      { label: 'ChatGPT subscription', color: '#14b8a6' },
    ].forEach((item, index) => {
      const group = legend.append('g')
        .attr('transform', isCompactLegend ? `translate(0,${index * 18})` : `translate(${index * 168},0)`);
      group.append('rect')
        .attr('width', 11)
        .attr('height', 11)
        .attr('rx', 2)
        .attr('fill', item.color);
      group.append('text')
        .attr('x', 17)
        .attr('y', 10)
        .text(item.label);
    });

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
      .attr('fill', '#0f766e')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5)
      .on('mouseenter', (event, d) => {
        tooltip.innerHTML = [
          `<strong>${formatMonth(d.date)}</strong>`,
          `Total ${formatCurrencyExact(d.totalCost)}`,
          `API ${formatCurrencyExact(d.apiCost)}`,
          `${d.subscriptionPlanName} ${formatCurrencyExact(d.subscriptionCost)}`,
        ].join('<br>');
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
