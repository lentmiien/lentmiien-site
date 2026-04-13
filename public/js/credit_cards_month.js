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
    transactionPush: {
      allowed: false,
      reason: null,
      target: null,
      targetDate: null,
    },
    selectedTransactionIds: new Set(),
    pushInFlight: false,
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
    transactionsBody: document.getElementById('monthTransactionsBody'),
    transactionsDescription: document.getElementById('transactionsDescription'),
    transactionsFeedback: document.getElementById('transactionsFeedback'),
    transactionPushControls: document.getElementById('transactionPushControls'),
    transactionSelectHeader: document.getElementById('transactionSelectHeader'),
    selectAllTransactions: document.getElementById('selectAllTransactions'),
    pushTransactionsBtn: document.getElementById('pushTransactionsBtn'),
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
    if (elements.transactionsBody) {
      elements.transactionsBody.addEventListener('change', handleTransactionSelectionChange);
    }
    if (elements.selectAllTransactions) {
      elements.selectAllTransactions.addEventListener('change', toggleSelectAllTransactions);
    }
    if (elements.pushTransactionsBtn) {
      elements.pushTransactionsBtn.addEventListener('click', pushSelectedTransactions);
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
    showTransactionsFeedback('');
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
    state.transactionPush = {
      allowed: Boolean(data.transactionPush && data.transactionPush.allowed),
      reason: data.transactionPush ? data.transactionPush.reason : null,
      target: data.transactionPush ? data.transactionPush.target : null,
      targetDate: data.transactionPush ? data.transactionPush.targetDate : null,
    };
    state.selectedTransactionIds.clear();

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
    renderTransactionPushControls(summary);
    renderTransactions(data.transactions || []);

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

  function renderTransactions(transactions) {
    if (!elements.transactionsBody) return;

    const monthTransactions = Array.isArray(transactions)
      ? transactions.slice().sort((left, right) => {
        const transactionDateDiff = getTimeValue(right.transactionDate) - getTimeValue(left.transactionDate);
        if (transactionDateDiff !== 0) return transactionDateDiff;
        return getTimeValue(right.createdAt) - getTimeValue(left.createdAt);
      })
      : [];

    elements.transactionsBody.innerHTML = '';

    if (monthTransactions.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `<td colspan="${getTransactionTableColumnCount()}" class="inline-feedback">No transactions recorded for this month.</td>`;
      elements.transactionsBody.appendChild(emptyRow);
      syncTransactionSelectionState();
      return;
    }

    monthTransactions.forEach((tx) => {
      const row = document.createElement('tr');
      const amountClass = tx.amount >= 0 ? 'credit-table__amount--positive' : 'credit-table__amount--negative';
      const externalBadge = tx.external
        ? '<span class="credit-table__external">External</span>'
        : '–';
      const multiplier = tx.external ? formatNumber(tx.externalMultiplier || 0) : '0';
      const createdLabel = tx.createdAt
        ? new Date(tx.createdAt).toLocaleString()
        : '–';
      const selectionCell = state.transactionPush.allowed
        ? `<td class="credit-table__selection"><input class="js-transaction-select" type="checkbox" data-id="${tx.id}" aria-label="Select ${escapeHtml(tx.label || 'transaction')}"></td>`
        : '';

      row.innerHTML = `
        ${selectionCell}
        <td>${formatDate(tx.transactionDate)}</td>
        <td>${escapeHtml(tx.label || '')}</td>
        <td class="credit-table__amount ${amountClass}">${formatCurrency(tx.amount)}</td>
        <td>${externalBadge}</td>
        <td>${multiplier}</td>
        <td>${createdLabel}</td>
      `;
      elements.transactionsBody.appendChild(row);
    });

    syncTransactionSelectionState();
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

  function renderTransactionPushControls(summary) {
    const pushState = state.transactionPush || {};
    const allowed = Boolean(pushState.allowed);
    const targetDateLabel = pushState.targetDate ? formatDate(pushState.targetDate) : 'the first day of next month';
    const defaultDescription = 'All transactions recorded for the selected month.';
    const pushDescription = `Select end-of-month transactions that should be moved to ${targetDateLabel}.`;
    const blockedDescription = pushState.reason || defaultDescription;

    if (elements.transactionsDescription) {
      elements.transactionsDescription.textContent = allowed
        ? pushDescription
        : (!summary.confirmed && pushState.reason ? blockedDescription : defaultDescription);
    }
    if (elements.transactionPushControls) {
      elements.transactionPushControls.classList.toggle('hidden', !allowed);
    }
    if (elements.transactionSelectHeader) {
      elements.transactionSelectHeader.classList.toggle('hidden', !allowed);
    }
    if (elements.selectAllTransactions) {
      elements.selectAllTransactions.checked = false;
      elements.selectAllTransactions.indeterminate = false;
      elements.selectAllTransactions.disabled = !allowed;
    }

    syncTransactionSelectionState();
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

  function handleTransactionSelectionChange(event) {
    const checkbox = event.target.closest('.js-transaction-select');
    if (!checkbox) return;
    const { id } = checkbox.dataset;
    if (!id) return;
    if (checkbox.checked) {
      state.selectedTransactionIds.add(id);
    } else {
      state.selectedTransactionIds.delete(id);
    }
    syncTransactionSelectionState();
  }

  function toggleSelectAllTransactions() {
    if (!elements.transactionsBody || !elements.selectAllTransactions) return;
    const shouldSelect = elements.selectAllTransactions.checked;
    const checkboxes = elements.transactionsBody.querySelectorAll('.js-transaction-select');
    checkboxes.forEach((checkbox) => {
      checkbox.checked = shouldSelect;
      const { id } = checkbox.dataset;
      if (!id) return;
      if (shouldSelect) {
        state.selectedTransactionIds.add(id);
      } else {
        state.selectedTransactionIds.delete(id);
      }
    });
    syncTransactionSelectionState();
  }

  function syncTransactionSelectionState() {
    const checkboxes = elements.transactionsBody
      ? Array.from(elements.transactionsBody.querySelectorAll('.js-transaction-select'))
      : [];
    const validIds = new Set(checkboxes.map((checkbox) => checkbox.dataset.id).filter(Boolean));
    state.selectedTransactionIds.forEach((id) => {
      if (!validIds.has(id)) {
        state.selectedTransactionIds.delete(id);
      }
    });

    let selectedCount = 0;
    checkboxes.forEach((checkbox) => {
      const { id } = checkbox.dataset;
      const checked = Boolean(id && state.selectedTransactionIds.has(id));
      checkbox.checked = checked;
      if (checked) selectedCount += 1;
    });

    if (elements.selectAllTransactions) {
      elements.selectAllTransactions.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
      elements.selectAllTransactions.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
    }
    if (elements.pushTransactionsBtn) {
      const targetDateLabel = state.transactionPush && state.transactionPush.targetDate
        ? formatDate(state.transactionPush.targetDate)
        : 'next month';
      elements.pushTransactionsBtn.textContent = state.pushInFlight
        ? 'Pushing...'
        : `Push selected to ${targetDateLabel}`;
      elements.pushTransactionsBtn.disabled = !state.transactionPush.allowed || state.pushInFlight || selectedCount === 0;
    }
  }

  async function pushSelectedTransactions() {
    const selectedIds = Array.from(state.selectedTransactionIds);
    if (!selectedIds.length) {
      showTransactionsFeedback('Select at least one transaction to push.', true);
      return;
    }

    const targetDateLabel = state.transactionPush && state.transactionPush.targetDate
      ? formatDate(state.transactionPush.targetDate)
      : 'the first day of next month';
    if (!window.confirm(`Push ${selectedIds.length} selected transaction${selectedIds.length === 1 ? '' : 's'} to ${targetDateLabel}?`)) {
      return;
    }

    const endpoint = `${pageData.routes.monthData}/${state.year}/${String(state.month).padStart(2, '0')}/push-to-next`;
    state.pushInFlight = true;
    syncTransactionSelectionState();
    showTransactionsFeedback('');

    try {
      const result = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId: state.activeCardId,
          transactionIds: selectedIds,
        }),
      });
      await loadMonthData();
      showTransactionsFeedback(
        `Moved ${result.moved} transaction${result.moved === 1 ? '' : 's'} to ${formatDate(result.targetDate)}.`,
      );
    } catch (error) {
      showTransactionsFeedback(error.message, true);
    } finally {
      state.pushInFlight = false;
      syncTransactionSelectionState();
    }
  }

  function getTransactionTableColumnCount() {
    return state.transactionPush.allowed ? 7 : 6;
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

  function formatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toISOString().slice(0, 10);
  }

  function getTimeValue(value) {
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (match) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[match]));
  }

  function showTransactionsFeedback(message, isError = false) {
    if (!elements.transactionsFeedback) return;
    elements.transactionsFeedback.textContent = message || '';
    elements.transactionsFeedback.classList.toggle('hidden', !message);
    elements.transactionsFeedback.classList.toggle('inline-feedback--error', Boolean(message) && isError);
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
