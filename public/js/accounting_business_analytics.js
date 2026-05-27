(() => {
  const state = window.businessAnalyticsState || {};
  const analytics = state.analytics || {};
  const COLORS = {
    budget: '#3f8bfd',
    credit: '#f6bd60',
    income: '#54d7a5',
    text: 'rgba(255,255,255,0.68)',
  };

  document.addEventListener('DOMContentLoaded', () => {
    bindScopeSelect();
    bindGroupEditors();
    renderMonthlyChart(analytics.monthly || []);
    renderYearlyChart(analytics.yearly || []);
    renderBusinessBreakdown(analytics.businessBreakdown || []);
  });

  function bindScopeSelect() {
    const scope = document.getElementById('businessAnalyticsScope');
    const value = document.getElementById('businessAnalyticsValue');
    if (!scope || !value) return;
    const syncList = () => {
      value.setAttribute('list', scope.value === 'group' ? 'businessGroupOptions' : 'businessNameOptions');
    };
    scope.addEventListener('change', syncList);
    syncList();
  }

  function bindGroupEditors() {
    const feedback = document.getElementById('businessGroupFeedback');
    document.querySelectorAll('.business-group-save').forEach((button) => {
      button.addEventListener('click', async () => {
        const row = button.closest('tr');
        const input = row ? row.querySelector('.business-group-input') : null;
        const mappingId = button.dataset.mappingId;
        if (!mappingId || !input) return;
        button.disabled = true;
        setFeedback(feedback, 'Saving...');
        try {
          const response = await fetch(`${state.routes.updateGroup}/${mappingId}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupName: input.value }),
          });
          const payload = await response.json();
          if (!response.ok) {
            throw new Error(payload.error || 'Unable to save group');
          }
          input.value = payload.groupName || 'Other';
          addGroupOption(input.value);
          setFeedback(feedback, `Saved ${payload.name} as ${input.value}.`);
        } catch (error) {
          setFeedback(feedback, error.message);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function renderMonthlyChart(rows) {
    const container = document.getElementById('businessMonthlyChart');
    if (!container) return;
    container.innerHTML = '';
    if (!rows.length || typeof d3 === 'undefined') {
      renderEmpty(container, 'No monthly data available.');
      return;
    }

    const width = container.clientWidth || 640;
    const height = 280;
    const margin = { top: 18, right: 18, bottom: 34, left: 58 };
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const labels = rows.map((row) => row.label);
    const maxValue = d3.max(rows, (row) => Number(row.totalSpend || 0)) || 0;
    const x = d3.scaleBand().domain(labels).range([margin.left, width - margin.right]).padding(0.22);
    const y = d3.scaleLinear()
      .domain([0, Math.max(1, maxValue) * 1.15])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const barGroups = svg.selectAll('.month-bar')
      .data(rows)
      .enter()
      .append('g')
      .attr('class', 'month-bar');

    barGroups.append('rect')
      .attr('x', (row) => x(row.label))
      .attr('y', (row) => y(row.budgetSpend || 0))
      .attr('width', x.bandwidth())
      .attr('height', (row) => y(0) - y(row.budgetSpend || 0))
      .attr('fill', COLORS.budget);

    barGroups.append('rect')
      .attr('x', (row) => x(row.label))
      .attr('y', (row) => y((row.budgetSpend || 0) + (row.creditSpend || 0)))
      .attr('width', x.bandwidth())
      .attr('height', (row) => y(row.budgetSpend || 0) - y((row.budgetSpend || 0) + (row.creditSpend || 0)))
      .attr('fill', COLORS.credit);

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', COLORS.text)
      .call(d3.axisBottom(x).tickValues(compactTicks(labels)));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', COLORS.text)
      .call(d3.axisLeft(y).ticks(5).tickFormat((value) => `${Math.round(value / 1000)}k`));

    renderLegend(container, [
      ['Budget', COLORS.budget],
      ['Credit card', COLORS.credit],
    ]);
  }

  function renderYearlyChart(rows) {
    const container = document.getElementById('businessYearlyChart');
    if (!container) return;
    container.innerHTML = '';
    if (!rows.length || typeof d3 === 'undefined') {
      renderEmpty(container, 'No yearly data available.');
      return;
    }

    const width = container.clientWidth || 460;
    const height = 260;
    const margin = { top: 18, right: 16, bottom: 30, left: 58 };
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const labels = rows.map((row) => row.label);
    const maxValue = d3.max(rows, (row) => Number(row.totalSpend || 0)) || 0;
    const x = d3.scaleBand().domain(labels).range([margin.left, width - margin.right]).padding(0.28);
    const y = d3.scaleLinear()
      .domain([0, Math.max(1, maxValue) * 1.15])
      .nice()
      .range([height - margin.bottom, margin.top]);

    svg.selectAll('.year-bar')
      .data(rows)
      .enter()
      .append('rect')
      .attr('class', 'year-bar')
      .attr('x', (row) => x(row.label))
      .attr('y', (row) => y(row.totalSpend || 0))
      .attr('width', x.bandwidth())
      .attr('height', (row) => y(0) - y(row.totalSpend || 0))
      .attr('fill', COLORS.income);

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', COLORS.text)
      .call(d3.axisBottom(x));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', COLORS.text)
      .call(d3.axisLeft(y).ticks(5).tickFormat((value) => `${Math.round(value / 1000)}k`));
  }

  function renderBusinessBreakdown(rows) {
    const container = document.getElementById('businessBreakdownChart');
    if (!container) return;
    container.innerHTML = '';
    const topRows = rows.slice(0, 10);
    if (!topRows.length || typeof d3 === 'undefined') {
      renderEmpty(container, 'No business breakdown available.');
      return;
    }

    const width = container.clientWidth || 420;
    const height = Math.max(180, topRows.length * 30 + 40);
    const margin = { top: 8, right: 16, bottom: 24, left: 140 };
    const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
    const labels = topRows.map((row) => row.business);
    const maxValue = d3.max(topRows, (row) => Number(row.totalSpend || 0)) || 0;
    const x = d3.scaleLinear().domain([0, Math.max(1, maxValue) * 1.1]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(labels).range([margin.top, height - margin.bottom]).padding(0.26);

    svg.selectAll('.business-bar')
      .data(topRows)
      .enter()
      .append('rect')
      .attr('class', 'business-bar')
      .attr('x', margin.left)
      .attr('y', (row) => y(row.business))
      .attr('width', (row) => x(row.totalSpend || 0) - margin.left)
      .attr('height', y.bandwidth())
      .attr('fill', COLORS.credit);

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', COLORS.text)
      .call(d3.axisLeft(y));

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', COLORS.text)
      .call(d3.axisBottom(x).ticks(4).tickFormat((value) => `${Math.round(value / 1000)}k`));
  }

  function compactTicks(labels) {
    if (labels.length <= 8) return labels;
    const step = Math.ceil(labels.length / 8);
    return labels.filter((_, index) => index % step === 0 || index === labels.length - 1);
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

  function setFeedback(element, text) {
    if (!element) return;
    element.textContent = text;
  }

  function addGroupOption(groupName) {
    const datalist = document.getElementById('businessGroupOptions');
    if (!datalist || !groupName) return;
    const exists = Array.from(datalist.options).some((option) => option.value === groupName);
    if (exists) return;
    const option = document.createElement('option');
    option.value = groupName;
    datalist.appendChild(option);
  }
})();
