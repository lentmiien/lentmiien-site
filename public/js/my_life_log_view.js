(() => {
  const CATEGORIES = [
    { key:'a', label:'Sting / Burn (skin-level)', color:'#FFD700', border:'#866F10'},
    { key:'b', label:'Aching / Tender (deep sore)', color:'#FF4B60', border:'#7E262F'},
    { key:'c', label:'Tight / Stiff (movement-related)', color:'#1E90FF', border:'#164075'},
    { key:'d', label:'Head Pressure / Throb', color:'#B455FF', border:'#5B277D'},
    { key:'e', label:'Queasy / Off (stomach + whole-body unwell)', color:'#FFEC80', border:'#BCAA43'}
  ];

  const getCategory = (key) => CATEGORIES.find((cat) => cat.key === key) || CATEGORIES[0];

  const renderVisualLog = (wrapper) => {
    const overlay = wrapper.querySelector('.visual-log-overlay');
    if (!overlay) return;
    const raw = wrapper.getAttribute('data-vlog') || '';
    let data = wrapper._lifeLogData;
    if (!data) {
      try {
        data = JSON.parse(raw);
      } catch (error) {
        return;
      }
      wrapper._lifeLogData = data;
    }

    const points = Array.isArray(data?.points) ? data.points : [];
    const rect = wrapper.getBoundingClientRect();
    const baseWidth = data?.canvas?.width || rect.width || 1;
    const scale = rect.width / (baseWidth || rect.width || 1);

    overlay.innerHTML = '';
    points.forEach((pt) => {
      const cat = getCategory(pt.category);
      const el = document.createElement('div');
      el.className = 'point';
      const radius = Math.max(2, (pt.radius || 8) * scale);
      el.style.left = `${pt.x * rect.width}px`;
      el.style.top = `${pt.y * rect.height}px`;
      el.style.width = `${radius * 2}px`;
      el.style.height = `${radius * 2}px`;
      // el.style.marginLeft = `${-radius}px`;
      // el.style.marginTop = `${-radius}px`;
      el.style.background = cat.color;
      el.style.opacity = (pt.opacity || 80) / 100;
      el.style.borderColor = (pt.opacity || 80) >= 75 ? '#fff' : cat.border;
      el.style.borderWidth = '2px';
      overlay.appendChild(el);
    });
  };

  const visualLogs = Array.from(document.querySelectorAll('.visual-log-view'));
  visualLogs.forEach(renderVisualLog);
  window.addEventListener('resize', () => {
    visualLogs.forEach(renderVisualLog);
  });

  const layoutContainer = document.querySelector('.life-log-views');
  const layoutButtons = Array.from(document.querySelectorAll('[data-life-log-layout]'));
  const layoutStorageKey = 'lifeLogLayout';

  const setLayout = (layout) => {
    if (!layoutContainer) return;
    const nextLayout = layout === 'summary' ? 'summary' : 'timeline';
    layoutContainer.dataset.layout = nextLayout;
    layoutButtons.forEach((button) => {
      const isActive = button.getAttribute('data-life-log-layout') === nextLayout;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    try {
      localStorage.setItem(layoutStorageKey, nextLayout);
    } catch (error) {
      // Ignore storage failures (privacy mode, etc.).
    }
    requestAnimationFrame(() => {
      visualLogs.forEach(renderVisualLog);
    });
  };

  if (layoutContainer && layoutButtons.length) {
    let initialLayout = layoutContainer.dataset.layout || 'timeline';
    try {
      const storedLayout = localStorage.getItem(layoutStorageKey);
      if (storedLayout) {
        initialLayout = storedLayout;
      }
    } catch (error) {
      // Ignore storage failures (privacy mode, etc.).
    }
    setLayout(initialLayout);
    layoutButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setLayout(button.getAttribute('data-life-log-layout'));
      });
    });
  }

  const analyticsForm = document.getElementById('lifeLogAnalyticsForm');
  const analyticsModal = document.getElementById('lifeLogAnalyticsModal');
  const analyticsStatus = document.querySelector('[data-analytics-status]');
  const numericContainer = document.querySelector('[data-analytics-numeric]');
  const nonNumericContainer = document.querySelector('[data-analytics-non-numeric]');
  const diaryContainer = document.querySelector('[data-analytics-diary]');
  const visualPanel = document.querySelector('[data-analytics-panel="visual"]');
  const visualStatus = document.querySelector('[data-visual-status]');
  const visualImage = document.getElementById('lifeLogVisualImage');
  const visualCanvas = document.getElementById('lifeLogVisualCanvas');
  const analyticsPanels = {
    numeric: document.querySelector('[data-analytics-panel="numeric"]'),
    nonNumeric: document.querySelector('[data-analytics-panel="non-numeric"]'),
    diary: document.querySelector('[data-analytics-panel="diary"]'),
    visual: visualPanel,
  };
  const analyticsState = { data: null };
  const visualState = {
    points: [],
    days: [],
    isPlaying: false,
    playTime: 0,
    lastFrame: 0,
    rafId: null,
  };
  const DAY_MS = 24 * 60 * 60 * 1000;
  const visualDayDuration = 850;
  const visualFadeDays = 2;

  const rootStyles = window.getComputedStyle(document.documentElement);
  const brandColor = rootStyles.getPropertyValue('--brand').trim() || '#FF6A1F';
  const accentColor = rootStyles.getPropertyValue('--accent').trim() || '#FFC247';
  const mutedColor = rootStyles.getPropertyValue('--text-muted').trim() || '#9AA3B2';
  const dividerColor = rootStyles.getPropertyValue('--divider').trim() || '#2B313C';
  const surfaceColor = rootStyles.getPropertyValue('--surface-2').trim() || '#1B2026';

  const setPanelVisibility = (panel, hasContent) => {
    if (!panel) return;
    panel.style.display = hasContent ? '' : 'none';
  };

  const setAnalyticsStatus = (message, isError = false) => {
    if (!analyticsStatus) return;
    analyticsStatus.textContent = message;
    analyticsStatus.classList.toggle('life-log-analytics-status--error', isError);
  };

  const parseCsvInput = (value) => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const parseNumericValue = (value) => {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const cleaned = raw.replace(/,/g, '');
    if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) return null;
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const toLocalDateKey = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const toLocalMonthKey = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  const buildSeries = (points, keyFn) => {
    const map = new Map();
    points.forEach((point) => {
      const key = keyFn(point.timestamp);
      if (!key) return;
      const current = map.get(key) || { total: 0, count: 0 };
      current.total += point.value;
      current.count += 1;
      map.set(key, current);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, payload]) => ({
        key,
        value: payload.count ? payload.total / payload.count : 0,
      }));
  };

  const computeTrend = (points) => {
    if (!points || points.length < 2) return null;
    const xs = points.map((point) => point.timestamp.getTime() / DAY_MS);
    const ys = points.map((point) => point.value);
    const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    const meanY = ys.reduce((sum, y) => sum + y, 0) / ys.length;
    let numerator = 0;
    let denominator = 0;
    xs.forEach((x, idx) => {
      const dx = x - meanX;
      numerator += dx * (ys[idx] - meanY);
      denominator += dx * dx;
    });
    if (!denominator) return null;
    return numerator / denominator;
  };

  const formatTrend = (slope) => {
    if (slope === null) return 'Trend: not enough data';
    const rounded = Math.round(slope * 1000) / 1000;
    const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
    const sign = rounded > 0 ? '+' : '';
    return `Trend: ${sign}${rounded}/day (${direction})`;
  };

  const prepareCanvas = (canvas, height = 160) => {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.parentElement ? canvas.parentElement.clientWidth : 360;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width, height };
  };

  const renderLineChart = (canvas, series, options = {}) => {
    const chart = prepareCanvas(canvas, options.height || 160);
    if (!chart) return;
    const { ctx, width, height } = chart;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = surfaceColor;
    ctx.fillRect(0, 0, width, height);

    if (!series.length) {
      ctx.fillStyle = mutedColor;
      ctx.font = '12px sans-serif';
      ctx.fillText('No data', 12, 24);
      return;
    }

    const padding = { top: 16, right: 16, bottom: 26, left: 40 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const values = series.map((item) => item.value);
    let minValue = Math.min(...values);
    let maxValue = Math.max(...values);
    if (minValue === maxValue) {
      minValue -= 1;
      maxValue += 1;
    }

    ctx.strokeStyle = dividerColor;
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i += 1) {
      const y = padding.top + (chartHeight / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
    }

    ctx.fillStyle = mutedColor;
    ctx.font = '11px sans-serif';
    ctx.fillText(maxValue.toFixed(2), 6, padding.top + 4);
    ctx.fillText(minValue.toFixed(2), 6, height - padding.bottom);

    ctx.strokeStyle = options.color || brandColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((item, idx) => {
      const x = series.length === 1
        ? padding.left + chartWidth / 2
        : padding.left + (chartWidth / (series.length - 1)) * idx;
      const yRatio = (item.value - minValue) / (maxValue - minValue);
      const y = padding.top + chartHeight - yRatio * chartHeight;
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    ctx.fillStyle = options.color || brandColor;
    series.forEach((item, idx) => {
      const x = series.length === 1
        ? padding.left + chartWidth / 2
        : padding.left + (chartWidth / (series.length - 1)) * idx;
      const yRatio = (item.value - minValue) / (maxValue - minValue);
      const y = padding.top + chartHeight - yRatio * chartHeight;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = mutedColor;
    ctx.font = '11px sans-serif';
    ctx.fillText(series[0].key, padding.left, height - 8);
    if (series.length > 1) {
      const lastLabel = series[series.length - 1].key;
      const textWidth = ctx.measureText(lastLabel).width;
      ctx.fillText(lastLabel, width - padding.right - textWidth, height - 8);
    }
  };

  const createElement = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  const clearContainer = (container) => {
    if (container) {
      container.innerHTML = '';
    }
  };

  const fetchEntries = async ({ start, end, labels = [], types = [], includeLegacy = true }) => {
    const params = new URLSearchParams();
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    if (includeLegacy !== undefined) params.set('include_legacy', includeLegacy ? 'true' : 'false');
    types.forEach((type) => params.append('types', type));
    labels.forEach((label) => params.append('labels', label));
    const resp = await fetch(`/mypage/life_log/entries?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data?.error || 'Unable to fetch life log analytics data.');
    }
    return Array.isArray(data?.entries) ? data.entries : [];
  };

  const mergeEntries = (lists) => {
    const map = new Map();
    lists.flat().forEach((entry) => {
      if (!entry || !entry.id) return;
      if (!map.has(entry.id)) {
        map.set(entry.id, entry);
      }
    });
    return Array.from(map.values());
  };

  const analyzeEntries = (entries) => {
    const numericByLabel = new Map();
    const nonNumeric = [];
    const diaries = [];
    const visuals = [];
    entries.forEach((entry) => {
      const timestamp = new Date(entry.timestamp);
      if (Number.isNaN(timestamp.getTime())) return;
      if (entry.type === 'basic' || entry.type === 'medical') {
        const label = entry.label ? entry.label.trim() : (entry.typeLabel || entry.type || 'Unlabeled');
        const numericValue = parseNumericValue(entry.value);
        if (numericValue === null) {
          nonNumeric.push({ entry, timestamp, label });
          return;
        }
        const bucket = numericByLabel.get(label) || {
          label,
          entries: [],
          types: new Set(),
        };
        bucket.entries.push({ entry, timestamp, value: numericValue });
        bucket.types.add(entry.typeLabel || entry.type);
        numericByLabel.set(label, bucket);
      } else if (entry.type === 'diary') {
        diaries.push({ entry, timestamp });
      } else if (entry.type === 'visual_log') {
        visuals.push({ entry, timestamp });
      }
    });
    nonNumeric.sort((a, b) => b.timestamp - a.timestamp);
    diaries.sort((a, b) => b.timestamp - a.timestamp);
    visuals.sort((a, b) => a.timestamp - b.timestamp);
    return {
      numericByLabel,
      nonNumeric,
      diaries,
      visuals,
    };
  };

  const renderNumericTrends = (numericByLabel) => {
    clearContainer(numericContainer);
    const labels = Array.from(numericByLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
    if (!labels.length) {
      setPanelVisibility(analyticsPanels.numeric, false);
      return;
    }
    setPanelVisibility(analyticsPanels.numeric, true);
    labels.forEach((group) => {
      const card = createElement('div', 'life-log-analytics-card');
      const header = createElement('div', 'life-log-analytics-card-header');
      const title = createElement('div', 'life-log-analytics-card-title', group.label);
      const meta = createElement('div', 'life-log-analytics-card-meta', `${group.entries.length} entries`);
      header.appendChild(title);
      header.appendChild(meta);

      const typeMeta = createElement('div', 'life-log-analytics-card-types', Array.from(group.types).join(' / '));
      const trendValue = computeTrend(group.entries);
      const trendText = createElement('div', 'life-log-analytics-card-trend', formatTrend(trendValue));

      const dailySeries = buildSeries(group.entries, toLocalDateKey);
      const monthlySeries = buildSeries(group.entries, toLocalMonthKey);
      const dailyWrap = createElement('div', 'life-log-analytics-chart-block');
      const dailyLabel = createElement('div', 'life-log-analytics-chart-label', 'Daily average');
      const dailyCanvas = createElement('canvas', 'life-log-analytics-chart');
      dailyWrap.appendChild(dailyLabel);
      dailyWrap.appendChild(dailyCanvas);

      const monthlyWrap = createElement('div', 'life-log-analytics-chart-block');
      const monthlyLabel = createElement('div', 'life-log-analytics-chart-label', 'Monthly average');
      const monthlyCanvas = createElement('canvas', 'life-log-analytics-chart');
      monthlyWrap.appendChild(monthlyLabel);
      monthlyWrap.appendChild(monthlyCanvas);

      card.appendChild(header);
      card.appendChild(typeMeta);
      card.appendChild(trendText);
      card.appendChild(dailyWrap);
      card.appendChild(monthlyWrap);
      numericContainer.appendChild(card);

      renderLineChart(dailyCanvas, dailySeries, { color: brandColor });
      renderLineChart(monthlyCanvas, monthlySeries, { color: accentColor });
    });
  };

  const renderNonNumeric = (items) => {
    clearContainer(nonNumericContainer);
    if (!items.length) {
      setPanelVisibility(analyticsPanels.nonNumeric, false);
      return;
    }
    setPanelVisibility(analyticsPanels.nonNumeric, true);
    const list = createElement('div', 'life-log-analytics-list-inner');
    items.forEach((item) => {
      const row = createElement('div', 'life-log-analytics-item');
      const timestamp = item.entry.displayTimestamp || item.timestamp.toLocaleString();
      const meta = createElement('div', 'life-log-analytics-item-meta', `${timestamp} · ${item.label} (${item.entry.typeLabel || item.entry.type})`);
      const value = createElement('div', 'life-log-analytics-item-value', item.entry.value || '-');
      row.appendChild(meta);
      row.appendChild(value);
      list.appendChild(row);
    });
    nonNumericContainer.appendChild(list);
  };

  const renderDiary = (items) => {
    clearContainer(diaryContainer);
    if (!items.length) {
      setPanelVisibility(analyticsPanels.diary, false);
      return;
    }
    setPanelVisibility(analyticsPanels.diary, true);
    const list = createElement('div', 'life-log-analytics-list-inner');
    items.forEach((item) => {
      const row = createElement('div', 'life-log-analytics-item');
      const timestamp = item.entry.displayTimestamp || item.timestamp.toLocaleString();
      const meta = createElement('div', 'life-log-analytics-item-meta', timestamp);
      const text = createElement('pre', 'life-log-analytics-item-text', item.entry.text || '');
      row.appendChild(meta);
      row.appendChild(text);
      list.appendChild(row);
    });
    diaryContainer.appendChild(list);
  };

  const extractVisualPoints = (entries) => {
    const points = [];
    entries.forEach((item) => {
      const raw = item.entry.v_log_data || '';
      if (!raw) return;
      let data;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        return;
      }
      const baseWidth = data?.canvas?.width || 1;
      const list = Array.isArray(data?.points) ? data.points : [];
      const dayKey = toLocalDateKey(item.timestamp);
      list.forEach((pt) => {
        if (typeof pt?.x !== 'number' || typeof pt?.y !== 'number') return;
        const category = getCategory(pt.category);
        points.push({
          x: pt.x,
          y: pt.y,
          radius: pt.radius || 8,
          opacity: Math.min(Math.max((pt.opacity || 80) / 100, 0), 1),
          color: category.color,
          border: (pt.opacity || 80) >= 75 ? '#fff' : category.border,
          baseWidth,
          dayKey,
        });
      });
    });
    return points;
  };

  const buildVisualState = (points) => {
    const dayKeys = Array.from(new Set(points.map((point) => point.dayKey))).sort();
    const dayIndex = new Map(dayKeys.map((key, idx) => [key, idx]));
    points.forEach((point) => {
      point.dayIndex = dayIndex.get(point.dayKey) || 0;
    });
    visualState.points = points;
    visualState.days = dayKeys;
  };

  const getVisualContext = () => {
    if (!visualCanvas || !visualImage) return null;
    const rect = visualImage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const dpr = window.devicePixelRatio || 1;
    visualCanvas.width = Math.floor(rect.width * dpr);
    visualCanvas.height = Math.floor(rect.height * dpr);
    visualCanvas.style.width = `${rect.width}px`;
    visualCanvas.style.height = `${rect.height}px`;
    const ctx = visualCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  };

  const drawVisualPoints = (points, alphaForPoint) => {
    const ctxPayload = getVisualContext();
    if (!ctxPayload) return;
    const { ctx, width, height } = ctxPayload;
    ctx.clearRect(0, 0, width, height);
    points.forEach((point) => {
      const alpha = alphaForPoint(point);
      if (alpha <= 0) return;
      const scale = point.baseWidth ? width / point.baseWidth : 1;
      const radius = Math.max(2, (point.radius || 8) * scale);
      ctx.beginPath();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = point.color;
      ctx.strokeStyle = point.border;
      ctx.lineWidth = 2;
      ctx.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  };

  const renderVisualAll = () => {
    if (!visualState.points.length) return;
    drawVisualPoints(visualState.points, (point) => point.opacity);
    if (visualStatus) {
      visualStatus.textContent = 'Paused: showing all entries.';
    }
  };

  const renderVisualAnimated = (playTime) => {
    if (!visualState.points.length) return;
    drawVisualPoints(visualState.points, (point) => {
      const diff = playTime - point.dayIndex;
      if (diff < -0.25) return 0;
      if (diff < 0) return point.opacity * ((diff + 0.25) / 0.25);
      if (diff <= visualFadeDays) return point.opacity * (1 - diff / visualFadeDays);
      return 0;
    });
    if (visualStatus) {
      const dayIndex = Math.min(Math.floor(playTime) + 1, visualState.days.length);
      visualStatus.textContent = `Playing day ${dayIndex} of ${visualState.days.length}.`;
    }
  };

  const stopVisualAnimation = ({ showAll = true } = {}) => {
    visualState.isPlaying = false;
    if (visualState.rafId) {
      cancelAnimationFrame(visualState.rafId);
      visualState.rafId = null;
    }
    if (showAll) {
      renderVisualAll();
    }
  };

  const startVisualAnimation = () => {
    if (!visualState.points.length) return;
    visualState.isPlaying = true;
    visualState.playTime = 0;
    visualState.lastFrame = performance.now();
    const maxPlayTime = Math.max(0, visualState.days.length - 1 + visualFadeDays);

    const tick = (now) => {
      if (!visualState.isPlaying) return;
      const delta = now - visualState.lastFrame;
      visualState.lastFrame = now;
      visualState.playTime += delta / visualDayDuration;
      if (visualState.playTime > maxPlayTime) {
        stopVisualAnimation({ showAll: true });
        return;
      }
      renderVisualAnimated(visualState.playTime);
      visualState.rafId = requestAnimationFrame(tick);
    };
    visualState.rafId = requestAnimationFrame(tick);
  };

  const renderVisual = (visualEntries) => {
    if (!visualPanel) return;
    if (!visualEntries.length) {
      setPanelVisibility(analyticsPanels.visual, false);
      stopVisualAnimation({ showAll: false });
      return;
    }
    setPanelVisibility(analyticsPanels.visual, true);
    const points = extractVisualPoints(visualEntries);
    buildVisualState(points);
    if (!points.length) {
      const ctxPayload = getVisualContext();
      if (ctxPayload) {
        ctxPayload.ctx.clearRect(0, 0, ctxPayload.width, ctxPayload.height);
      }
      stopVisualAnimation({ showAll: false });
      if (visualStatus) {
        visualStatus.textContent = 'No visual log points for this period.';
      }
      return;
    }
    stopVisualAnimation({ showAll: true });
  };

  const renderAnalyticsResults = (result) => {
    if (!result) return;
    renderNumericTrends(result.numericByLabel);
    renderNonNumeric(result.nonNumeric);
    renderDiary(result.diaries);
    renderVisual(result.visuals);
  };

  const handleAnalyticsSubmit = async (event) => {
    event.preventDefault();
    if (!analyticsForm) return;
    const startInput = document.getElementById('life-log-analytics-start');
    const endInput = document.getElementById('life-log-analytics-end');
    const labelsInput = document.getElementById('life-log-analytics-labels');
    const includeLegacyInput = document.getElementById('life-log-analytics-legacy');
    const typeInputs = Array.from(document.querySelectorAll('[data-analytics-type]'));
    const selectedTypes = typeInputs
      .filter((input) => input.checked)
      .map((input) => input.getAttribute('data-analytics-type'));
    const availableTypes = typeInputs.map((input) => input.getAttribute('data-analytics-type'));
    const types = selectedTypes.length ? selectedTypes : availableTypes;
    const labels = parseCsvInput(labelsInput?.value);
    const includeLegacy = includeLegacyInput ? includeLegacyInput.checked : true;
    const start = startInput ? startInput.value : '';
    const end = endInput ? endInput.value : '';

    setAnalyticsStatus('Loading analytics data...');
    clearContainer(numericContainer);
    clearContainer(nonNumericContainer);
    clearContainer(diaryContainer);
    setPanelVisibility(analyticsPanels.numeric, false);
    setPanelVisibility(analyticsPanels.nonNumeric, false);
    setPanelVisibility(analyticsPanels.diary, false);
    setPanelVisibility(analyticsPanels.visual, false);

    try {
      const hasLabelFilter = labels.length > 0;
      const needsLabelFiltered = types.filter((type) => type === 'basic' || type === 'medical');
      const needsLabelFree = types.filter((type) => type === 'diary' || type === 'visual_log');
      const requests = [];
      if (hasLabelFilter) {
        if (needsLabelFiltered.length) {
          requests.push(fetchEntries({
            start,
            end,
            labels,
            types: needsLabelFiltered,
            includeLegacy,
          }));
        }
        if (needsLabelFree.length) {
          requests.push(fetchEntries({
            start,
            end,
            labels: [],
            types: needsLabelFree,
            includeLegacy,
          }));
        }
      } else {
        requests.push(fetchEntries({
          start,
          end,
          labels: [],
          types,
          includeLegacy,
        }));
      }

      const entries = mergeEntries(await Promise.all(requests));
      if (!entries.length) {
        setAnalyticsStatus('No entries found for this period.');
        analyticsState.data = null;
        return;
      }

      const result = analyzeEntries(entries);
      analyticsState.data = result;
      renderAnalyticsResults(result);
      setAnalyticsStatus(`Loaded ${entries.length} entries.`);
    } catch (error) {
      setAnalyticsStatus(error.message || 'Unable to load analytics.', true);
      analyticsState.data = null;
    }
  };

  if (analyticsForm) {
    analyticsForm.addEventListener('submit', handleAnalyticsSubmit);
  }

  if (analyticsModal) {
    analyticsModal.addEventListener('hidden.bs.modal', () => {
      stopVisualAnimation({ showAll: false });
    });
  }

  if (visualImage) {
    visualImage.addEventListener('load', () => {
      if (!visualState.isPlaying && visualState.points.length) {
        renderVisualAll();
      }
    });
  }

  document.querySelectorAll('[data-visual-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.getAttribute('data-visual-action');
      if (action === 'play') {
        startVisualAnimation();
      } else if (action === 'pause') {
        stopVisualAnimation({ showAll: true });
      } else if (action === 'restart') {
        stopVisualAnimation({ showAll: false });
        startVisualAnimation();
      }
    });
  });

  window.addEventListener('resize', () => {
    if (analyticsState.data) {
      renderAnalyticsResults(analyticsState.data);
    }
    if (!visualState.isPlaying && visualState.points.length) {
      renderVisualAll();
    }
  });

  const getEntryNodes = (entryId) => {
    if (!entryId) return [];
    const safeId = window.CSS && window.CSS.escape ? window.CSS.escape(entryId) : entryId;
    return document.querySelectorAll(`[data-entry-id=\"${safeId}\"]`);
  };

  const cleanupSummary = () => {
    document.querySelectorAll('.life-log-day-group').forEach((group) => {
      if (!group.querySelector('.life-log-entry')) {
        group.remove();
      }
    });
    document.querySelectorAll('.life-log-day').forEach((day) => {
      if (!day.querySelector('.life-log-entry')) {
        day.remove();
      }
    });
  };

  document.querySelectorAll('.life-log-delete').forEach((button) => {
    button.addEventListener('click', async () => {
      const entry = button.closest('.life-log-entry');
      if (!entry) return;
      const entryId = entry.getAttribute('data-entry-id');
      if (!entryId) return;
      const confirmDelete = window.confirm('Delete this entry?');
      if (!confirmDelete) return;

      button.disabled = true;
      try {
        const resp = await fetch(`/mypage/life_log/entry/${entryId}`, {
          method: 'DELETE',
          headers: { 'Accept': 'application/json' },
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data?.error || 'Unable to delete entry.');
        }
        getEntryNodes(entryId).forEach((node) => node.remove());
        cleanupSummary();
      } catch (error) {
        button.disabled = false;
        window.alert(error.message || 'Unable to delete entry.');
      }
    });
  });
})();
