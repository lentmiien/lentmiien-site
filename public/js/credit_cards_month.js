(() => {
  const pageData = window.creditCardMonthPage || {};
  const currencyFormatter = new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  });

  const state = {
    activeCardId: pageData.activeCardId || (pageData.cards && pageData.cards[0] ? pageData.cards[0].id : null),
    year: Number(pageData.year),
    month: Number(pageData.month),
    navigation: {
      previous: null,
      next: null,
    },
  };

  const elements = {
    monthTitle: document.getElementById('monthTitle'),
    cardSelect: document.getElementById('cardSelectMonth'),
    prevBtn: document.getElementById('prevMonthBtn'),
    nextBtn: document.getElementById('nextMonthBtn'),
    runningChart: document.getElementById('runningChart'),
    summaryLimit: document.getElementById('summaryLimit'),
    summaryStarting: document.getElementById('summaryStarting'),
    summaryStartingPercent: document.getElementById('summaryStartingPercent'),
    summaryClosing: document.getElementById('summaryClosing'),
    summaryClosingPercent: document.getElementById('summaryClosingPercent'),
    summaryUsage: document.getElementById('summaryUsage'),
    summaryUsagePercent: document.getElementById('summaryUsagePercent'),
    summaryRepay: document.getElementById('summaryRepay'),
    summaryRepayPercent: document.getElementById('summaryRepayPercent'),
    summaryNet: document.getElementById('summaryNet'),
    summaryNetPercent: document.getElementById('summaryNetPercent'),
    summaryPoints: document.getElementById('summaryPoints'),
    summaryPeak: document.getElementById('summaryPeak'),
    summaryPeakPercent: document.getElementById('summaryPeakPercent'),
    summaryPeakDate: document.getElementById('summaryPeakDate'),
    comparisonBlock: document.getElementById('comparisonBlock'),
    comparisonBody: document.querySelector('#comparisonBlock .comparison-card__body'),
    updatedAtInfo: document.getElementById('updatedAtInfo'),
    backToDashboard: document.getElementById('backToDashboard'),
  };

  document.addEventListener('DOMContentLoaded', initialize);

  function initialize() {
    if (elements.cardSelect) {
      elements.cardSelect.addEventListener('change', () => {
        state.activeCardId = elements.cardSelect.value;
        loadMonthData();
      });
    }
    if (elements.prevBtn) {
      elements.prevBtn.addEventListener('click', () => {
        if (!state.navigation.previous) return;
        ({ year: state.year, month: state.month } = state.navigation.previous);
        loadMonthData(true);
      });
    }
    if (elements.nextBtn) {
      elements.nextBtn.addEventListener('click', () => {
        if (!state.navigation.next) return;
        ({ year: state.year, month: state.month } = state.navigation.next);
        loadMonthData(true);
      });
    }
    if (elements.backToDashboard && state.activeCardId) {
      const dashUrl = new URL(pageData.routes.dashboard, window.location.origin);
      dashUrl.searchParams.set('cardId', state.activeCardId);
      elements.backToDashboard.setAttribute('href', dashUrl.toString());
    }

    if (state.year && state.month) {
      loadMonthData();
    }
  }

  async function loadMonthData(updateHistory = false) {
    const endpoint = `${pageData.routes.monthData}/${state.year}/${String(state.month).padStart(2, '0')}`;
    const url = new URL(endpoint, window.location.origin);
    if (state.activeCardId) {
      url.searchParams.set('cardId', state.activeCardId);
    }
    try {
      const data = await fetchJson(url.toString());
      renderMonth(data);
      state.navigation = data.navigation || { previous: null, next: null };
      updateNavButtons();
      updateHeader(data);
      if (updateHistory) {
        updateUrl();
      } else {
        replaceUrl();
      }
    } catch (error) {
      if (elements.updatedAtInfo) {
        elements.updatedAtInfo.textContent = error.message;
        elements.updatedAtInfo.classList.add('inline-feedback--error');
      }
    }
  }

  function renderMonth(data) {
    if (!data || !data.summary) return;
    const summary = data.summary;

    if (elements.summaryLimit) elements.summaryLimit.textContent = formatCurrency(summary.creditLimit);
    setAmountWithPercent(elements.summaryStarting, summary.startingBalance, elements.summaryStartingPercent, summary.startingBalancePercent);
    setAmountWithPercent(elements.summaryClosing, summary.closingBalance, elements.summaryClosingPercent, summary.closingBalancePercent);
    setAmountWithPercent(elements.summaryUsage, summary.usageTotal, elements.summaryUsagePercent, summary.usagePercent);
    setAmountWithPercent(elements.summaryRepay, summary.repaymentTotal, elements.summaryRepayPercent, summary.repaymentPercent);
    setAmountWithPercent(elements.summaryNet, summary.netChange, elements.summaryNetPercent, summary.netPercent);
    if (elements.summaryPoints) elements.summaryPoints.textContent = `${Math.round(summary.externalPoints)} pts`;
    setAmountWithPercent(elements.summaryPeak, summary.peakBalance, elements.summaryPeakPercent, summary.peakBalancePercent);
    if (elements.summaryPeakDate) {
      elements.summaryPeakDate.textContent = summary.peakBalanceDate
        ? new Date(summary.peakBalanceDate).toLocaleString()
        : "--";
    }

    renderRunningChart(data.dailySeries || []);
    renderComparison(data.comparison);

    if (elements.updatedAtInfo) {
      if (summary.confirmed && summary.confirmedAt) {
        const date = new Date(summary.confirmedAt);
        elements.updatedAtInfo.textContent = `Confirmed ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        elements.updatedAtInfo.classList.remove("inline-feedback--error");
      } else {
        elements.updatedAtInfo.textContent = "Not confirmed yet - values are calculated from current transactions.";
        elements.updatedAtInfo.classList.remove("inline-feedback--error");
      }
    }
  }
  function renderRunningChart(series) {
    if (!elements.runningChart) return;
    const svg = d3.select(elements.runningChart);
    svg.selectAll('*').remove();

    if (!series || series.length === 0) {
      svg.append('text')
        .attr('x', '50%')
        .attr('y', '50%')
        .attr('text-anchor', 'middle')
        .attr('fill', '#6b7280')
        .text('No data for this month');
      return;
    }

    const width = elements.runningChart.clientWidth || 680;
    const height = 360;
    const margin = { top: 20, right: 30, bottom: 40, left: 60 };

    svg.attr('width', width).attr('height', height);

    const parseDate = (value) => new Date(value);
    const dates = series.map((d) => parseDate(d.date));
    const values = series.map((d) => d.runningTotal);

    const x = d3.scaleTime()
      .domain(d3.extent(dates))
      .range([margin.left, width - margin.right]);

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const padding = Math.max((maxValue - minValue) * 0.1, 1);

    const y = d3.scaleLinear()
      .domain([minValue - padding, maxValue + padding])
      .range([height - margin.bottom, margin.top]);

    const xAxis = d3.axisBottom(x).ticks(6).tickFormat((d) => {
      const date = new Date(d);
      return `${date.getUTCDate()}`;
    });
    const yAxis = d3.axisLeft(y).ticks(6).tickFormat((d) => currencyFormatter.format(d));

    svg.append('g')
      .attr('transform', `translate(0, ${height - margin.bottom})`)
      .call(xAxis)
      .selectAll('text')
      .attr('font-size', 12);

    svg.append('g')
      .attr('transform', `translate(${margin.left}, 0)`)
      .call(yAxis)
      .selectAll('text')
      .attr('font-size', 12);

    const line = d3.line()
      .x((d) => x(parseDate(d.date)))
      .y((d) => y(d.runningTotal))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', '#2563eb')
      .attr('stroke-width', 2.5)
      .attr('d', line);

    svg.selectAll('.point')
      .data(series)
      .enter()
      .append('circle')
      .attr('class', 'point')
      .attr('cx', (d) => x(parseDate(d.date)))
      .attr('cy', (d) => y(d.runningTotal))
      .attr('r', 4)
      .attr('fill', '#2563eb')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);
  }

  function renderComparison(comparison) {
    if (!elements.comparisonBody || !elements.comparisonBlock) return;
    elements.comparisonBody.innerHTML = '';
    if (!comparison || !comparison.previous) {
      elements.comparisonBody.innerHTML = '<p class="inline-feedback">No data for the previous month.</p>';
      return;
    }
    const rows = [
      {
        label: 'Usage',
        previous: comparison.previous.usageTotal,
        delta: comparison.deltas.usageTotal,
      },
      {
        label: 'Repayments',
        previous: comparison.previous.repaymentTotal,
        delta: comparison.deltas.repaymentTotal,
      },
      {
        label: 'Net change',
        previous: comparison.previous.netChange,
        delta: comparison.deltas.netChange,
      },
      {
        label: 'Points',
        previous: comparison.previous.externalPoints,
        delta: comparison.deltas.externalPoints,
        suffix: ' pts',
      },
      {
        label: 'Closing balance',
        previous: comparison.previous.closingBalance,
        delta: comparison.deltas.closingBalance,
      },
    ];

    rows.forEach((row) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'comparison-card__row';
      const previousValue = row.suffix
        ? `${formatNumber(row.previous)}${row.suffix}`
        : formatCurrency(row.previous);
      const deltaClass = row.delta > 0
        ? 'comparison-card__delta comparison-card__delta--up'
        : row.delta < 0
          ? 'comparison-card__delta comparison-card__delta--down'
          : 'comparison-card__delta';
      const deltaLabel = row.suffix
        ? `${row.delta > 0 ? '+' : ''}${formatNumber(row.delta)}${row.suffix}`
        : `${row.delta > 0 ? '+' : ''}${formatCurrency(row.delta)}`;

      wrapper.innerHTML = `
        <span>${row.label}<br><small>${previousValue} previous</small></span>
        <span class="${deltaClass}">${deltaLabel}</span>
      `;
      elements.comparisonBody.appendChild(wrapper);
    });
  }

  function updateNavButtons() {
    if (!elements.prevBtn || !elements.nextBtn) return;
    elements.prevBtn.disabled = !state.navigation.previous;
    elements.nextBtn.disabled = !state.navigation.next;
  }

  function updateHeader(data) {
    if (!elements.monthTitle) return;
    const label = new Date(Date.UTC(data.summary.year, data.summary.month - 1, 1));
    const monthLabel = label.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
    const cardName = data.card ? data.card.name : '';
    elements.monthTitle.textContent = cardName ? `${monthLabel} - ${cardName}` : monthLabel;
    if (elements.cardSelect && state.activeCardId) {
      elements.cardSelect.value = state.activeCardId;
    }
    if (elements.backToDashboard && state.activeCardId) {
      const dashUrl = new URL(pageData.routes.dashboard, window.location.origin);
      dashUrl.searchParams.set('cardId', state.activeCardId);
      elements.backToDashboard.setAttribute('href', dashUrl.toString());
    }
  }

  function updateUrl() {
    const monthPath = `${pageData.routes.monthViewBase}/${state.year}/${String(state.month).padStart(2, '0')}`;
    const url = new URL(monthPath, window.location.origin);
    if (state.activeCardId) {
      url.searchParams.set('cardId', state.activeCardId);
    }
    window.history.pushState({}, '', url.pathname + url.search);
  }

  function replaceUrl() {
    const monthPath = `${pageData.routes.monthViewBase}/${state.year}/${String(state.month).padStart(2, '0')}`;
    const url = new URL(monthPath, window.location.origin);
    if (state.activeCardId) {
      url.searchParams.set('cardId', state.activeCardId);
    }
    window.history.replaceState({}, '', url.pathname + url.search);
  }

  function setAmountWithPercent(amountElement, amount, percentElement, percentValue) {
    if (amountElement) {
      amountElement.textContent = formatCurrency(amount);
    }
    if (percentElement) {
      percentElement.textContent = formatPercent(percentValue);
    }
  }

  function formatPercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '--';
    const rounded = Math.round(numeric * 10) / 10;
    return `${rounded}%`;
  }

  function formatCurrency(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '--';
    }
    return currencyFormatter.format(Number(value));
  }

  function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
      let message = 'Request failed';
      try {
        const data = await response.json();
        if (data && data.error) message = data.error;
      } catch (error) {
        message = response.statusText || message;
      }
      throw new Error(message);
    }
    return response.json();
  }
})();
