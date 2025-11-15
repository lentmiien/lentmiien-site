(() => {
  const state = window.accountingState || {};

  document.addEventListener('DOMContentLoaded', () => {
    updateHero();
    renderCashflow(state.budget?.monthlyTrend || []);
    renderCategories(state.budget?.topCategories || []);
    renderCreditTrend(state.credit?.monthlyTrend || []);
  });

  function updateHero() {
    const spendEl = document.getElementById('metricMonthlySpend');
    if (!spendEl || !state.budget?.cashflow) return;
    const { current, previous } = state.budget.cashflow;
    if (previous === null || previous === undefined) return;
    const delta = current - previous;
    const indicator = delta >= 0 ? '▲' : '▼';
    spendEl.textContent = `${formatCurrency(current)} ${indicator} ${formatCurrency(Math.abs(delta))}`;
  }

  function renderCashflow(trend) {
    const container = document.getElementById('accountingTrendChart');
    if (!container) return;
    container.innerHTML = '';
    if (!trend.length || typeof d3 === 'undefined') {
      const fallback = document.createElement('p');
      fallback.className = 'muted-text';
      fallback.textContent = 'No trend data available yet.';
      container.appendChild(fallback);
      return;
    }
    const width = container.clientWidth || 640;
    const height = 260;
    const margin = { top: 20, right: 24, bottom: 30, left: 48 };
    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const values = trend.map((d) => Number(d.total || 0));
    const labels = trend.map((d) => d.label);
    const x = d3.scaleBand().domain(labels).range([margin.left, width - margin.right]).padding(0.1);
    const y = d3.scaleLinear()
      .domain([0, Math.max(1, d3.max(values)) * 1.15])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const area = d3.area()
      .x((_, i) => x(labels[i]) + x.bandwidth() / 2)
      .y0(y(0))
      .y1((d) => y(d));

    svg.append('path')
      .datum(values)
      .attr('fill', 'rgba(63, 139, 253, 0.25)')
      .attr('stroke', '#3f8bfd')
      .attr('stroke-width', 2)
      .attr('d', area);

    svg.selectAll('.cash-dot')
      .data(values)
      .enter()
      .append('circle')
      .attr('class', 'cash-dot')
      .attr('cx', (_, i) => x(labels[i]) + x.bandwidth() / 2)
      .attr('cy', (d) => y(d))
      .attr('r', 4)
      .attr('fill', '#3f8bfd');

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', 'rgba(255,255,255,0.6)')
      .call(d3.axisBottom(x));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', 'rgba(255,255,255,0.6)')
      .call(d3.axisLeft(y).ticks(5).tickFormat((val) => `${Math.round(val / 1000)}k`));
  }

  function renderCategories(categories) {
    const list = document.getElementById('topCategoriesList');
    const chart = document.getElementById('topCategoriesChart');
    if (list) {
      list.innerHTML = '';
      if (!categories.length) {
        list.innerHTML = '<li class="text-muted">No categories recorded for this period.</li>';
      } else {
        categories.forEach((cat) => {
          const li = document.createElement('li');
          li.className = 'd-flex justify-content-between py-1';
          li.innerHTML = `<span>${cat.label}</span><strong>${formatCurrency(cat.total)}</strong>`;
          list.appendChild(li);
        });
      }
    }

    if (!chart) return;
    chart.innerHTML = '';
    if (!categories.length || typeof d3 === 'undefined') {
      return;
    }
    const width = chart.clientWidth || 320;
    const height = 220;
    const margin = { top: 10, right: 16, bottom: 20, left: 120 };
    const svg = d3.select(chart)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const x = d3.scaleLinear()
      .domain([0, d3.max(categories, (d) => d.total) * 1.1])
      .range([margin.left, width - margin.right]);
    const y = d3.scaleBand()
      .domain(categories.map((d) => d.label))
      .range([margin.top, height - margin.bottom])
      .padding(0.3);

    svg.selectAll('.cat-bar')
      .data(categories)
      .enter()
      .append('rect')
      .attr('class', 'cat-bar')
      .attr('x', margin.left)
      .attr('y', (d) => y(d.label))
      .attr('width', (d) => x(d.total) - margin.left)
      .attr('height', y.bandwidth())
      .attr('fill', '#3f8bfd');

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', 'rgba(255,255,255,0.6)')
      .call(d3.axisLeft(y));
    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', 'rgba(255,255,255,0.6)')
      .call(d3.axisBottom(x).ticks(4).tickFormat((val) => `${Math.round(val / 1000)}k`));
  }

  function renderCreditTrend(trend) {
    const container = document.getElementById('creditUtilizationTrend');
    if (!container) return;
    container.innerHTML = '';
    if (!trend.length || typeof d3 === 'undefined') {
      const fallback = document.createElement('p');
      fallback.className = 'muted-text';
      fallback.textContent = 'Card data will appear after the first month closes.';
      container.appendChild(fallback);
      return;
    }
    const width = container.clientWidth || 420;
    const height = 220;
    const margin = { top: 20, right: 16, bottom: 24, left: 40 };
    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const values = trend.map((d) => Number(d.utilisationPercent ?? 0));
    const labels = trend.map((d) => d.label);
    const x = d3.scalePoint().domain(labels).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, Math.max(100, d3.max(values) || 0)]).range([height - margin.bottom, margin.top]);

    const line = d3.line()
      .x((_, i) => x(labels[i]))
      .y((d) => y(d));

    svg.append('path')
      .datum(values)
      .attr('fill', 'none')
      .attr('stroke', '#54d7a5')
      .attr('stroke-width', 2)
      .attr('d', line);

    svg.selectAll('.util-dot')
      .data(values)
      .enter()
      .append('circle')
      .attr('class', 'util-dot')
      .attr('cx', (_, i) => x(labels[i]))
      .attr('cy', (d) => y(d))
      .attr('r', 4)
      .attr('fill', '#54d7a5');

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', 'rgba(255,255,255,0.6)')
      .call(d3.axisBottom(x));
    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', 'rgba(255,255,255,0.6)')
      .call(d3.axisLeft(y).ticks(5).tickFormat((val) => `${val}%`));
  }

  function formatCurrency(value) {
    if (!Number.isFinite(Number(value))) return '--';
    return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
})();
