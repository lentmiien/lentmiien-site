(() => {
  const config = window.exchangeRatesConfig || {};
  const state = {
    base: config.base || 'JPY',
    start: config.start || '',
    end: config.end || '',
    defaultCurrencies: Array.isArray(config.defaultCurrencies) ? config.defaultCurrencies : [],
    entries: [],
    currencies: [],
    charts: new Map(),
    modes: {
      daily: true,
      weekly: true,
      monthly: false,
    },
  };

  const elements = {
    startDate: document.getElementById('startDate'),
    endDate: document.getElementById('endDate'),
    applyRange: document.getElementById('applyRange'),
    modeDaily: document.getElementById('modeDaily'),
    modeWeekly: document.getElementById('modeWeekly'),
    modeMonthly: document.getElementById('modeMonthly'),
    currencyGrid: document.getElementById('currencyGrid'),
    rangeLabel: document.getElementById('rangeLabel'),
    modeLabel: document.getElementById('modeLabel'),
    seriesLabel: document.getElementById('seriesLabel'),
  };

  const css = getComputedStyle(document.documentElement);
  const chartGridColor = 'rgba(255, 255, 255, 0.08)';
  const chartTickColor = css.getPropertyValue('--text-muted').trim() || '#9AA3B2';

  const palette = [
    '#FF6A1F',
    '#FFC247',
    '#5AD1FF',
    '#7CFFB2',
    '#FF8E4D',
    '#FFD46A',
    '#6AE6FF',
    '#9BFF6A',
    '#FF6A7A',
    '#6AFFD5',
    '#C6FF7A',
    '#FFA96A',
  ];

  const pad = (value) => String(value).padStart(2, '0');

  const formatDateKey = (date) => {
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    return `${year}-${month}-${day}`;
  };

  const parseDateKey = (value) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const buildDateList = (startKey, endKey) => {
    const startDate = parseDateKey(startKey);
    const endDate = parseDateKey(endKey);
    if (!startDate || !endDate) return [];
    const list = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      list.push(formatDateKey(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return list;
  };

  const getWeekKey = (dateKey) => {
    const date = parseDateKey(dateKey);
    if (!date) return null;
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    return formatDateKey(date);
  };

  const getMonthKey = (dateKey) => dateKey ? dateKey.slice(0, 7) : null;

  const hexToRgba = (hex, alpha) => {
    const trimmed = hex.replace('#', '');
    if (trimmed.length !== 6) return hex;
    const r = parseInt(trimmed.slice(0, 2), 16);
    const g = parseInt(trimmed.slice(2, 4), 16);
    const b = parseInt(trimmed.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const resolveColor = (index) => palette[index % palette.length];

  const formatRate = (value) => {
    if (!Number.isFinite(value)) return '--';
    if (value >= 100) return value.toFixed(2);
    if (value >= 1) return value.toFixed(4);
    return value.toFixed(6);
  };

  const updateMetaLabels = () => {
    if (elements.rangeLabel) {
      elements.rangeLabel.textContent = state.start && state.end ? `${state.start} to ${state.end}` : '--';
    }
    if (elements.modeLabel) {
      const modes = [];
      if (state.modes.daily) modes.push('Daily');
      if (state.modes.weekly) modes.push('Weekly');
      if (state.modes.monthly) modes.push('Monthly');
      elements.modeLabel.textContent = modes.length ? modes.join(' + ') : 'None';
    }
    if (elements.seriesLabel) {
      elements.seriesLabel.textContent = state.currencies.length ? `${state.currencies.length} currencies` : '--';
    }
  };

  const computeGroupedAverages = (entries, currency, keyFn) => {
    const sums = new Map();
    const counts = new Map();
    entries.forEach((entry) => {
      const value = Number(entry.rates && entry.rates[currency]);
      if (!Number.isFinite(value)) return;
      const key = keyFn(entry.date);
      if (!key) return;
      sums.set(key, (sums.get(key) || 0) + value);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const averages = new Map();
    sums.forEach((sum, key) => {
      averages.set(key, sum / counts.get(key));
    });
    return averages;
  };

  const buildSeries = (currency, labels) => {
    const valueMap = new Map();
    state.entries.forEach((entry) => {
      const value = Number(entry.rates && entry.rates[currency]);
      if (!Number.isFinite(value)) return;
      valueMap.set(entry.date, value);
    });

    const daily = labels.map((date) => (valueMap.has(date) ? valueMap.get(date) : null));
    const weeklyMap = computeGroupedAverages(state.entries, currency, getWeekKey);
    const monthlyMap = computeGroupedAverages(state.entries, currency, getMonthKey);

    const weekly = labels.map((date) => {
      const key = getWeekKey(date);
      return key && weeklyMap.has(key) ? weeklyMap.get(key) : null;
    });

    const monthly = labels.map((date) => {
      const key = getMonthKey(date);
      return key && monthlyMap.has(key) ? monthlyMap.get(key) : null;
    });

    let latest = null;
    for (let i = daily.length - 1; i >= 0; i -= 1) {
      if (Number.isFinite(daily[i])) {
        latest = daily[i];
        break;
      }
    }

    return { daily, weekly, monthly, latest };
  };

  const buildDataset = (label, data, color, options = {}) => ({
    label,
    data,
    borderColor: color,
    backgroundColor: hexToRgba(color, 0.15),
    borderWidth: 2,
    tension: 0.28,
    pointRadius: 0,
    spanGaps: true,
    ...options,
  });

  const createChart = (canvas, labels, datasets) => {
    const ctx = canvas.getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatRate(context.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: chartTickColor,
              maxTicksLimit: 6,
            },
            grid: {
              color: chartGridColor,
            },
          },
          y: {
            ticks: {
              color: chartTickColor,
              callback: (value) => formatRate(value),
            },
            grid: {
              color: chartGridColor,
            },
          },
        },
      },
    });
  };

  const destroyCharts = () => {
    state.charts.forEach((chart) => chart.destroy());
    state.charts.clear();
  };

  const renderGrid = () => {
    if (!elements.currencyGrid) return;
    destroyCharts();
    elements.currencyGrid.innerHTML = '';

    if (!state.currencies.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No exchange rate data available for this range.';
      elements.currencyGrid.appendChild(empty);
      updateMetaLabels();
      return;
    }

    const labels = buildDateList(state.start, state.end);

    state.currencies.forEach((currency, index) => {
      const card = document.createElement('div');
      card.className = 'currency-card';
      card.style.setProperty('--card-index', index);

      const header = document.createElement('div');
      header.className = 'currency-header';

      const title = document.createElement('div');
      title.className = 'currency-title';
      title.textContent = `${currency} / ${state.base}`;

      const meta = document.createElement('div');
      meta.className = 'currency-meta';
      meta.textContent = 'Latest';

      header.appendChild(title);
      header.appendChild(meta);

      const value = document.createElement('div');
      value.className = 'currency-value';

      const chartWrap = document.createElement('div');
      chartWrap.className = 'currency-chart';
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', `${currency} exchange rate chart`);
      chartWrap.appendChild(canvas);

      card.appendChild(header);
      card.appendChild(value);
      card.appendChild(chartWrap);
      elements.currencyGrid.appendChild(card);

      const series = buildSeries(currency, labels);
      value.textContent = formatRate(series.latest);

      const baseColor = resolveColor(index);
      const datasets = [];
      if (state.modes.daily) {
        datasets.push(buildDataset('Daily', series.daily, baseColor));
      }
      if (state.modes.weekly) {
        datasets.push(buildDataset('Weekly avg', series.weekly, hexToRgba(baseColor, 0.85), {
          borderDash: [6, 4],
        }));
      }
      if (state.modes.monthly) {
        datasets.push(buildDataset('Monthly avg', series.monthly, hexToRgba(baseColor, 0.65), {
          borderDash: [2, 3],
        }));
      }

      const chart = createChart(canvas, labels, datasets);
      state.charts.set(currency, chart);
    });

    updateMetaLabels();
  };

  const updateCharts = () => {
    if (!state.currencies.length) {
      renderGrid();
      return;
    }

    const labels = buildDateList(state.start, state.end);

    state.currencies.forEach((currency, index) => {
      const chart = state.charts.get(currency);
      if (!chart) return;
      const series = buildSeries(currency, labels);
      const baseColor = resolveColor(index);
      const datasets = [];
      if (state.modes.daily) {
        datasets.push(buildDataset('Daily', series.daily, baseColor));
      }
      if (state.modes.weekly) {
        datasets.push(buildDataset('Weekly avg', series.weekly, hexToRgba(baseColor, 0.85), {
          borderDash: [6, 4],
        }));
      }
      if (state.modes.monthly) {
        datasets.push(buildDataset('Monthly avg', series.monthly, hexToRgba(baseColor, 0.65), {
          borderDash: [2, 3],
        }));
      }
      chart.data.labels = labels;
      chart.data.datasets = datasets;
      chart.update('none');

      const card = chart.canvas.closest('.currency-card');
      if (card) {
        const value = card.querySelector('.currency-value');
        if (value) {
          value.textContent = formatRate(series.latest);
        }
      }
    });

    updateMetaLabels();
  };

  const applyRange = async () => {
    const start = elements.startDate ? elements.startDate.value : '';
    const end = elements.endDate ? elements.endDate.value : '';
    let resolvedStart = start || state.start;
    let resolvedEnd = end || state.end;

    if (resolvedStart && resolvedEnd && resolvedStart > resolvedEnd) {
      [resolvedStart, resolvedEnd] = [resolvedEnd, resolvedStart];
    }

    state.start = resolvedStart;
    state.end = resolvedEnd;
    if (elements.startDate) elements.startDate.value = resolvedStart;
    if (elements.endDate) elements.endDate.value = resolvedEnd;
    await loadData();
  };

  const loadData = async () => {
    if (!state.start || !state.end) return;
    const params = new URLSearchParams({
      start: state.start,
      end: state.end,
      base: state.base,
    });

    try {
      const response = await fetch(`/exchange-rates/data?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json();
      if (data.base) {
        state.base = data.base;
      }
      if (data.start && data.end) {
        state.start = data.start;
        state.end = data.end;
        if (elements.startDate) elements.startDate.value = data.start;
        if (elements.endDate) elements.endDate.value = data.end;
      }
      state.entries = Array.isArray(data.entries) ? data.entries : [];
      const apiCurrencies = Array.isArray(data.currencies) ? data.currencies : [];
      if (state.entries.length) {
        state.currencies = apiCurrencies.length ? apiCurrencies : state.defaultCurrencies;
      } else {
        state.currencies = [];
      }
      renderGrid();
    } catch (error) {
      console.error('Failed to load exchange rate data', error);
      state.entries = [];
      state.currencies = [];
      renderGrid();
    }
  };

  const bindEvents = () => {
    if (elements.applyRange) {
      elements.applyRange.addEventListener('click', applyRange);
    }
    if (elements.modeDaily) {
      elements.modeDaily.addEventListener('change', (event) => {
        state.modes.daily = event.target.checked;
        updateCharts();
      });
    }
    if (elements.modeWeekly) {
      elements.modeWeekly.addEventListener('change', (event) => {
        state.modes.weekly = event.target.checked;
        updateCharts();
      });
    }
    if (elements.modeMonthly) {
      elements.modeMonthly.addEventListener('change', (event) => {
        state.modes.monthly = event.target.checked;
        updateCharts();
      });
    }
  };

  const init = () => {
    if (elements.startDate && state.start) {
      elements.startDate.value = state.start;
    }
    if (elements.endDate && state.end) {
      elements.endDate.value = state.end;
    }
    bindEvents();
    loadData();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
