(() => {
  const state = window.accountingState || {};
  const CATEGORY_BAR_COLOR = '#3f8bfd';
  const CREDIT_CARD_PORTION_COLOR = '#f6bd60';
  const CREDIT_LABEL_LIMIT = 8;

  document.addEventListener('DOMContentLoaded', () => {
    updateHero();
    renderCashflow(state.budget?.monthlyTrend || []);
    renderCategories(state.budget?.topCategories || []);
    renderCreditCardLabels(state.credit?.overview?.currentMonthTransactions || []);
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
          li.className = 'd-flex flex-column py-1';
          li.innerHTML = `<div class="d-flex justify-content-between"><span>${cat.label}</span><strong>${formatCurrency(cat.total)}</strong></div>`;
          if (cat.creditCardPortion?.amount) {
            const note = document.createElement('small');
            note.className = 'text-warning text-end';
            note.textContent = `${cat.creditCardPortion.business || 'Credit Card'}: ${formatCurrency(cat.creditCardPortion.amount)}`;
            li.appendChild(note);
          }
          list.appendChild(li);
        });
      }
    }

    if (!chart) return;
    chart.innerHTML = '';
    if (!categories.length || typeof d3 === 'undefined') {
      const fallback = document.createElement('p');
      fallback.className = 'muted-text';
      fallback.textContent = 'Category chart will render once data is available.';
      chart.appendChild(fallback);
      return;
    }

    const stackedData = categories.map((cat) => {
      const total = Number(cat.total) || 0;
      const highlight = Math.max(0, Math.min(total, Number(cat.creditCardPortion?.amount) || 0));
      const remainder = Math.max(0, total - highlight);
      const segments = [];
      if (highlight > 0) {
        segments.push({ type: 'credit', value: highlight });
      }
      if (remainder > 0 || segments.length === 0) {
        segments.push({ type: 'base', value: segments.length === 0 ? total : remainder });
      }
      return { ...cat, total, segments };
    });

    const width = chart.clientWidth || 320;
    const height = 220;
    const margin = { top: 10, right: 16, bottom: 20, left: 140 };
    const svg = d3.select(chart)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const maxTotal = d3.max(stackedData, (d) => d.total) || 0;
    const xMax = maxTotal > 0 ? maxTotal * 1.1 : 1;
    const x = d3.scaleLinear()
      .domain([0, xMax])
      .range([margin.left, width - margin.right]);
    const y = d3.scaleBand()
      .domain(stackedData.map((d) => d.label))
      .range([margin.top, height - margin.bottom])
      .padding(0.3);

    const bars = svg.selectAll('.cat-bar')
      .data(stackedData)
      .enter()
      .append('g')
      .attr('class', 'cat-bar');

    bars.each(function drawStack(cat) {
      let cursor = 0;
      cat.segments.forEach((segment) => {
        if (!segment.value) return;
        const start = x(cursor);
        const end = x(cursor + segment.value);
        d3.select(this)
          .append('rect')
          .attr('x', start)
          .attr('y', y(cat.label))
          .attr('width', Math.max(0, end - start))
          .attr('height', y.bandwidth())
          .attr('fill', segment.type === 'credit' ? CREDIT_CARD_PORTION_COLOR : CATEGORY_BAR_COLOR);
        cursor += segment.value;
      });
      if (cursor === 0) {
        d3.select(this)
          .append('rect')
          .attr('x', margin.left)
          .attr('y', y(cat.label))
          .attr('width', 0)
          .attr('height', y.bandwidth())
          .attr('fill', CATEGORY_BAR_COLOR);
      }
    });

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', 'rgba(255,255,255,0.6)')
      .call(d3.axisLeft(y));
    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', 'rgba(255,255,255,0.6)')
      .call(d3.axisBottom(x).ticks(4).tickFormat((val) => `${Math.round(val / 1000)}k`));
  }

  function renderCreditCardLabels(transactions) {
    const container = document.getElementById('creditCardLabelChart');
    if (!container) return;
    container.innerHTML = '';

    if (typeof d3 === 'undefined') {
      const fallback = document.createElement('p');
      fallback.className = 'muted-text';
      fallback.textContent = 'Charts require D3 to load.';
      container.appendChild(fallback);
      return;
    }

    const labelsData = aggregateCreditCardLabels(transactions).slice(0, CREDIT_LABEL_LIMIT);
    if (!labelsData.length) {
      const fallback = document.createElement('p');
      fallback.className = 'muted-text';
      fallback.textContent = 'No credit card activity recorded for the current month.';
      container.appendChild(fallback);
      return;
    }

    const width = container.clientWidth || 320;
    const margin = { top: 10, right: 16, bottom: 24, left: 160 };
    const height = Math.max(160, margin.top + margin.bottom + labelsData.length * 32);
    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const maxTotal = d3.max(labelsData, (d) => d.total) || 0;
    const xMax = maxTotal > 0 ? maxTotal * 1.1 : 1;
    const x = d3.scaleLinear()
      .domain([0, xMax])
      .range([margin.left, width - margin.right]);
    const y = d3.scaleBand()
      .domain(labelsData.map((d) => d.label))
      .range([margin.top, height - margin.bottom])
      .padding(0.3);

    svg.selectAll('.credit-label-bar')
      .data(labelsData)
      .enter()
      .append('rect')
      .attr('class', 'credit-label-bar')
      .attr('x', margin.left)
      .attr('y', (d) => y(d.label))
      .attr('width', (d) => x(d.total) - margin.left)
      .attr('height', y.bandwidth())
      .attr('fill', CREDIT_CARD_PORTION_COLOR);

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

  function aggregateCreditCardLabels(transactions) {
    if (!Array.isArray(transactions)) return [];
    const totals = new Map();
    transactions.forEach((tx) => {
      if (!tx) return;
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      const label = (tx.label || 'Unlabelled').trim() || 'Unlabelled';
      totals.set(label, (totals.get(label) || 0) + amount);
    });
    return Array.from(totals.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total);
  }

  function formatCurrency(value) {
    if (!Number.isFinite(Number(value))) return '--';
    return Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
})();
