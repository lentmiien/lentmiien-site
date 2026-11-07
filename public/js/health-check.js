(() => {
  'use strict';
  const root = document.getElementById('health-check');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const analytics = window.HealthCheckAnalytics;
  const body = window.HealthCheckBody;
  const state = { exams: [], trends: [], filter: 'all', bodyArea: null, note: 'overall_comment', openCategories: new Set(), allFlags: false };
  let chartSequence = 0;
  let dialogTrigger = null;
  const iconPaths = {
    pulse: ['M2 12h5l3-8 4 16 3-8h5'],
    eye: ['M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
    ear: ['M7 9a5 5 0 0 1 10 0c0 4-4 4-4 8a3 3 0 0 1-6 0', 'M10 10a2 2 0 0 1 4 0c0 2-3 2-3 4'],
    lungs: ['M12 3v8m0-3-4 3m4-3 4 3', 'M8 7C4 9 2 15 4 19c1 2 6 1 6-2V9M16 7c4 2 6 8 4 12-1 2-6 1-6-2V9'],
    liver: ['M3 10c1-4 13-5 18-2-1 5-6 10-10 10-2 0-2-3-4-3H3Z', 'm13 8-2 10'],
    stomach: ['M12 3v5c7-2 9 4 7 8-3 6-11 5-13 1-1-3 1-6 4-6V3'],
    pancreas: ['M3 13c4-4 6-6 11-4l7 3c0 4-4 4-7 2-4-2-7 2-11 1Z'],
    kidneys: ['M8 4C2 4 1 15 5 19c4 3 6-2 3-5-2-2 2-4 2-6 0-2-1-4-2-4ZM16 4c6 0 7 11 3 15-4 3-6-2-3-5 2-2-2-4-2-6 0-2 1-4 2-4Z'],
    bowel: ['M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z', 'M8 8h7a2 2 0 0 1 0 4H9a2 2 0 0 0 0 4h7'],
    body: ['M15 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M6 21v-7l-3 2 3-7h12l3 7-3-2v7M10 21v-5h4v5'],
    report: ['M14 3H5v18h14V8Z', 'M14 3v5h5M8 12h8M8 16h6'],
    trend: ['M3 4v16h18M6 15l4-5 4 3 6-7'],
    expand: ['M14 3h7v7M10 21H3v-7M21 3l-7 7M3 21l7-7'],
    close: ['m6 6 12 12M6 18 18 6'],
    arrow: ['M5 12h14m-6-6 6 6-6 6'],
    chevron: ['m8 5 7 7-7 7'],
  };
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function svgEl(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    return node;
  }
  function icon(name) {
    const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'hc-icon', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    for (const path of iconPaths[name] || iconPaths.report) svg.append(svgEl('path', { d: path }));
    return svg;
  }
  function button(text, className, action) {
    const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', action); return node;
  }
  const format = value => typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(value ?? '—');
  const prettyDate = value => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  const currentExam = () => state.exams.find(exam => exam.exam_date === $('hc-exam').value);
  const flagged = item => { const status = analytics.status(item); return status.outside || status.flagged; };
  const matchingTrend = item => state.trends.find(trend => trend.id === item.id && trend.unit === (item.unit || ''));
  const query = () => $('hc-search').value.trim().toLowerCase();
  const matches = item => [item.name, item.category, item.original].join(' ').toLowerCase().includes(query());
  function badge(text, tone = 'muted', className = '') {
    return el('span', text, `hc-badge hc-tone-${tone} ${className}`);
  }
  function valueNode(value, unit, className = 'hc-result-value') {
    const node = el('span', null, className);
    node.append(el('strong', format(value)), el('span', unit || '', 'hc-unit')); return node;
  }
  function delta(trend, date) {
    const point = trend.points.find(entry => entry.date === date);
    const previous = trend.points.filter(entry => entry.date < date).at(-1);
    if (!point) return { text: 'Not measured this exam', previous: null };
    if (!previous) return { text: 'First measurement', previous: null };
    const difference = Number((point.value - previous.value).toPrecision(10));
    return { text: difference === 0 ? 'No change' : `${difference > 0 ? '↗ +' : '↘ −'}${format(Math.abs(difference))}`, previous, difference };
  }
  function table(headers, rows) {
    const wrap = el('div', null, 'hc-table-wrap'); const node = el('table');
    const head = el('thead'); const tr = el('tr');
    for (const title of headers) { const th = el('th', title); th.scope = 'col'; tr.append(th); }
    head.append(tr); node.append(head);
    const tbody = el('tbody');
    for (const row of rows) {
      const line = el('tr');
      for (const value of row) { const cell = el('td'); cell.append(value?.nodeType ? value : String(value ?? '—')); line.append(cell); }
      tbody.append(line);
    }
    node.append(tbody); wrap.append(node); return wrap;
  }

  // Each observation supplies its own range. A changed hospital range is never
  // painted across the entire history. One-sided ranges end at the plot edge.
  function chart(trend, date, detailed = false, inspect = () => {}) {
    const width = detailed ? 800 : 320; const height = detailed ? 300 : 100;
    const pad = detailed ? { left: 55, right: 28, top: 30, bottom: 38 } : { left: 8, right: 8, top: 14, bottom: 12 };
    const plotWidth = width - pad.left - pad.right; const floor = height - pad.bottom;
    const values = trend.points.flatMap(point => [point.value, point.status.range?.min, point.status.range?.max]).filter(Number.isFinite);
    const min = Math.min(...values); const max = Math.max(...values);
    const span = max - min || Math.max(Math.abs(min) * .1, 1);
    const low = min - span * .16; const high = max + span * .16;
    const start = Date.parse(trend.points[0].date); const end = Date.parse(trend.points.at(-1).date);
    const X = point => end === start ? pad.left + plotWidth / 2 : pad.left + (Date.parse(point.date) - start) / (end - start) * plotWidth;
    const Y = value => floor - (value - low) / (high - low) * (floor - pad.top);
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: `hc-chart${detailed ? ' hc-chart-detailed' : ''}`, preserveAspectRatio: detailed ? 'xMidYMid meet' : 'none' });
    if (detailed) { svg.setAttribute('role', 'group'); svg.setAttribute('aria-label', `${trend.name}, all ${trend.points.length} observations. Focus a point for its date, value and range.`); }
    else svg.setAttribute('aria-hidden', 'true');
    const gradientId = `hc-chart-fill-${++chartSequence}`;
    const defs = svgEl('defs'); const gradient = svgEl('linearGradient', { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(svgEl('stop', { offset: '0%', class: 'hc-gradient-top' }), svgEl('stop', { offset: '100%', class: 'hc-gradient-bottom' }));
    defs.append(gradient); svg.append(defs);
    for (let index = 0; index < trend.points.length; index++) {
      const point = trend.points[index]; const range = point.status.range;
      if (!range) continue;
      const left = index === 0 ? pad.left : (X(trend.points[index - 1]) + X(point)) / 2;
      const right = index === trend.points.length - 1 ? width - pad.right : (X(point) + X(trend.points[index + 1])) / 2;
      const top = range.max === undefined ? pad.top : Y(range.max);
      const bottom = range.min === undefined ? floor : Y(range.min);
      svg.append(svgEl('rect', { x: left, y: top, width: right - left, height: Math.max(0, bottom - top), class: 'hc-reference-band', 'data-date': point.date }));
      for (const bound of ['min', 'max']) if (range[bound] !== undefined) svg.append(svgEl('line', { x1: left, x2: right, y1: Y(range[bound]), y2: Y(range[bound]), class: 'hc-reference-bound' }));
    }
    if (detailed) {
      for (let index = 0; index < 4; index++) {
        const value = low + (high - low) * index / 3;
        svg.append(svgEl('line', { x1: pad.left, x2: width - pad.right, y1: Y(value), y2: Y(value), class: 'hc-gridline' }));
        svg.append(svgEl('text', { x: pad.left - 10, y: Y(value) + 4, 'text-anchor': 'end', class: 'hc-axis-label' }, format(Number(value.toPrecision(3)))));
      }
      const labelEvery = Math.max(1, Math.ceil(trend.points.length / 7));
      trend.points.forEach((point, index) => {
        if (index % labelEvery !== 0 && index !== trend.points.length - 1) return;
        svg.append(svgEl('text', { x: X(point), y: height - 10, 'text-anchor': index === 0 ? 'start' : index === trend.points.length - 1 ? 'end' : 'middle', class: 'hc-axis-label' }, point.date.slice(0, 4)));
      });
    }
    const coordinates = trend.points.map(point => `${X(point)},${Y(point.value)}`);
    if (coordinates.length > 1) {
      const path = `M${coordinates.join(' L')}`;
      svg.append(svgEl('path', { d: `${path} L${X(trend.points.at(-1))},${floor} L${X(trend.points[0])},${floor}Z`, fill: `url(#${gradientId})` }));
      svg.append(svgEl('path', { d: path, class: 'hc-trend-line' }));
    }
    trend.points.forEach((point, index) => {
      const selected = point.date === date;
      if (selected) svg.append(svgEl('line', { x1: X(point), x2: X(point), y1: pad.top - 5, y2: floor + 3, class: 'hc-selected-line' }));
      const tone = body.tone({ rating: point.rating, value: point.value, reference_range: point.reference });
      const label = `${point.date}: ${format(point.value)} ${trend.unit}; ${point.status.label}; grade ${point.rating || 'not recorded'}; range ${point.reference || 'not recorded'}`;
      const dot = svgEl('circle', { cx: X(point), cy: Y(point.value), r: detailed ? 5 : selected ? 4.5 : 3, class: `hc-chart-point hc-tone-${tone}${selected ? ' selected' : ''}`, 'data-date': point.date });
      dot.append(svgEl('title', {}, label));
      if (detailed) {
        dot.setAttribute('tabindex', '0'); dot.setAttribute('role', 'button'); dot.setAttribute('aria-label', label);
        for (const event of ['pointerenter', 'focus', 'click']) dot.addEventListener(event, () => inspect(point));
        dot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(point); } });
        if (trend.points.length <= 6 || selected) svg.append(svgEl('text', { x: X(point), y: Y(point.value) - 13, 'text-anchor': index === 0 ? 'start' : index === trend.points.length - 1 ? 'end' : 'middle', class: 'hc-point-label' }, format(point.value)));
      }
      svg.append(dot);
    });
    return svg;
  }

  function closeDialog() { $('hc-trend-dialog').close(); }
  function openTrend(trend, trigger) {
    const exam = currentExam(); const dialog = $('hc-trend-dialog');
    dialogTrigger = trigger || document.activeElement;
    const current = trend.points.find(point => point.date === exam.exam_date);
    const change = delta(trend, exam.exam_date);
    const header = el('div', null, 'hc-dialog-head');
    const title = el('div'); title.append(el('p', trend.category, 'hc-eyebrow'));
    const heading = el('h2', trend.name); heading.id = 'hc-dialog-title'; title.append(heading, el('p', trend.original || 'Measurement history', 'hc-muted'));
    const close = button(null, 'hc-icon-button', closeDialog); close.setAttribute('aria-label', 'Close trend details'); close.append(icon('close')); header.append(title, close);
    const readout = el('div', null, 'hc-chart-readout'); readout.setAttribute('aria-live', 'polite');
    function inspect(point) {
      readout.replaceChildren(el('span', prettyDate(point.date), 'hc-readout-date'), valueNode(point.value, trend.unit),
        badge(`${point.status.label}${point.rating ? ` · ${point.rating}` : ''}`, body.tone({ rating: point.rating, value: point.value, reference_range: point.reference })),
        el('span', `Reference: ${point.reference || 'not recorded'}`, 'hc-readout-reference'));
    }
    const stats = el('div', null, 'hc-dialog-stats');
    for (const [label, value] of [[`Selected exam · ${exam.exam_date.slice(0, 4)}`, current ? `${format(current.value)} ${trend.unit}` : 'Not measured'], ['Change from previous', current ? change.text : '—'], ['Observations', trend.points.length]]) {
      const stat = el('div'); stat.append(el('span', label), el('strong', value)); stats.append(stat);
    }
    const chartWrap = el('div', null, 'hc-detail-chart-wrap'); chartWrap.append(chart(trend, exam.exam_date, true, inspect));
    inspect(current || trend.points.at(-1));
    const content = $('hc-dialog-content');
    content.replaceChildren(header, stats, chartWrap, readout, el('p', 'Shaded bands show the range recorded at each exam. Hover or focus a point to inspect it.', 'hc-chart-caption'));
    const item = exam.measurements.find(entry => entry.id === trend.id && (entry.unit || '') === trend.unit);
    if (item?.description || item?.why_useful) {
      const about = el('div', null, 'hc-dialog-about');
      if (item.description) about.append(el('p', item.description));
      if (item.why_useful) about.append(el('p', item.why_useful, 'hc-muted'));
      content.append(about);
    }
    const history = el('details', null, 'hc-dialog-history');
    history.append(el('summary', `View all ${trend.points.length} recorded values`), table(['Exam date', `Value ${trend.unit}`, 'Grade', 'Reference range', 'Status'], [...trend.points].reverse().map(point => [
      point.date, format(point.value), badge(point.rating || '—', body.tone({ rating: point.rating, value: point.value, reference_range: point.reference })), point.reference || 'Not recorded', badge(point.status.label, point.status.outside || point.status.flagged ? 'warning' : point.status.range ? 'success' : 'muted'),
    ])));
    content.append(history);
    dialog.showModal();
    document.body.classList.add('hc-dialog-open');
    close.focus();
  }
  $('hc-trend-dialog').addEventListener('close', () => {
    document.body.classList.remove('hc-dialog-open');
    if (dialogTrigger?.isConnected) dialogTrigger.focus();
    $('hc-dialog-content').replaceChildren();
  });
  $('hc-trend-dialog').addEventListener('click', event => {
    if (event.target !== $('hc-trend-dialog')) return;
    const bounds = event.target.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
  });

  function renderYears(exam) {
    $('hc-selected-caption').textContent = exam.exam_date === state.exams.at(-1).exam_date ? 'Latest results' : 'Previous results';
    for (const pill of $('hc-year-pills').children) pill.setAttribute('aria-pressed', String(pill.dataset.year === exam.exam_date.slice(0, 4)));
    $('hc-exam').hidden = state.exams.filter(entry => entry.exam_date.startsWith($('hc-year').value)).length === 1;
    $('hc-footer-date').textContent = `Exam of ${prettyDate(exam.exam_date)}`;
  }
  function renderOverview(exam) {
    const overall = el('article', null, 'hc-overview-card hc-overall-card');
    overall.append(el('p', 'THE SELECTED EXAM', 'hc-eyebrow'));
    const heading = el('div', null, 'hc-overall-heading');
    heading.append(badge(exam.overall_rating || '—', body.tone({ rating: exam.overall_rating }), 'hc-grade-large'), el('div', null, 'hc-overall-date'));
    heading.lastChild.append(el('h2', prettyDate(exam.exam_date)), el('p', 'Overall report grade', 'hc-muted'));
    overall.append(heading, el('p', exam.overall_comment || 'Overall notes have not been added for this exam.', 'hc-overall-excerpt'));
    const noteLink = el('a', 'Read clinic notes →', 'hc-text-link'); noteLink.href = '#hc-notes-section'; overall.append(noteLink);
    const distribution = el('article', null, 'hc-overview-card');
    const numeric = exam.measurements.filter(item => typeof item.value === 'number');
    const outside = numeric.filter(item => analytics.status(item).outside).length;
    const inside = numeric.filter(item => analytics.status(item).label === 'Within range').length;
    const unknown = numeric.length - outside - inside;
    distribution.append(el('p', 'RESULTS IN PERSPECTIVE', 'hc-eyebrow'));
    const distributionBody = el('div', null, 'hc-distribution'); const ring = el('div', null, 'hc-result-ring');
    const first = numeric.length ? inside / numeric.length * 100 : 0;
    const second = numeric.length ? (inside + outside) / numeric.length * 100 : 0;
    ring.style.setProperty('--hc-ring-inside', `${first}%`); ring.style.setProperty('--hc-ring-outside', `${second}%`);
    ring.setAttribute('aria-hidden', 'true'); const ringCenter = el('div'); ringCenter.append(el('strong', numeric.length), el('span', 'numeric tests')); ring.append(ringCenter);
    const legend = el('div', null, 'hc-distribution-legend');
    for (const [count, label, tone] of [[inside, 'Within range', 'success'], [outside, 'Outside range', 'warning'], [unknown, 'No numeric range', 'muted']]) {
      const row = el('div'); row.append(el('i', null, `hc-dot hc-tone-${tone}`), el('span', label), el('strong', count)); legend.append(row);
    }
    distributionBody.append(ring, legend); distribution.append(distributionBody, el('p', `${exam.measurements.length} items across ${new Set(exam.measurements.map(item => item.category)).size} test sections`, 'hc-card-foot'));
    const attention = el('article', null, 'hc-overview-card hc-attention-card');
    const flags = exam.measurements.filter(flagged).sort((a, b) => Number(analytics.status(b).outside) - Number(analytics.status(a).outside));
    const attentionHead = el('div', null, 'hc-attention-head'); attentionHead.append(el('p', 'NEEDS ATTENTION', 'hc-eyebrow'), badge(`${flags.length} flags`, flags.length ? 'warning' : 'muted')); attention.append(attentionHead);
    const list = el('div', null, 'hc-attention-list'); list.id = 'hc-flags';
    if (!flags.length) list.append(el('p', 'No outside-range values or reported flags in this exam.', 'hc-muted'));
    for (const item of state.allFlags ? flags : flags.slice(0, 3)) {
      const trend = matchingTrend(item);
      const row = trend ? button(null, 'hc-attention-item', event => openTrend(trend, event.currentTarget)) : el('div', null, 'hc-attention-item');
      const title = el('div'); title.append(el('strong', item.name), el('small', `${item.category} · ${analytics.status(item).label}`));
      row.append(el('i', null, `hc-dot hc-tone-${body.tone(item)}`), title, valueNode(item.value ?? item.finding ?? item.rating, item.unit));
      list.append(row);
    }
    attention.append(list);
    if (flags.length > 3) attention.append(button(state.allFlags ? 'Show fewer ↑' : `View all ${flags.length} flagged results →`, 'hc-text-button', () => { state.allFlags = !state.allFlags; renderOverview(exam); }));
    $('hc-overview').replaceChildren(overall, distribution, attention);
  }

  const organPaths = {
    eyes: ['M150 62q9-7 18 0-9 8-18 0Z', 'M192 62q9-7 18 0-9 8-18 0Z'],
    ears: ['M139 61c-9-9-12 1-9 12l8 12Z', 'M221 61c9-9 12 1 9 12l-8 12Z'],
    lungs: ['M166 157c-18 2-29 31-29 53 0 13 24 7 32 2V168q0-11-3-11Z', 'M194 157c18 2 29 31 29 53 0 13-18 8-26 2l-9-20v-24q0-11 6-11Z'],
    heart: ['M180 190c-9-13-22-1-16 12 4 9 13 14 20 19 10-10 17-18 12-27-4-8-11-8-16-4Z'],
    liver: ['M137 233c13-13 35-11 53-5 3 8-15 14-28 23-11 7-24-2-25-18Z'],
    stomach: ['M199 222v12c16-5 22 9 16 22-6 12-22 13-29 5-6-7-5-13 1-17l3-22Z'],
    pancreas: ['M159 262c11-6 25-5 38 0 8 3 7 10-3 10-14-3-21 2-32 0-8-2-10-7-3-10Z'],
    kidneys: ['M143 269c-14 0-18 20-10 30 5 7 18 6 17-2-1-6-7-7-5-13 3-6 4-12-2-15Z', 'M217 269c14 0 18 20 10 30-5 7-18 6-17-2 1-6 7-7 5-13-3-6-4-12 2-15Z'],
    bowel: ['M157 286c13 2 30 2 43 0 9-1 13 5 12 13l-2 23c-1 8-6 11-13 8-12-3-25-3-36 0-8 3-13-1-14-9l-1-22c-1-9 4-14 11-13Zm7 10c-5 0-7 4-6 9l1 10c0 5 4 7 9 5 9-2 16-2 24 0 5 2 8 0 8-5l1-10c1-5-2-9-7-9Z'],
  };
  function anatomy(assessments) {
    const svg = svgEl('svg', { viewBox: '0 0 360 550', class: 'hc-anatomy', role: 'group', 'aria-label': 'Body areas colored by the selected exam. Select an area to inspect its results.' });
    svg.append(svgEl('ellipse', { cx: 180, cy: 530, rx: 65, ry: 7, class: 'hc-body-shadow' }));
    svg.append(svgEl('path', { d: 'M145 57c0-25 14-36 35-36s35 11 35 36v22c0 18-17 37-35 37s-35-19-35-37Z', class: 'hc-silhouette' }));
    svg.append(svgEl('path', { d: 'M152 110v20c-17 2-35 5-48 15-15 12-19 33-24 56L58 302c-2 11-13 30-10 39 2 6 7 3 10-3l4-7c-2 19 5 23 10 8l7-27 27-79 8-41 11 77c-7 23-10 46-7 69l13 84 7 79-7 18c-4 8 4 11 13 10l19-3 4-28 6-82 7-68 7 68 6 82 4 28 19 3c9 1 17-2 13-10l-7-18 7-79 13-84c3-23 0-46-7-69l11-77 8 41 27 79 7 27c5 15 12 11 10-8l4 7c3 6 8 9 10 3 3-9-8-28-10-39l-22-101c-5-23-9-44-24-56-13-10-31-13-48-15v-20', class: 'hc-silhouette' }));
    svg.append(svgEl('path', { d: 'M179 70l-3 15h7M170 97q10 4 20 0M154 137q26 12 52 0M180 150v35M130 348q22-9 43 1M187 349q21-10 43-1M142 421h20M198 421h20', class: 'hc-body-contour' }));
    const guideLabels = [['eyes', 64, 158, 62, 'left'], ['ears', 102, 226, 73, 'right'], ['lungs', 169, 144, 181, 'left'], ['heart', 198, 193, 207, 'right'], ['liver', 235, 143, 235, 'left'], ['stomach', 247, 210, 245, 'right'], ['pancreas', 275, 167, 266, 'left'], ['kidneys', 295, 223, 287, 'right'], ['bowel', 326, 157, 313, 'left']];
    for (const [id, paths] of Object.entries(organPaths)) {
      const area = assessments.find(entry => entry.id === id);
      const group = svgEl('g', { class: `hc-organ hc-tone-${area.tone}`, 'data-area': id, role: 'button', tabindex: '0', 'aria-pressed': String(state.bodyArea === id), 'aria-label': `${area.label}: ${area.rating ? `grade ${area.rating}` : area.tone === 'muted' ? 'no rated result' : area.tone === 'success' ? 'within range' : 'flagged result'}` });
      for (const path of paths) group.append(svgEl('path', { d: path, 'fill-rule': 'evenodd' }));
      group.append(svgEl('title', {}, `${area.label} · ${area.items.length} tests${area.rating ? ` · grade ${area.rating}` : ''}`));
      group.addEventListener('click', () => selectBodyArea(id));
      group.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectBodyArea(id); } });
      svg.append(group);
    }
    for (const [id, labelY, organX, organY, side] of guideLabels) {
      const area = assessments.find(entry => entry.id === id); const left = side === 'left';
      const guide = svgEl('g', { class: `hc-anatomy-guide hc-tone-${area.tone}`, 'aria-hidden': 'true' });
      guide.append(svgEl('path', { d: `M${organX} ${organY}L${left ? 100 : 260} ${labelY}H${left ? 30 : 330}` }), svgEl('text', { x: left ? 28 : 332, y: labelY - 7, 'text-anchor': left ? 'start' : 'end' }, area.short));
      svg.append(guide);
    }
    return svg;
  }
  function selectBodyArea(id) {
    state.bodyArea = id;
    renderBody(currentExam(), true);
  }
  function renderBody(exam, keepFocus = false) {
    const assessments = body.assess(exam);
    if (!state.bodyArea) state.bodyArea = [...assessments].sort((a, b) => body.ranks[b.tone] - body.ranks[a.tone])[0].id;
    $('hc-body-date').textContent = prettyDate(exam.exam_date);
    // Retain the SVG and area buttons on selection, preserving keyboard focus.
    if (!keepFocus) {
      $('hc-body-map').replaceChildren(anatomy(assessments));
      $('hc-body-areas').replaceChildren(...assessments.filter(area => area.id !== 'other' || area.items.length).map(area => {
        const node = button(null, `hc-area-button hc-tone-${area.tone}`, () => selectBodyArea(area.id));
        node.dataset.area = area.id; node.setAttribute('aria-pressed', String(state.bodyArea === area.id));
        node.append(icon(area.icon), el('span', area.short), badge(area.rating || (area.tone === 'success' ? '✓' : area.tone === 'muted' ? '—' : '•'), area.tone));
        return node;
      }));
    }
    for (const node of root.querySelectorAll('[data-area]')) node.setAttribute('aria-pressed', String(node.dataset.area === state.bodyArea));
    const area = assessments.find(entry => entry.id === state.bodyArea);
    const detail = $('hc-body-detail'); const head = el('div', null, 'hc-body-detail-head');
    const title = el('div'); title.append(el('p', 'SELECTED AREA', 'hc-eyebrow'), el('h3', area.label));
    head.append(title, badge(area.rating ? `Report grade ${area.rating}` : area.tone === 'success' ? 'Within range' : area.tone === 'muted' ? 'No rated result' : 'Outside range / flagged', area.tone));
    detail.replaceChildren(head);
    detail.append(el('p', area.items.length ? `${area.items.length} associated tests · ${area.flags} reported flags or outside-range values` : 'No tests associated with this area in the selected exam.', 'hc-muted'));
    if (area.sections.length) detail.append(el('p', area.sections.map(section => `${section.name}: ${section.section_rating}`).join(' · '), 'hc-area-grades'));
    if (area.items.length) {
      const list = el('div', null, 'hc-area-results');
      for (const item of [...area.items].sort((a, b) => Number(flagged(b)) - Number(flagged(a)))) {
        const trend = matchingTrend(item);
        const row = trend ? button(null, 'hc-area-result', event => openTrend(trend, event.currentTarget)) : el('div', null, 'hc-area-result');
        const name = el('div'); name.append(el('strong', item.name), el('small', `${item.reference_range ? `Ref. ${item.reference_range}` : item.category}${item.rating ? ` · ${item.rating}` : ''}`));
        row.append(el('i', null, `hc-dot hc-tone-${body.tone(item)}`), name, valueNode(item.value ?? item.finding ?? '—', item.unit));
        if (trend) row.append(icon('chevron'));
        list.append(row);
      }
      detail.append(list);
    }
    if (area.id === 'systemic') detail.append(el('p', 'These tests describe the body as a whole rather than one organ.', 'hc-area-footnote'));
    if (area.id === 'other') detail.append(el('p', 'These report categories have no specific body location assigned.', 'hc-area-footnote'));
  }

  function renderFilters() {
    const filters = [{ key: 'all', label: 'All measurements' }, { key: 'flagged', label: 'Flagged' }, ...[...new Set(state.trends.map(trend => trend.category))].map(category => ({ key: `category:${category}`, label: category }))];
    $('hc-trend-filters').replaceChildren(...filters.map(filter => {
      const node = button(filter.label, 'hc-chip', () => {
        state.filter = filter.key;
        for (const sibling of $('hc-trend-filters').children) sibling.setAttribute('aria-pressed', String(sibling.dataset.filter === state.filter));
        renderTrends(currentExam());
      });
      node.dataset.filter = filter.key; node.setAttribute('aria-pressed', String(state.filter === filter.key)); return node;
    }));
  }
  function renderTrends(exam) {
    const currentItems = new Map(exam.measurements.map(item => [`${item.id}|${item.unit || ''}`, item]));
    const trends = state.trends.filter(matches).filter(trend => state.filter === 'all'
      || (state.filter === 'flagged' ? currentItems.has(trend.key) && flagged(currentItems.get(trend.key)) : state.filter === `category:${trend.category}`));
    trends.sort((a, b) => Number(Boolean(currentItems.has(b.key) && flagged(currentItems.get(b.key)))) - Number(Boolean(currentItems.has(a.key) && flagged(currentItems.get(a.key)))));
    $('hc-trend-count').textContent = `${trends.length} measurements`;
    $('hc-trends').replaceChildren(...trends.map(trend => {
      const current = trend.points.find(point => point.date === exam.exam_date); const item = currentItems.get(trend.key);
      const tone = item ? body.tone(item) : 'muted'; const change = delta(trend, exam.exam_date);
      const card = button(null, `hc-trend-card hc-tone-${tone}`, event => openTrend(trend, event.currentTarget));
      card.setAttribute('aria-label', `${trend.name}${trend.original ? `, ${trend.original}` : ''}, ${current ? `${format(current.value)} ${trend.unit}` : 'not measured in this exam'}. Open full trend.`);
      const top = el('div', null, 'hc-trend-top');
      const title = el('div'); title.append(el('span', trend.category, 'hc-trend-category'), el('h3', trend.name));
      top.append(title, icon('expand'));
      const metadata = el('div', null, 'hc-trend-metadata'); metadata.append(el('span', trend.original || 'Measurement', 'hc-original-label'), badge(item?.rating || (current ? current.status.outside ? 'Outside' : current.status.range ? 'In range' : 'Unrated' : 'No result'), tone));
      const value = el('div', null, 'hc-trend-value'); value.append(valueNode(current?.value, trend.unit));
      if (current) value.append(el('span', change.text, 'hc-delta'));
      else value.append(el('span', 'Not measured this exam', 'hc-missing-label'));
      const plot = el('div', null, 'hc-sparkline'); plot.append(chart(trend, exam.exam_date));
      const foot = el('div', null, 'hc-trend-foot');
      foot.append(el('span', trend.points[0].date.slice(0, 4)), el('span', `${trend.points.length} observations${change.previous ? ` · change vs ${change.previous.date.slice(0, 4)}` : ''}`), el('span', trend.points.at(-1).date.slice(0, 4)));
      card.append(top, metadata, value, plot, foot); return card;
    }));
    if (!trends.length) $('hc-trends').append(el('p', 'No numeric trends match this filter.', 'hc-empty'));
  }
  function renderMeasurements(exam) {
    const categories = [...new Set(exam.measurements.filter(matches).map(item => item.category))];
    $('hc-measurement-count').textContent = `${categories.length} sections · open to explore`;
    $('hc-measurements').replaceChildren(...categories.map(category => {
      const items = exam.measurements.filter(item => item.category === category && matches(item));
      const section = (exam.sections || []).find(entry => entry.name === category);
      const details = el('details', null, 'hc-category');
      const key = `${exam.exam_date}|${category}`; details.open = Boolean(query()) || state.openCategories.has(key);
      details.addEventListener('toggle', () => { if (details.isConnected && !query()) { if (details.open) state.openCategories.add(key); else state.openCategories.delete(key); } });
      const summary = el('summary'); const area = body.areas.find(entry => entry.id === body.areaFor(items[0]));
      const mark = el('span', null, 'hc-category-icon'); mark.append(icon(area.icon));
      const title = el('span', null, 'hc-category-title'); title.append(el('strong', category), el('small', `${items.length} items${section?.original_japanese ? ` · ${section.original_japanese}` : ''}`));
      const flags = items.filter(flagged).length;
      summary.append(mark, title);
      if (flags) summary.append(badge(`${flags} flagged`, 'warning'));
      if (section?.section_rating) summary.append(badge(section.section_rating, body.tone({ rating: section.section_rating })));
      summary.append(icon('chevron')); details.append(summary);
      const grid = el('div', null, 'hc-test-grid');
      for (const item of items) {
        const tile = el('article', null, 'hc-test');
        const header = el('div', null, 'hc-test-head'); header.append(el('h3', item.name), badge(item.rating || '—', body.tone(item)));
        tile.append(header, el('p', item.original || '', 'hc-test-original'), valueNode(item.value ?? item.finding ?? 'Not recorded', item.unit));
        tile.append(el('p', item.reference_range ? `Reference · ${item.reference_range}` : 'No reference range recorded', 'hc-test-reference'));
        const trend = matchingTrend(item);
        if (trend) { const action = button(' Explore trend', 'hc-text-button', event => openTrend(trend, event.currentTarget)); action.prepend(icon('trend')); tile.append(action); }
        if (item.description || item.why_useful || item.finding) {
          const about = el('details', null, 'hc-test-about'); about.append(el('summary', 'About this result'));
          for (const field of ['description', 'why_useful', 'finding']) if (item[field]) about.append(el('p', item[field]));
          tile.append(about);
        }
        grid.append(tile);
      }
      details.append(grid); return details;
    }));
    if (!categories.length) $('hc-measurements').append(el('p', 'No measurements match your search.', 'hc-empty'));
  }
  function renderNotes(exam) {
    const container = $('hc-notes'); const tabs = el('div', null, 'hc-note-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Clinic notes');
    const panels = el('div', null, 'hc-note-panels'); const fields = Object.entries(analytics.notes);
    const selectNote = field => {
      state.note = field;
      for (const tab of tabs.children) { const active = tab.dataset.field === field; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
      for (const panel of panels.children) panel.hidden = panel.id !== `hc-note-panel-${field}`;
    };
    fields.forEach(([field, label], index) => {
      const tab = button(label, 'hc-note-tab', () => selectNote(field)); tab.dataset.field = field; tab.id = `hc-note-tab-${field}`;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `hc-note-panel-${field}`);
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? fields.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + fields.length) % fields.length;
        selectNote(fields[next][0]); tabs.children[next].focus();
      }); tabs.append(tab);
      const panel = el('div', null, 'hc-note-panel'); panel.id = `hc-note-panel-${field}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.tabIndex = 0;
      panel.append(el('p', `${label} · ${prettyDate(exam.exam_date)}`, 'hc-note-meta'), el('p', exam[field] || 'No notes recorded for this exam yet.', 'hc-note'));
      if (field === 'metabolic_comment' && exam.metabolic_syndrome_determination) panel.append(el('p', exam.metabolic_syndrome_determination, 'hc-metabolic-note'));
      panels.append(panel);
    });
    container.replaceChildren(tabs, panels);
    if (exam.institution || exam.doctor) container.append(el('p', [exam.institution, exam.doctor].filter(Boolean).join(' · '), 'hc-clinic-credit'));
    selectNote(state.note);
  }
  function render() {
    const exam = currentExam(); if (!exam) return;
    renderYears(exam); renderOverview(exam); renderBody(exam); renderTrends(exam); renderMeasurements(exam); renderNotes(exam);
    $('hc-summary').value = analytics.summary(exam); $('hc-copy-status').textContent = '';
  }
  function selectYear() {
    state.allFlags = false;
    const available = state.exams.filter(exam => exam.exam_date.startsWith($('hc-year').value));
    $('hc-exam').replaceChildren(...[...available].reverse().map(exam => { const option = el('option', prettyDate(exam.exam_date)); option.value = exam.exam_date; return option; }));
    render();
  }
  $('hc-year').addEventListener('change', selectYear);
  $('hc-exam').addEventListener('change', () => { state.allFlags = false; render(); });
  $('hc-search').addEventListener('input', () => { renderTrends(currentExam()); renderMeasurements(currentExam()); });
  $('hc-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('hc-summary').value); $('hc-copy-status').textContent = 'Summary copied. Ready to take with you.'; }
    catch (_) { $('hc-summary-details').open = true; $('hc-summary').focus(); $('hc-summary').select(); $('hc-copy-status').textContent = 'Select and copy the highlighted text with your keyboard or device menu.'; }
  });
  (async () => {
    try {
      const response = await fetch('/health-check/api/history', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again.' : 'Unable to load health-check history. Please retry.');
      const data = await response.json(); state.exams = data.exams.sort((a, b) => a.exam_date.localeCompare(b.exam_date));
      if (!state.exams.length) { $('hc-message').textContent = 'No health checks yet. Import your first report to start your history.'; return; }
      state.trends = analytics.trends(state.exams);
      const years = [...new Set(state.exams.map(exam => exam.exam_date.slice(0, 4)))];
      $('hc-history-span').textContent = `${years[0]}–${years.at(-1)} · ${state.exams.length} exams`;
      $('hc-year').replaceChildren(...[...years].reverse().map(year => { const option = el('option', year); option.value = year; return option; }));
      $('hc-year-pills').replaceChildren(...years.map(year => {
        const latest = state.exams.filter(exam => exam.exam_date.startsWith(year)).at(-1);
        const pill = button(null, 'hc-year-pill', () => { $('hc-year').value = year; selectYear(); }); pill.dataset.year = year;
        pill.append(el('span', year));
        if (latest.overall_rating) pill.append(badge(latest.overall_rating, body.tone({ rating: latest.overall_rating })));
        return pill;
      }));
      renderFilters(); $('hc-message').textContent = ''; $('hc-dashboard').hidden = false; selectYear();
      $('hc-year-pills').lastElementChild.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (error) { $('hc-message').textContent = error.message; }
  })();
})();
