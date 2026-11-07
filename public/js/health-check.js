(() => {
  'use strict';
  const root = document.getElementById('health-check');
  if (!root) return;
  const $ = id => document.getElementById(id); const analytics = window.HealthCheckAnalytics;
  let exams = []; let allTrends = [];
  function el(tag, text, className) {
    const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node;
  }
  function table(headers, rows) {
    const wrap = el('div', null, 'hc-table-wrap'); const node = el('table'); const head = el('thead'); const tr = el('tr');
    headers.forEach(title => { const th = el('th', title); th.scope = 'col'; tr.append(th); }); head.append(tr); node.append(head);
    const body = el('tbody'); rows.forEach(row => { const line = el('tr'); row.forEach(value => { const cell = el('td'); cell.append(value?.nodeType ? value : String(value ?? '—')); line.append(cell); }); body.append(line); });
    node.append(body); wrap.append(node); return wrap;
  }
  function chart(trend, selected) {
    const ns = 'http://www.w3.org/2000/svg'; const width = Math.max(360, trend.points.length * 55); const height = 190;
    function svgEl(tag, attrs, text) { const node = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); if (text != null) node.textContent = text; return node; }
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'hc-chart', role: 'img', 'aria-label': `${trend.name}: ${trend.points.length} measurements across all years. Exact values in the table below.` });
    svg.style.minWidth = `${width}px`;
    const min = Math.min(...trend.points.map(point => point.value)); const max = Math.max(...trend.points.map(point => point.value)); const span = max - min || Math.max(Math.abs(min) * .1, 1);
    const low = min - span * .15; const high = max + span * .15;
    const start = Date.parse(trend.points[0].date); const end = Date.parse(trend.points.at(-1).date);
    const x = point => end === start ? width / 2 : 48 + (Date.parse(point.date) - start) / (end - start) * (width - 75);
    const y = value => 145 - (value - low) / (high - low) * 120;
    for (const value of [min, max === min ? min + span : max]) {
      svg.append(svgEl('line', { x1: 45, y1: y(value), x2: width - 20, y2: y(value), class: 'axis' }));
      svg.append(svgEl('text', { x: 3, y: y(value) + 4 }, Number(value.toPrecision(5))));
    }
    svg.append(svgEl('polyline', { points: trend.points.map(point => `${x(point)},${y(point.value)}`).join(' '), class: 'line' }));
    const years = new Set();
    for (const point of trend.points) {
      const circle = svgEl('circle', { cx: x(point), cy: y(point.value), r: point.date === selected ? 5 : 3, class: point.date === selected ? 'selected' : '' });
      circle.append(svgEl('title', {}, `${point.date}: ${point.value} ${trend.unit}; ${point.status.label}; range: ${point.reference || 'not recorded'}`)); svg.append(circle);
      const year = point.date.slice(0, 4);
      if (!years.has(year)) { svg.append(svgEl('text', { x: x(point), y: 175, 'text-anchor': 'middle' }, year)); years.add(year); }
    }
    const wrap = el('div', null, 'hc-chart-wrap'); wrap.append(svg); return wrap;
  }
  function matches(item) { const query = $('hc-search').value.trim().toLowerCase(); return [item.name, item.category, item.original].join(' ').toLowerCase().includes(query); }
  function render() {
    const exam = exams.find(entry => entry.exam_date === $('hc-exam').value); if (!exam) return;
    const outside = exam.measurements.filter(item => analytics.status(item).outside);
    const flagged = exam.measurements.filter(item => analytics.status(item).flagged || analytics.status(item).outside);
    const measured = exam.measurements.filter(item => item.value != null || item.finding);
    $('hc-overview').replaceChildren(...[[measured.length, 'Recorded results'], [outside.length, 'Outside reference range'], [exam.overall_rating || '—', 'Overall rating'], [exams.length, 'Exams in history']].map(([value, label]) => {
      const stat = el('div', null, 'hc-stat'); stat.append(el('strong', value), el('span', label)); return stat;
    }));
    $('hc-flags').replaceChildren();
    if (!flagged.length) $('hc-flags').append(el('p', 'No numeric outside-range values or reported flags found for this exam.'));
    else $('hc-flags').append(table(['Measurement', 'Result', 'Reference', 'Status'], flagged.map(item => [
      `${item.category} / ${item.name}${item.original ? ` · ${item.original}` : ''}`, `${item.value ?? item.finding ?? '—'} ${item.unit || ''}`, item.reference_range || 'Not recorded', el('span', `${analytics.status(item).label}${item.rating ? ` · ${item.rating}` : ''}`, analytics.status(item).outside ? 'hc-outside' : 'hc-alert'),
    ])));
    $('hc-trends').replaceChildren();
    const trends = allTrends.filter(matches).filter(trend => !$('hc-trend-flags').checked || flagged.some(item => item.id === trend.id && (item.unit || '') === trend.unit));
    for (const trend of trends) {
      const card = el('article', null, 'hc-trend'); const current = trend.points.find(point => point.date === exam.exam_date);
      const previous = trend.points.filter(point => point.date < exam.exam_date).at(-1);
      card.append(el('small', trend.category), el('h3', trend.name), el('small', trend.original || ''), el('p', current ? `${current.value} ${trend.unit}${previous ? ` · change ${(current.value - previous.value).toFixed(3).replace(/\.?0+$/, '') || '0'} since ${previous.date}` : ''}` : 'Not measured in selected exam'));
      card.append(chart(trend, exam.exam_date));
      const details = el('details'); details.append(el('summary', `All ${trend.points.length} values and reference ranges`), table(['Date', `Value ${trend.unit}`, 'Reference', 'Status'], trend.points.map(point => [point.date, point.value, point.reference || 'Not recorded', point.status.label]))); card.append(details); $('hc-trends').append(card);
    }
    if (!trends.length) $('hc-trends').append(el('p', 'No numeric trends match this filter.'));
    $('hc-measurements').replaceChildren();
    const categories = [...new Set(exam.measurements.filter(matches).map(item => item.category))];
    for (const category of categories) {
      const details = el('details'); details.open = true;
      const section = exam.sections.find(entry => entry.name === category);
      details.append(el('summary', `${category}${section?.section_rating ? ` · ${section.section_rating}` : ''}`));
      details.append(table(['Measurement', 'Result', 'Reference / rating', 'Details'], exam.measurements.filter(item => item.category === category && matches(item)).map(item => {
        const description = el('details'); description.append(el('summary', 'About this measurement'));
        for (const field of ['description', 'why_useful', 'finding']) if (item[field]) description.append(el('p', item[field]));
        return [`${item.name}${item.original ? ` · ${item.original}` : ''}`, `${item.value ?? item.finding ?? 'Not recorded'} ${item.unit || ''}`, `${item.reference_range || '—'} / ${item.rating || '—'}`, description];
      })));
      $('hc-measurements').append(details);
    }
    $('hc-notes').replaceChildren(el('p', [exam.institution, exam.doctor].filter(Boolean).join(' · '), 'hc-muted'));
    if (exam.metabolic_syndrome_determination) $('hc-notes').append(el('p', `Metabolic syndrome determination: ${exam.metabolic_syndrome_determination}`));
    for (const [field, label] of Object.entries(analytics.notes)) $('hc-notes').append(el('h3', label), el('p', exam[field] || 'No notes recorded for this exam yet.', 'hc-note'));
    $('hc-summary').value = analytics.summary(exam); $('hc-copy-status').textContent = '';
  }
  function selectYear() {
    const available = exams.filter(exam => exam.exam_date.startsWith($('hc-year').value));
    $('hc-exam').replaceChildren(...[...available].reverse().map(exam => { const option = el('option', exam.exam_date); option.value = exam.exam_date; return option; })); render();
  }
  $('hc-year').addEventListener('change', selectYear);
  for (const id of ['hc-exam', 'hc-trend-flags']) $(id).addEventListener('change', render);
  $('hc-search').addEventListener('input', render);
  $('hc-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('hc-summary').value); $('hc-copy-status').textContent = 'Summary copied.'; }
    catch (_) { $('hc-summary').focus(); $('hc-summary').select(); $('hc-copy-status').textContent = 'Select and copy the highlighted text with your keyboard or device menu.'; }
  });
  (async () => {
    try {
      const response = await fetch('/health-check/api/history', { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again.' : 'Unable to load health-check history. Please retry.');
      const data = await response.json(); exams = data.exams.sort((a, b) => a.exam_date.localeCompare(b.exam_date));
      if (!exams.length) { $('hc-message').textContent = 'No health checks yet. Import your first report to start your history.'; return; }
      allTrends = analytics.trends(exams);
      $('hc-year').replaceChildren(...[...new Set(exams.map(exam => exam.exam_date.slice(0, 4)))].reverse().map(year => { const option = el('option', year); option.value = year; return option; }));
      $('hc-message').textContent = ''; $('hc-dashboard').hidden = false; selectYear();
    } catch (error) { $('hc-message').textContent = error.message; }
  })();
})();
