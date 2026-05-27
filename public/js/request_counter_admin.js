(() => {
  let chartData = null;
  let resizeTimer = null;

  document.addEventListener('DOMContentLoaded', () => {
    chartData = readChartData();
    renderChart();
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(renderChart, 120);
    });
  });

  function readChartData() {
    const element = document.getElementById('requestCounterData');
    if (!element) {
      return { points: [], limit: 0, windowMinutes: 90 };
    }

    try {
      return JSON.parse(element.textContent || '{}');
    } catch (error) {
      return { points: [], limit: 0, windowMinutes: 90 };
    }
  }

  function renderChart() {
    const container = document.getElementById('requestCounterChart');
    if (!container) {
      return;
    }

    container.innerHTML = '';

    if (typeof d3 === 'undefined') {
      renderEmpty(container, 'Chart library unavailable.');
      return;
    }

    const points = Array.isArray(chartData?.points)
      ? chartData.points.map((point) => ({
        ...point,
        date: new Date(point.timestamp),
        minutes: Number(point.count) || 0,
      })).filter((point) => !Number.isNaN(point.date.getTime()))
      : [];

    if (!points.length) {
      renderEmpty(container, 'No request records yet.');
      return;
    }

    const width = Math.max(360, container.clientWidth || 720);
    const height = 320;
    const margin = { top: 18, right: 24, bottom: 38, left: 48 };
    const limit = Math.max(0, Number(chartData?.limit) || 0);
    const maxMinutes = d3.max(points, (point) => point.minutes) || 0;
    const yMax = Math.max(1, limit, maxMinutes) * 1.15;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'Rolling minutes chart');

    const x = d3.scaleTime()
      .domain(d3.extent(points, (point) => point.date))
      .range([margin.left, width - margin.right]);
    const y = d3.scaleLinear()
      .domain([0, yMax])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const area = d3.area()
      .x((point) => x(point.date))
      .y0(y(0))
      .y1((point) => y(point.minutes));
    const line = d3.line()
      .x((point) => x(point.date))
      .y((point) => y(point.minutes));

    svg.append('path')
      .datum(points)
      .attr('fill', 'rgba(255, 194, 71, 0.18)')
      .attr('d', area);

    svg.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', '#FFC247')
      .attr('stroke-width', 2)
      .attr('d', line);

    if (limit > 0) {
      svg.append('line')
        .attr('x1', margin.left)
        .attr('x2', width - margin.right)
        .attr('y1', y(limit))
        .attr('y2', y(limit))
        .attr('stroke', '#FF6A1F')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6 4');

      svg.append('text')
        .attr('x', width - margin.right)
        .attr('y', Math.max(margin.top + 12, y(limit) - 6))
        .attr('text-anchor', 'end')
        .attr('fill', '#FF7C3B')
        .attr('font-size', 12)
        .text(`limit ${limit} min`);
    }

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .attr('color', '#C1C7D3')
      .call(d3.axisBottom(x).ticks(Math.min(8, points.length)).tickSizeOuter(0));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .attr('color', '#C1C7D3')
      .call(d3.axisLeft(y).ticks(5).tickFormat((value) => Math.round(value)));

    addHover(container, svg, points, x, y, width, height, margin);
  }

  function addHover(container, svg, points, x, y, width, height, margin) {
    const tooltip = document.createElement('div');
    tooltip.className = 'request-counter-chart__tooltip';
    tooltip.hidden = true;
    container.appendChild(tooltip);

    const focusLine = svg.append('line')
      .attr('y1', margin.top)
      .attr('y2', height - margin.bottom)
      .attr('stroke', '#E8ECF2')
      .attr('stroke-width', 1)
      .attr('opacity', 0);
    const focusDot = svg.append('circle')
      .attr('r', 4)
      .attr('fill', '#FFC247')
      .attr('stroke', '#0E0F13')
      .attr('stroke-width', 2)
      .attr('opacity', 0);
    const bisect = d3.bisector((point) => point.date).left;

    svg.append('rect')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', width - margin.left - margin.right)
      .attr('height', height - margin.top - margin.bottom)
      .attr('fill', 'transparent')
      .on('mousemove', (event) => {
        const [mouseX] = d3.pointer(event);
        const hoveredDate = x.invert(mouseX);
        const index = Math.min(points.length - 1, Math.max(0, bisect(points, hoveredDate)));
        const previous = points[Math.max(0, index - 1)];
        const next = points[index];
        const point = !previous || (next && hoveredDate - previous.date > next.date - hoveredDate)
          ? next
          : previous;
        if (!point) {
          return;
        }

        const pointX = x(point.date);
        const pointY = y(point.minutes);
        focusLine.attr('x1', pointX).attr('x2', pointX).attr('opacity', 0.45);
        focusDot.attr('cx', pointX).attr('cy', pointY).attr('opacity', 1);
        tooltip.hidden = false;
        tooltip.innerHTML = `<strong>${point.minutes.toLocaleString('en-US')} min</strong><br>${formatMinute(point.date)}`;
        const left = Math.min(container.clientWidth - 170, Math.max(8, pointX + 12));
        const top = Math.max(8, pointY - 36);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      })
      .on('mouseleave', () => {
        focusLine.attr('opacity', 0);
        focusDot.attr('opacity', 0);
        tooltip.hidden = true;
      });
  }

  function renderEmpty(container, message) {
    const fallback = document.createElement('p');
    fallback.className = 'request-counter-chart__empty';
    fallback.textContent = message;
    container.appendChild(fallback);
  }

  function formatMinute(date) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: '2-digit',
    }).format(date);
  }
})();
