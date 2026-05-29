(() => {
  const state = window.businessOverallState || {};
  const analytics = state.analytics || {};
  const COLORS = {
    worth: '#54d7a5',
    cash: '#3f8bfd',
    savings: '#f6bd60',
    liability: '#f08a8a',
    income: '#54d7a5',
    spend: '#f08a8a',
    net: '#ffffff',
    text: 'rgba(255,255,255,0.68)',
    grid: 'rgba(255,255,255,0.12)',
  };

  document.addEventListener('DOMContentLoaded', () => {
    renderWorthChart(analytics.monthly || []);
    renderMonthlyChart(analytics.monthly || []);
    renderGroupSpendChart(analytics.groupBreakdown || []);
    renderInterestImpactChart(analytics.externalAssets || {});
  });

  function renderWorthChart(rows) {
    const container = document.getElementById('economicWorthChart');
    if (!container) return;
    container.innerHTML = '';
    if (!rows.length || typeof d3 === 'undefined') {
      renderEmpty(container, 'No worth data available.');
      return;
    }

    const width = container.clientWidth || 760;
    const height = 320;
    const margin = { top: 18, right: 28, bottom: 34, left: 72 };
    const labels = rows.map((row) => row.label);
    const series = [
      { key: 'worthEstimate', label: 'Estimated worth', color: COLORS.worth, value: (row) => row.worthEstimate || 0 },
      { key: 'liquidCashEstimate', label: 'Liquid cash', color: COLORS.cash, value: (row) => row.liquidCashEstimate || 0 },
      { key: 'knownSavingsBalance', label: 'Known savings', color: COLORS.savings, value: (row) => row.knownSavingsBalance || 0 },
      { key: 'creditCardLiability', label: 'Card liability', color: COLORS.liability, value: (row) => 0 - (row.creditCardLiability || 0) },
    ];
    const values = rows.flatMap((row) => series.map((item) => item.value(row)));
    const domain = extentWithPadding(values);
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const x = d3.scalePoint().domain(labels).range([margin.left, width - margin.right]).padding(0.35);
    const y = d3.scaleLinear().domain(domain).nice().range([height - margin.bottom, margin.top]);

    drawGrid(svg, y, margin, width, height);

    const line = d3.line()
      .x((row) => x(row.label))
      .y((row) => y(row.value));

    series.forEach((item) => {
      const data = rows.map((row) => ({ label: row.label, value: item.value(row) }));
      svg.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', item.color)
        .attr('stroke-width', item.key === 'worthEstimate' ? 3 : 2)
        .attr('d', line);
    });

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', COLORS.text)
      .call(d3.axisBottom(x).tickValues(compactTicks(labels)));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', COLORS.text)
      .call(d3.axisLeft(y).ticks(5).tickFormat(shortJpy));

    renderLegend(container, series.map((item) => [item.label, item.color]));
  }

  function renderMonthlyChart(rows) {
    const container = document.getElementById('economicMonthlyChart');
    if (!container) return;
    container.innerHTML = '';
    if (!rows.length || typeof d3 === 'undefined') {
      renderEmpty(container, 'No monthly data available.');
      return;
    }

    const visibleRows = rows.slice(-18);
    const width = container.clientWidth || 520;
    const height = 300;
    const margin = { top: 18, right: 18, bottom: 36, left: 68 };
    const labels = visibleRows.map((row) => row.label);
    const barSeries = [
      { key: 'income', label: 'Income', color: COLORS.income, value: (row) => row.income || 0 },
      { key: 'spend', label: 'Spend', color: COLORS.spend, value: (row) => 0 - (row.operatingExpense || 0) },
      { key: 'savings', label: 'Savings moved', color: COLORS.savings, value: (row) => 0 - (row.savingsContribution || 0) },
    ];
    const values = visibleRows.flatMap((row) => [
      row.income || 0,
      0 - (row.operatingExpense || 0),
      0 - (row.savingsContribution || 0),
      row.economicNet || 0,
    ]);
    const domain = extentWithPadding(values);
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const x = d3.scaleBand().domain(labels).range([margin.left, width - margin.right]).padding(0.2);
    const subX = d3.scaleBand().domain(barSeries.map((item) => item.key)).range([0, x.bandwidth()]).padding(0.18);
    const y = d3.scaleLinear().domain(domain).nice().range([height - margin.bottom, margin.top]);

    drawGrid(svg, y, margin, width, height);

    const monthGroups = svg.selectAll('.economic-month-bars')
      .data(visibleRows)
      .enter()
      .append('g')
      .attr('class', 'economic-month-bars')
      .attr('transform', (row) => `translate(${x(row.label)},0)`);

    monthGroups.selectAll('rect')
      .data((row) => barSeries.map((item) => ({
        key: item.key,
        label: item.label,
        value: item.value(row),
        color: item.color,
      })))
      .enter()
      .append('rect')
      .attr('x', (item) => subX(item.key))
      .attr('y', (item) => y(Math.max(0, item.value)))
      .attr('width', subX.bandwidth())
      .attr('height', (item) => Math.abs(y(item.value) - y(0)))
      .attr('fill', (item) => item.color)
      .append('title')
      .text((item) => `${item.label}: ${formatJpy(item.value)}`);

    const line = d3.line()
      .x((row) => (x(row.label) || 0) + (x.bandwidth() / 2))
      .y((row) => y(row.economicNet || 0));
    svg.append('path')
      .datum(visibleRows)
      .attr('fill', 'none')
      .attr('stroke', COLORS.net)
      .attr('stroke-width', 2)
      .attr('d', line);

    svg.append('g')
      .attr('transform', `translate(0,${y(0)})`)
      .attr('color', COLORS.grid)
      .call(d3.axisBottom(x).tickSize(0).tickFormat(''));

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', COLORS.text)
      .call(d3.axisBottom(x).tickValues(compactTicks(labels)));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', COLORS.text)
      .call(d3.axisLeft(y).ticks(5).tickFormat(shortJpy));

    renderLegend(container, [
      ['Income', COLORS.income],
      ['Spend', COLORS.spend],
      ['Savings moved', COLORS.savings],
      ['Net result', COLORS.net],
    ]);
  }

  function renderGroupSpendChart(rows) {
    const container = document.getElementById('economicGroupSpendChart');
    if (!container) return;
    container.innerHTML = '';
    const topRows = rows
      .filter((row) => Number(row.operatingExpense || 0) > 0)
      .slice()
      .sort((a, b) => Number(b.operatingExpense || 0) - Number(a.operatingExpense || 0))
      .slice(0, 10);
    if (!topRows.length || typeof d3 === 'undefined') {
      renderEmpty(container, 'No operating spend by group.');
      return;
    }

    const width = container.clientWidth || 520;
    const height = Math.max(230, topRows.length * 34 + 46);
    const margin = { top: 10, right: 22, bottom: 30, left: 150 };
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const labels = topRows.map((row) => row.groupName);
    const maxValue = d3.max(topRows, (row) => Number(row.operatingExpense || 0)) || 0;
    const x = d3.scaleLinear().domain([0, maxValue * 1.12]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(labels).range([margin.top, height - margin.bottom]).padding(0.26);

    svg.selectAll('.economic-group-bar')
      .data(topRows)
      .enter()
      .append('rect')
      .attr('class', 'economic-group-bar')
      .attr('x', margin.left)
      .attr('y', (row) => y(row.groupName))
      .attr('width', (row) => Math.max(0, x(row.operatingExpense || 0) - margin.left))
      .attr('height', y.bandwidth())
      .attr('fill', COLORS.spend)
      .append('title')
      .text((row) => `${row.groupName}: ${formatJpy(row.operatingExpense)}`);

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', COLORS.text)
      .call(d3.axisLeft(y));

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', COLORS.text)
      .call(d3.axisBottom(x).ticks(4).tickFormat(shortJpy));
  }

  function renderInterestImpactChart(externalAssets) {
    const container = document.getElementById('interestImpactChart');
    if (!container) return;
    container.innerHTML = '';
    const impact = externalAssets.interestImpact || {};
    const horizons = impact.horizons || [];
    const scenarios = (impact.scenarios || []).filter((scenario) => scenario.key !== 'zero');
    if (!horizons.length || !scenarios.length || typeof d3 === 'undefined') {
      renderEmpty(container, 'No interest scenarios available.');
      return;
    }

    const width = container.clientWidth || 620;
    const height = 300;
    const margin = { top: 18, right: 18, bottom: 42, left: 72 };
    const labels = horizons.map((horizon) => horizon.label);
    const scenarioKeys = scenarios.map((scenario) => scenario.key);
    const values = scenarios.flatMap((scenario) => horizons.map((horizon) => {
      const row = (scenario.horizons || []).find((item) => item.key === horizon.key);
      return row ? Number(row.extraVsZeroJpy || 0) : 0;
    }));
    const maxValue = Math.max(1, d3.max(values) || 0);
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const x = d3.scaleBand().domain(labels).range([margin.left, width - margin.right]).padding(0.22);
    const subX = d3.scaleBand().domain(scenarioKeys).range([0, x.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear().domain([0, maxValue * 1.15]).nice().range([height - margin.bottom, margin.top]);
    const color = d3.scaleOrdinal()
      .domain(scenarioKeys)
      .range(['#54d7a5', '#f6bd60', '#9ad7ff', '#f08a8a', '#ffffff']);

    drawGrid(svg, y, margin, width, height);

    const horizonGroups = svg.selectAll('.interest-horizon')
      .data(horizons)
      .enter()
      .append('g')
      .attr('class', 'interest-horizon')
      .attr('transform', (horizon) => `translate(${x(horizon.label)},0)`);

    horizonGroups.selectAll('rect')
      .data((horizon) => scenarios.map((scenario) => {
        const row = (scenario.horizons || []).find((item) => item.key === horizon.key);
        return {
          key: scenario.key,
          label: scenario.label,
          value: row ? Number(row.extraVsZeroJpy || 0) : 0,
        };
      }))
      .enter()
      .append('rect')
      .attr('x', (item) => subX(item.key))
      .attr('y', (item) => y(item.value))
      .attr('width', subX.bandwidth())
      .attr('height', (item) => y(0) - y(item.value))
      .attr('fill', (item) => color(item.key))
      .append('title')
      .text((item) => `${item.label}: ${formatJpy(item.value)}`);

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', COLORS.text)
      .call(d3.axisBottom(x));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', COLORS.text)
      .call(d3.axisLeft(y).ticks(5).tickFormat(shortJpy));

    renderLegend(container, scenarios.map((scenario) => [scenario.label, color(scenario.key)]));
  }

  function drawGrid(svg, y, margin, width, height) {
    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', COLORS.grid)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(width - margin.left - margin.right)).tickFormat(''));
    svg.selectAll('.tick line').attr('stroke-opacity', 0.3);
    svg.append('line')
      .attr('x1', margin.left)
      .attr('x2', width - margin.right)
      .attr('y1', y(0))
      .attr('y2', y(0))
      .attr('stroke', COLORS.grid)
      .attr('stroke-width', 1.3);
    svg.attr('viewBox', `0 0 ${width} ${height}`);
  }

  function extentWithPadding(values) {
    const finite = values.filter((value) => Number.isFinite(Number(value))).map(Number);
    if (!finite.length) return [-1, 1];
    let min = Math.min(...finite, 0);
    let max = Math.max(...finite, 0);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const padding = (max - min) * 0.12;
    return [min - padding, max + padding];
  }

  function compactTicks(labels) {
    if (labels.length <= 8) return labels;
    const step = Math.ceil(labels.length / 8);
    return labels.filter((_, index) => index % step === 0 || index === labels.length - 1);
  }

  function shortJpy(value) {
    const absolute = Math.abs(Number(value || 0));
    const sign = Number(value || 0) < 0 ? '-' : '';
    if (absolute >= 1000000) return `${sign}${Math.round(absolute / 1000000)}m`;
    return `${sign}${Math.round(absolute / 1000)}k`;
  }

  function formatJpy(value) {
    const number = Number(value || 0);
    const sign = number < 0 ? '-' : '';
    return `${sign}${Math.round(Math.abs(number)).toLocaleString()} JPY`;
  }

  function renderLegend(container, entries) {
    const legend = document.createElement('div');
    legend.className = 'business-chart-legend';
    entries.forEach(([label, color]) => {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.backgroundColor = color;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(label));
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  function renderEmpty(container, text) {
    const p = document.createElement('p');
    p.className = 'muted-text';
    p.textContent = text;
    container.appendChild(p);
  }
})();
