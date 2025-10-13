(() => {
  const pageData = window.creditCardPage || {};
  const currencyFormatter = new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  });
  const numberFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  const state = {
    activeCardId: pageData.activeCardId || (pageData.cards && pageData.cards[0] ? pageData.cards[0].id : null),
    overview: null,
  };

  const elements = {
    cardSelect: document.getElementById('cardSelect'),
    monthDetailsLink: document.getElementById('monthDetailsLink'),
    currentBalance: document.getElementById('currentBalance'),
    currentUsage: document.getElementById('currentUsage'),
    currentRepay: document.getElementById('currentRepay'),
    currentPoints: document.getElementById('currentPoints'),
    chartContainer: document.getElementById('usageChart'),
    confirmContainer: document.getElementById('confirmationsContainer'),
    confirmList: document.querySelector('#confirmationsContainer .pending-confirmations__list'),
    transactionsBody: document.getElementById('transactionsBody'),
    labelSuggestions: document.getElementById('labelSuggestions'),
    newTransactionForm: document.getElementById('newTransactionForm'),
    dateInput: document.getElementById('inputDate'),
    labelInput: document.getElementById('inputLabel'),
    amountInput: document.getElementById('inputAmount'),
    externalInput: document.getElementById('inputExternal'),
    multiplierInput: document.getElementById('inputMultiplier'),
    tableFeedback: document.getElementById('tableFeedback'),
    csvForm: document.getElementById('csvUploadForm'),
    csvCardSelect: document.getElementById('csvCardSelect'),
    csvDisabledMessage: document.getElementById('csvDisabledMessage'),
    csvFeedback: document.getElementById('csvFeedback'),
    updateLimitForm: document.getElementById('updateLimitForm'),
    creditLimitInput: document.getElementById('creditLimitInput'),
    limitFeedback: document.getElementById('limitFeedback'),
    newCardForm: document.getElementById('newCardForm'),
    cardFeedback: document.getElementById('cardFeedback'),
  };

  document.addEventListener('DOMContentLoaded', initialize);

  function initialize() {
    if (elements.dateInput) {
      elements.dateInput.value = new Date().toISOString().slice(0, 10);
    }

    if (elements.cardSelect) {
      elements.cardSelect.addEventListener('change', () => {
        state.activeCardId = elements.cardSelect.value;
        syncCreditLimitInput();
        if (elements.limitFeedback) showFeedback(elements.limitFeedback, '');
        loadOverview();
      });
    }

    if (elements.newTransactionForm) {
      elements.newTransactionForm.addEventListener('submit', handleTransactionSubmit);
      if (elements.externalInput && elements.multiplierInput) {
        elements.externalInput.addEventListener('change', () => {
          elements.multiplierInput.disabled = !elements.externalInput.checked;
          if (!elements.externalInput.checked) {
            elements.multiplierInput.value = '0';
          } else if (!elements.multiplierInput.value) {
            elements.multiplierInput.value = '1';
          }
        });
      }
    }

    if (elements.transactionsBody) {
      elements.transactionsBody.addEventListener('click', handleTransactionTableClick);
    }

    if (elements.csvForm) {
      elements.csvForm.addEventListener('submit', handleCsvUpload);
    }

    if (elements.newCardForm) {
      elements.newCardForm.addEventListener('submit', handleNewCard);
    }

    if (elements.updateLimitForm) {
      elements.updateLimitForm.addEventListener('submit', handleUpdateLimit);
    }

    if (elements.multiplierInput && elements.externalInput && !elements.externalInput.checked) {
      elements.multiplierInput.disabled = true;
      elements.multiplierInput.value = '0';
    }

    updateCsvCardDropdown(pageData.cards || []);
    syncCreditLimitInput();

    if (state.activeCardId) {
      loadOverview();
    }
  }

  async function loadOverview() {
    if (!state.activeCardId || !elements.chartContainer) {
      return;
    }
    try {
      const url = new URL(pageData.routes.overview, window.location.origin);
      url.searchParams.set('cardId', state.activeCardId);
      url.searchParams.set('months', '6');
      const data = await fetchJson(url.toString());
      state.overview = data;
      updateMetrics(data);
      renderChart(data.months || []);
      renderTransactions(data.currentMonthTransactions || []);
      renderConfirmations(data.pendingConfirmations || []);
      updateSuggestions(data.labelSuggestions || []);
      updateMonthDetailsLink(data);
      if (elements.tableFeedback) {
        elements.tableFeedback.textContent = '';
      }
    } catch (error) {
      showFeedback(elements.tableFeedback, error.message, true);
    }
  }

  function updateMetrics(data) {
    if (!elements.currentBalance || !data) return;
    const summary = data.currentMonth || null;
    const balanceValue = data.currentBalance ?? (summary ? summary.closingBalance : null);
    elements.currentBalance.textContent = formatCurrency(balanceValue);
    if (summary) {
      elements.currentUsage.textContent = formatCurrency(summary.usageTotal);
      elements.currentRepay.textContent = formatCurrency(summary.repaymentTotal);
      elements.currentPoints.textContent = `${Math.round(summary.externalPoints)} pts`;
    } else {
      elements.currentUsage.textContent = '--';
      elements.currentRepay.textContent = '--';
      elements.currentPoints.textContent = '--';
    }

    toggleAmountClass(elements.currentUsage, summary ? summary.usageTotal : null);
    toggleAmountClass(elements.currentRepay, summary ? -summary.repaymentTotal : null);
    toggleAmountClass(elements.currentBalance, balanceValue);
  }

  function renderChart(months) {
    if (!elements.chartContainer) return;
    elements.chartContainer.innerHTML = '';
    const width = elements.chartContainer.clientWidth || 960;
    const height = 340;
    const margin = { top: 20, right: 70, bottom: 50, left: 60 };

    if (!months || months.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inline-feedback';
      empty.textContent = 'No transactions recorded for the selected period.';
      elements.chartContainer.appendChild(empty);
      return;
    }

    const svg = d3.select(elements.chartContainer)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const labels = months.map((d) => d.label);
    const usageMax = Math.max(
      1,
      d3.max(months, (d) => Math.max(d.usageTotal || 0, d.repaymentTotal || 0)) || 0,
    );
    const pointsMax = Math.max(1, d3.max(months, (d) => d.externalPoints || 0) || 0);

    const x = d3.scaleBand()
      .domain(labels)
      .range([margin.left, width - margin.right])
      .padding(0.2);

    const yUsage = d3.scaleLinear()
      .domain([0, usageMax * 1.05])
      .range([height - margin.bottom, margin.top]);

    const yPoints = d3.scaleLinear()
      .domain([0, pointsMax * 1.2])
      .range([height - margin.bottom, margin.top]);

    const xAxis = d3.axisBottom(x);
    const yAxisUsage = d3.axisRight(yUsage).ticks(5).tickFormat((d) => currencyFormatter.format(d));
    const yAxisPoints = d3.axisLeft(yPoints).ticks(5).tickFormat((d) => `${Math.round(d)} pts`);

    svg.append('g')
      .attr('transform', `translate(0, ${height - margin.bottom})`)
      .call(xAxis);

    svg.append('g')
      .attr('transform', `translate(${width - margin.right}, 0)`)
      .call(yAxisUsage);

    svg.append('g')
      .attr('transform', `translate(${margin.left}, 0)`)
      .call(yAxisPoints);

    const barWidth = x.bandwidth() / 2.6;

    svg.append('g')
      .selectAll('.usage-bar')
      .data(months)
      .enter()
      .append('rect')
      .attr('class', 'usage-bar')
      .attr('x', (d) => x(d.label) + x.bandwidth() / 2 - barWidth - 2)
      .attr('y', (d) => yUsage(d.usageTotal || 0))
      .attr('width', barWidth)
      .attr('height', (d) => (height - margin.bottom) - yUsage(d.usageTotal || 0))
      .attr('fill', '#2563eb')
      .attr('rx', 6);

    svg.append('g')
      .selectAll('.repay-bar')
      .data(months)
      .enter()
      .append('rect')
      .attr('class', 'repay-bar')
      .attr('x', (d) => x(d.label) + 4)
      .attr('y', (d) => yUsage(d.repaymentTotal || 0))
      .attr('width', barWidth)
      .attr('height', (d) => (height - margin.bottom) - yUsage(d.repaymentTotal || 0))
      .attr('fill', '#0ea5e9')
      .attr('rx', 6);

    const line = d3.line()
      .x((d) => x(d.label) + x.bandwidth() / 2)
      .y((d) => yPoints(d.externalPoints || 0))
      .curve(d3.curveMonotoneX);

    svg.append('path')
      .datum(months)
      .attr('fill', 'none')
      .attr('stroke', '#16a34a')
      .attr('stroke-width', 2.5)
      .attr('d', line);

    svg.append('g')
      .selectAll('.point')
      .data(months)
      .enter()
      .append('circle')
      .attr('class', 'point')
      .attr('cx', (d) => x(d.label) + x.bandwidth() / 2)
      .attr('cy', (d) => yPoints(d.externalPoints || 0))
      .attr('r', 4)
      .attr('fill', '#16a34a')
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 1.5);

    const legend = svg.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top - 6})`);

    const legendItems = [
      { label: 'Usage', color: '#2563eb' },
      { label: 'Repayments', color: '#0ea5e9' },
      { label: 'Points', color: '#16a34a', type: 'line' },
    ];

    legendItems.forEach((item, index) => {
      const group = legend.append('g').attr('transform', `translate(${index * 140}, 0)`);
      if (item.type === 'line') {
        group.append('line')
          .attr('x1', 0)
          .attr('x2', 28)
          .attr('y1', 6)
          .attr('y2', 6)
          .attr('stroke', item.color)
          .attr('stroke-width', 3);
      } else {
        group.append('rect')
          .attr('width', 26)
          .attr('height', 10)
          .attr('rx', 3)
          .attr('fill', item.color);
      }
      group.append('text')
        .attr('x', 36)
        .attr('y', 10)
        .attr('fill', '#1f2937')
        .attr('font-size', 12)
        .text(item.label);
    });
  }

  function renderTransactions(transactions) {
    if (!elements.transactionsBody) return;
    const rows = elements.transactionsBody.querySelectorAll('tr[data-transaction-id]');
    rows.forEach((row) => row.remove());

    if (!transactions || transactions.length === 0) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = `
        <td colspan="7" class="inline-feedback">No transactions recorded for this month yet.</td>
      `;
      elements.transactionsBody.appendChild(emptyRow);
      return;
    }

    transactions.forEach((tx) => {
      const row = document.createElement('tr');
      row.dataset.transactionId = tx.id;
      const amountClass = tx.amount >= 0 ? 'credit-table__amount--positive' : 'credit-table__amount--negative';
      const externalBadge = tx.external
        ? `<span class="credit-table__external">External</span>`
        : '–';
      const multiplier = tx.external ? numberFormatter.format(tx.externalMultiplier || 0) : '0';
      const createdLabel = tx.createdAt
        ? new Date(tx.createdAt).toLocaleString()
        : '–';

      row.innerHTML = `
        <td>${formatDate(tx.transactionDate)}</td>
        <td>${escapeHtml(tx.label || '')}</td>
        <td class="credit-table__amount ${amountClass}">${formatCurrency(tx.amount)}</td>
        <td>${externalBadge}</td>
        <td>${multiplier}</td>
        <td>${createdLabel}</td>
        <td>
          <button class="btn btn-sm btn-outline-danger js-delete-transaction" data-id="${tx.id}">Delete</button>
        </td>
      `;
      elements.transactionsBody.appendChild(row);
    });
  }

  function renderConfirmations(pending) {
    if (!elements.confirmContainer || !elements.confirmList) return;
    elements.confirmList.innerHTML = '';

    if (!pending || pending.length === 0) {
      elements.confirmContainer.classList.add('hidden');
      return;
    }

    elements.confirmContainer.classList.remove('hidden');
    pending.forEach((summary) => {
      const item = document.createElement('div');
      item.className = 'pending-confirmations__item';
      item.innerHTML = `
        <div>
          <strong>${summary.label}</strong>
          <div class="inline-feedback">
            Closing balance: ${formatCurrency(summary.closingBalance)} · Net change ${formatCurrency(summary.netChange)}
          </div>
        </div>
      `;
      const button = document.createElement('button');
      button.className = 'btn btn-primary';
      button.textContent = 'Confirm';
      button.addEventListener('click', () => confirmMonth(summary.year, summary.month, button));
      item.appendChild(button);
      elements.confirmList.appendChild(item);
    });
  }

  function updateSuggestions(suggestions) {
    if (!elements.labelSuggestions) return;
    elements.labelSuggestions.innerHTML = '';
    (suggestions || []).slice(0, 20).forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.label;
      elements.labelSuggestions.appendChild(option);
    });
  }

  function updateMonthDetailsLink(data) {
    if (!elements.monthDetailsLink || !data) return;
    const target = data.currentMonth || (data.months ? data.months[data.months.length - 1] : null);
    if (!target) {
      elements.monthDetailsLink.setAttribute('href', '#');
      elements.monthDetailsLink.setAttribute('aria-disabled', 'true');
      return;
    }
    const monthPath = `${pageData.routes.monthViewBase}/${target.year}/${String(target.month).padStart(2, '0')}`;
    const url = new URL(monthPath, window.location.origin);
    if (state.activeCardId) {
      url.searchParams.set('cardId', state.activeCardId);
    }
    elements.monthDetailsLink.setAttribute('href', url.toString());
    elements.monthDetailsLink.removeAttribute('aria-disabled');
  }

  async function handleTransactionSubmit(event) {
    event.preventDefault();
    if (!state.activeCardId) {
      showFeedback(elements.tableFeedback, 'Please create a card first.', true);
      return;
    }
    const payload = {
      cardId: state.activeCardId,
      transactionDate: elements.dateInput.value,
      label: elements.labelInput.value,
      amount: elements.amountInput.value,
      external: elements.externalInput.checked,
      externalMultiplier: elements.multiplierInput.value || '0',
    };

    try {
      await fetchJson(pageData.routes.transaction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      elements.labelInput.value = '';
      elements.amountInput.value = '';
      elements.externalInput.checked = false;
      if (elements.multiplierInput) {
        elements.multiplierInput.value = '0';
        elements.multiplierInput.disabled = true;
      }
      showFeedback(elements.tableFeedback, 'Transaction saved.');
      await loadOverview();
      await refreshCardList(state.activeCardId, { reloadOverview: false });
    } catch (error) {
      showFeedback(elements.tableFeedback, error.message, true);
    }
  }

  function handleTransactionTableClick(event) {
    const button = event.target.closest('.js-delete-transaction');
    if (!button) return;
    const { id } = button.dataset;
    if (!id) return;
    if (!window.confirm('Delete this transaction?')) return;
    deleteTransaction(id);
  }

  async function deleteTransaction(transactionId) {
    const endpoint = `${pageData.routes.deleteTransaction}/${transactionId}`;
    try {
      await fetchJson(endpoint, { method: 'DELETE' });
      await loadOverview();
      await refreshCardList(state.activeCardId, { reloadOverview: false });
    } catch (error) {
      showFeedback(elements.tableFeedback, error.message, true);
    }
  }

  async function confirmMonth(year, month, button) {
    const endpoint = `${pageData.routes.confirm}/${year}/${String(month).padStart(2, '0')}/confirm`;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Confirming...';
    try {
      await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: state.activeCardId }),
      });
      await loadOverview();
    } catch (error) {
      showFeedback(elements.tableFeedback, error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function handleCsvUpload(event) {
    event.preventDefault();
    const selectedCardId = elements.csvCardSelect ? elements.csvCardSelect.value : '';
    if (!selectedCardId) {
      showFeedback(elements.csvFeedback, 'Select a card to import into.', true);
      return;
    }
    state.activeCardId = selectedCardId;
    if (elements.cardSelect) {
      elements.cardSelect.value = selectedCardId;
    }
    const formData = new FormData(elements.csvForm);
    formData.set('cardId', selectedCardId);
    try {
      const res = await fetch(pageData.routes.importCsv, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to import CSV');
      }
      const result = await res.json();
      const message = [
        `Imported ${result.inserted} transactions.`,
        result.skipped ? `${result.skipped} skipped (duplicates).` : '',
        result.errors && result.errors.length
          ? `Errors on lines: ${result.errors.map((e) => e.line).join(', ')}`
          : '',
      ].filter(Boolean).join(' ');
      showFeedback(elements.csvFeedback, message);
      elements.csvForm.reset();
      await loadOverview();
      await refreshCardList(state.activeCardId, { reloadOverview: false });
    } catch (error) {
      showFeedback(elements.csvFeedback, error.message, true);
    }
  }

  async function handleUpdateLimit(event) {
    event.preventDefault();
    if (!elements.limitFeedback) return;
    if (!state.activeCardId) {
      showFeedback(elements.limitFeedback, 'Select a card first.', true);
      return;
    }
    if (!elements.creditLimitInput) return;

    const rawValue = elements.creditLimitInput.value.trim();
    let payload;
    if (rawValue === '') {
      payload = { creditLimit: null };
    } else {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed < 0) {
        showFeedback(elements.limitFeedback, 'Enter a non-negative number or leave blank to clear.', true);
        return;
      }
      payload = { creditLimit: parsed };
    }

    const endpoint = `${pageData.routes.updateCard}/${state.activeCardId}`;
    try {
      const card = await fetchJson(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await refreshCardList(state.activeCardId, { reloadOverview: false });
      syncCreditLimitInput();
      await loadOverview();
      const message = card.creditLimit !== null && card.creditLimit !== undefined
        ? `Credit limit saved: ${formatCurrency(card.creditLimit)}`
        : 'Credit limit cleared.';
      showFeedback(elements.limitFeedback, message);
    } catch (error) {
      showFeedback(elements.limitFeedback, error.message, true);
    }
  }

  async function handleNewCard(event) {
    event.preventDefault();
    const formData = new FormData(elements.newCardForm);
    const payload = {
      name: formData.get('name'),
      issuedDate: formData.get('issuedDate'),
      creditLimit: formData.get('creditLimit'),
    };
    try {
      const card = await fetchJson(pageData.routes.createCard, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showFeedback(elements.cardFeedback, `Added card "${card.name}".`);
      if (!elements.cardSelect) {
        window.location.reload();
        return;
      }
      await refreshCardList(card.id);
      elements.newCardForm.reset();
    } catch (error) {
      showFeedback(elements.cardFeedback, error.message, true);
    }
  }

  async function refreshCardList(selectId, options = {}) {
    const { reloadOverview = true } = options;
    if (!elements.cardSelect) return;
    try {
      const cards = await fetchJson(pageData.routes.cards);
      pageData.cards = cards;
      const previousActive = state.activeCardId;
      let nextActive = selectId || previousActive;
      if (nextActive && !cards.some((card) => card.id === nextActive)) {
        nextActive = null;
      }
      if (!nextActive && cards.length > 0) {
        nextActive = cards[0].id;
      }
      elements.cardSelect.innerHTML = '';
      cards.forEach((card) => {
        const option = document.createElement('option');
        option.value = card.id;
        option.textContent = card.name;
        option.selected = card.id === nextActive;
        elements.cardSelect.appendChild(option);
      });
      state.activeCardId = nextActive;
      if (elements.cardSelect && state.activeCardId) {
        elements.cardSelect.value = state.activeCardId;
      }
      updateCsvCardDropdown(cards);
      syncCreditLimitInput();
      if (reloadOverview && state.activeCardId) {
        await loadOverview();
      }
    } catch (error) {
      showFeedback(elements.cardFeedback, error.message, true);
    }
  }

  function updateCsvCardDropdown(cards) {
    if (!elements.csvCardSelect) return;
    const eligible = (cards || []).filter((card) => !card.hasHistory);
    const previousValue = elements.csvCardSelect.value;
    elements.csvCardSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select card';
    placeholder.disabled = true;
    elements.csvCardSelect.appendChild(placeholder);
    eligible.forEach((card) => {
      const option = document.createElement('option');
      option.value = card.id;
      option.textContent = card.name;
      elements.csvCardSelect.appendChild(option);
    });
    const desiredValue = (previousValue && eligible.some((card) => card.id === previousValue))
      ? previousValue
      : (state.activeCardId && eligible.some((card) => card.id === state.activeCardId)
        ? state.activeCardId
        : '');
    if (desiredValue) {
      elements.csvCardSelect.value = desiredValue;
    } else {
      elements.csvCardSelect.value = '';
      placeholder.selected = true;
    }
    setCsvFormEnabled(eligible.length > 0);
  }

  function setCsvFormEnabled(enabled) {
    if (!elements.csvForm) return;
    const controls = elements.csvForm.querySelectorAll('input, select, button');
    controls.forEach((control) => {
      control.disabled = !enabled;
    });
    if (elements.csvDisabledMessage) {
      elements.csvDisabledMessage.classList.toggle('hidden', enabled);
    }
  }

  function syncCreditLimitInput() {
    if (!elements.creditLimitInput) return;
    const cards = pageData.cards || [];
    const card = cards.find((item) => item.id === state.activeCardId) || null;
    const hasCard = Boolean(card);
    setLimitFormEnabled(hasCard);
    if (!hasCard) {
      elements.creditLimitInput.value = '';
      return;
    }
    if (card.creditLimit !== null && card.creditLimit !== undefined) {
      elements.creditLimitInput.value = card.creditLimit;
    } else {
      elements.creditLimitInput.value = '';
    }
  }

  function setLimitFormEnabled(enabled) {
    if (!elements.updateLimitForm || !elements.creditLimitInput) return;
    elements.creditLimitInput.disabled = !enabled;
    const button = elements.updateLimitForm.querySelector('button');
    if (button) button.disabled = !enabled;
  }

  function formatCurrency(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '--';
    }
    return currencyFormatter.format(Number(value));
  }

  function formatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toISOString().slice(0, 10);
  }

  function toggleAmountClass(element, value) {
    if (!element) return;
    element.classList.remove('metric-card__value--positive', 'metric-card__value--negative');
    if (value === null || value === undefined) return;
    if (value > 0) element.classList.add('metric-card__value--positive');
    if (value < 0) element.classList.add('metric-card__value--negative');
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[m]));
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
    if (response.status === 204) return null;
    return response.json();
  }

  function showFeedback(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('inline-feedback--error', Boolean(isError));
  }
})();
