(function () {
  const dataElement = document.getElementById('minuteLoggerBatteryData');
  const root = document.querySelector('[data-minute-logger-battery]');

  if (!dataElement || !root) {
    return;
  }

  let data = {};

  try {
    data = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    data = {};
  }

  const svg = root.querySelector('[data-minute-logger-battery-svg]');
  const slider = root.querySelector('[data-minute-logger-battery-slider]');
  const startOutput = root.querySelector('[data-minute-logger-battery-start]');
  const endOutput = root.querySelector('[data-minute-logger-battery-end]');
  const summary = root.querySelector('[data-minute-logger-battery-summary]');
  const packages = Array.isArray(data.packages) ? data.packages : [];
  const rawPoints = Array.isArray(data.points) ? data.points : [];

  function normalizeOptionalNumber(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  const points = rawPoints
    .map((point) => ({
      t: Number(point.t),
      b: normalizeOptionalNumber(point.b),
      c: normalizeOptionalNumber(point.c),
      p: Number.isInteger(point.p) ? point.p : null,
    }))
    .filter((point) => Number.isFinite(point.t))
    .sort((left, right) => left.t - right.t);
  const now = Date.now();
  const retentionStartMs = Number.isFinite(Number(data.retentionStartMs))
    ? Number(data.retentionStartMs)
    : (points[0]?.t || (now - (60 * 24 * 60 * 60 * 1000)));
  const retentionEndMs = Number.isFinite(Number(data.retentionEndMs))
    ? Number(data.retentionEndMs)
    : now;
  const windowHours = Math.max(1, Number(data.windowHours) || 12);
  const minuteMs = 60 * 1000;
  const windowMs = windowHours * 60 * minuteMs;
  const maxBandGapMs = 3 * minuteMs;
  const chartWidth = 960;
  const chartHeight = 430;
  const padding = {
    top: 34,
    right: 74,
    bottom: 58,
    left: 62,
  };
  const plot = {
    x: padding.left,
    y: padding.top,
    width: chartWidth - padding.left - padding.right,
    height: chartHeight - padding.top - padding.bottom,
  };
  const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const numberFormatter = new Intl.NumberFormat(undefined);

  function createSvgElement(name) {
    return document.createElementNS('http://www.w3.org/2000/svg', name);
  }

  function clearNode(node) {
    if (!node) {
      return;
    }

    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function setAttributes(node, attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        return;
      }

      node.setAttribute(key, String(value));
    });
  }

  function appendSvg(parent, name, attrs = {}, text = null) {
    const node = createSvgElement(name);
    setAttributes(node, attrs);

    if (text !== null && text !== undefined) {
      node.textContent = String(text);
    }

    parent.appendChild(node);
    return node;
  }

  function formatDateTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return 'N/A';
    }

    return dateTimeFormatter.format(date);
  }

  function formatCount(value) {
    return numberFormatter.format(Number(value) || 0);
  }

  function hexToRgba(hex, alpha) {
    const value = String(hex || '').trim();

    if (!value.startsWith('#')) {
      return value || `rgba(25, 227, 227, ${alpha})`;
    }

    let normalized = value.slice(1);
    if (normalized.length === 3) {
      normalized = normalized.split('').map((char) => `${char}${char}`).join('');
    }

    if (!/^[0-9a-f]{6}$/iu.test(normalized)) {
      return `rgba(25, 227, 227, ${alpha})`;
    }

    const red = parseInt(normalized.slice(0, 2), 16);
    const green = parseInt(normalized.slice(2, 4), 16);
    const blue = parseInt(normalized.slice(4, 6), 16);

    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function lowerBoundByTime(rows, time) {
    let low = 0;
    let high = rows.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (rows[middle].t < time) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function buildTempDomain(windowPoints) {
    const values = windowPoints
      .map((point) => point.c)
      .filter((value) => Number.isFinite(value));

    if (!values.length) {
      return { min: 20, max: 45 };
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const paddingValue = Math.max(2, (max - min) * 0.18);

    if (min === max) {
      return {
        min: min - 2,
        max: max + 2,
      };
    }

    return {
      min: min - paddingValue,
      max: max + paddingValue,
    };
  }

  function projectX(time, windowStart, effectiveWindowMs) {
    return plot.x + (clamp((time - windowStart) / effectiveWindowMs, 0, 1) * plot.width);
  }

  function projectChargeY(value) {
    return plot.y + ((1 - (clamp(value, 0, 100) / 100)) * plot.height);
  }

  function projectTempY(value, domain) {
    const span = Math.max(1, domain.max - domain.min);
    return plot.y + ((1 - clamp((value - domain.min) / span, 0, 1)) * plot.height);
  }

  function drawPackageBands(group, windowStart, windowEnd, effectiveWindowMs) {
    const startIndex = Math.max(0, lowerBoundByTime(points, windowStart) - 1);

    for (let index = startIndex; index < points.length; index += 1) {
      const point = points[index];
      const next = points[index + 1] || null;

      if (point.t >= windowEnd) {
        break;
      }

      if (
        point.t < windowStart
        && (!next || next.t <= windowStart || next.t - point.t > maxBandGapMs)
      ) {
        continue;
      }

      const bandStart = Math.max(point.t, windowStart);
      let bandEnd = Math.min(point.t + minuteMs, windowEnd);

      if (next && next.t > point.t && next.t - point.t <= maxBandGapMs) {
        bandEnd = Math.min(next.t, windowEnd);
      }

      if (point.t < windowStart && next) {
        bandEnd = Math.min(next.t, windowEnd);
      }

      if (bandEnd <= bandStart) {
        continue;
      }

      const packageEntry = Number.isInteger(point.p) ? packages[point.p] : null;
      const fill = packageEntry
        ? hexToRgba(packageEntry.color, 0.24)
        : 'rgba(154, 163, 178, 0.14)';
      const rect = appendSvg(group, 'rect', {
        class: packageEntry
          ? 'minute-logger-battery-chart__band'
          : 'minute-logger-battery-chart__band minute-logger-battery-chart__band--empty',
        x: projectX(bandStart, windowStart, effectiveWindowMs).toFixed(2),
        y: plot.y,
        width: Math.max(1, projectX(bandEnd, windowStart, effectiveWindowMs) - projectX(bandStart, windowStart, effectiveWindowMs)).toFixed(2),
        height: plot.height,
        fill,
      });
      const title = appendSvg(rect, 'title');
      title.textContent = packageEntry ? packageEntry.name : 'No active package';
    }
  }

  function drawAxes(group, windowStart, effectiveWindowMs, tempDomain) {
    appendSvg(group, 'rect', {
      class: 'minute-logger-battery-chart__plot-frame',
      x: plot.x,
      y: plot.y,
      width: plot.width,
      height: plot.height,
      rx: 8,
    });

    [0, 25, 50, 75, 100].forEach((tick) => {
      const y = projectChargeY(tick);
      appendSvg(group, 'line', {
        class: 'minute-logger-battery-chart__grid',
        x1: plot.x,
        y1: y.toFixed(2),
        x2: plot.x + plot.width,
        y2: y.toFixed(2),
      });
      appendSvg(group, 'text', {
        class: 'minute-logger-battery-chart__axis-label',
        x: plot.x - 10,
        y: (y + 4).toFixed(2),
        'text-anchor': 'end',
      }, `${tick}%`);
    });

    const tempTicks = [
      tempDomain.min,
      (tempDomain.min + tempDomain.max) / 2,
      tempDomain.max,
    ];
    tempTicks.forEach((tick) => {
      const y = projectTempY(tick, tempDomain);
      appendSvg(group, 'text', {
        class: 'minute-logger-battery-chart__axis-label minute-logger-battery-chart__axis-label--temp',
        x: plot.x + plot.width + 10,
        y: (y + 4).toFixed(2),
      }, `${tick.toFixed(1)} C`);
    });

    Array.from({ length: 5 }, (_, index) => index).forEach((index) => {
      const tickTime = windowStart + ((effectiveWindowMs / 4) * index);
      const x = projectX(tickTime, windowStart, effectiveWindowMs);
      appendSvg(group, 'line', {
        class: 'minute-logger-battery-chart__grid minute-logger-battery-chart__grid--time',
        x1: x.toFixed(2),
        y1: plot.y,
        x2: x.toFixed(2),
        y2: plot.y + plot.height,
      });
      appendSvg(group, 'text', {
        class: 'minute-logger-battery-chart__axis-label',
        x: x.toFixed(2),
        y: plot.y + plot.height + 28,
        'text-anchor': 'middle',
      }, formatDateTime(tickTime));
    });

    appendSvg(group, 'text', {
      class: 'minute-logger-battery-chart__axis-title',
      x: plot.x,
      y: 18,
    }, 'Charge left');
    appendSvg(group, 'text', {
      class: 'minute-logger-battery-chart__axis-title minute-logger-battery-chart__axis-title--temp',
      x: plot.x + plot.width,
      y: 18,
      'text-anchor': 'end',
    }, 'Battery temperature');
  }

  function buildLinePath(windowPoints, field, yProjector, windowStart, effectiveWindowMs) {
    let path = '';
    let previousTime = null;

    windowPoints.forEach((point) => {
      const value = point[field];

      if (!Number.isFinite(value)) {
        return;
      }

      const x = projectX(point.t, windowStart, effectiveWindowMs);
      const y = yProjector(value);
      const command = previousTime !== null && point.t - previousTime <= maxBandGapMs ? 'L' : 'M';
      path += `${command}${x.toFixed(2)} ${y.toFixed(2)} `;
      previousTime = point.t;
    });

    return path.trim();
  }

  function drawLatestMarker(group, windowPoints, field, yProjector, windowStart, effectiveWindowMs, className) {
    const latest = windowPoints
      .slice()
      .reverse()
      .find((point) => Number.isFinite(point[field]));

    if (!latest) {
      return;
    }

    appendSvg(group, 'circle', {
      class: `minute-logger-battery-chart__marker ${className}`,
      cx: projectX(latest.t, windowStart, effectiveWindowMs).toFixed(2),
      cy: yProjector(latest[field]).toFixed(2),
      r: 5,
    });
  }

  function drawEmptyMessage(group, message) {
    appendSvg(group, 'text', {
      class: 'minute-logger-battery-chart__empty',
      x: plot.x + (plot.width / 2),
      y: plot.y + (plot.height / 2),
      'text-anchor': 'middle',
    }, message);
  }

  function render(windowStart) {
    if (!svg) {
      return;
    }

    const clampedStart = clamp(windowStart, retentionStartMs, Math.max(retentionStartMs, retentionEndMs - windowMs));
    const windowEnd = Math.min(clampedStart + windowMs, retentionEndMs);
    const effectiveWindowMs = Math.max(minuteMs, windowEnd - clampedStart);
    const windowPoints = points.filter((point) => point.t >= clampedStart && point.t <= windowEnd);
    const chargeCount = windowPoints.filter((point) => Number.isFinite(point.b)).length;
    const tempCount = windowPoints.filter((point) => Number.isFinite(point.c)).length;
    const activePackageCount = new Set(windowPoints
      .map((point) => point.p)
      .filter((packageIndex) => Number.isInteger(packageIndex))).size;
    const noActiveCount = windowPoints.filter((point) => point.p === null).length;
    const tempDomain = buildTempDomain(windowPoints);

    clearNode(svg);
    setAttributes(svg, {
      viewBox: `0 0 ${chartWidth} ${chartHeight}`,
    });

    appendSvg(svg, 'rect', {
      class: 'minute-logger-battery-chart__background',
      width: chartWidth,
      height: chartHeight,
      rx: 8,
    });
    drawPackageBands(svg, clampedStart, windowEnd, effectiveWindowMs);
    drawAxes(svg, clampedStart, effectiveWindowMs, tempDomain);

    const chargePath = buildLinePath(windowPoints, 'b', projectChargeY, clampedStart, effectiveWindowMs);
    if (chargePath) {
      appendSvg(svg, 'path', {
        class: 'minute-logger-battery-chart__line minute-logger-battery-chart__line--charge',
        d: chargePath,
      });
      drawLatestMarker(svg, windowPoints, 'b', projectChargeY, clampedStart, effectiveWindowMs, 'minute-logger-battery-chart__marker--charge');
    }

    const tempPath = buildLinePath(windowPoints, 'c', (value) => projectTempY(value, tempDomain), clampedStart, effectiveWindowMs);
    if (tempPath) {
      appendSvg(svg, 'path', {
        class: 'minute-logger-battery-chart__line minute-logger-battery-chart__line--temp',
        d: tempPath,
      });
      drawLatestMarker(
        svg,
        windowPoints,
        'c',
        (value) => projectTempY(value, tempDomain),
        clampedStart,
        effectiveWindowMs,
        'minute-logger-battery-chart__marker--temp'
      );
    }

    if (!windowPoints.length) {
      drawEmptyMessage(svg, 'No retained points in this 12-hour window');
    } else if (!chargeCount && !tempCount) {
      drawEmptyMessage(svg, 'No battery readings in this 12-hour window');
    }

    if (startOutput) {
      startOutput.value = formatDateTime(clampedStart);
      startOutput.textContent = formatDateTime(clampedStart);
    }

    if (endOutput) {
      endOutput.value = formatDateTime(windowEnd);
      endOutput.textContent = formatDateTime(windowEnd);
    }

    if (summary) {
      summary.textContent = `${formatCount(windowPoints.length)} points, ${formatCount(chargeCount)} charge, ${formatCount(tempCount)} temp, ${formatCount(activePackageCount)} packages, ${formatCount(noActiveCount)} no active`;
    }

    if (slider) {
      const offsetMinutes = Math.round((clampedStart - retentionStartMs) / minuteMs);
      slider.value = String(offsetMinutes);
      slider.setAttribute('aria-valuetext', `${formatDateTime(clampedStart)} to ${formatDateTime(windowEnd)}`);
    }
  }

  if (!svg || !slider) {
    return;
  }

  const maxStart = Math.max(retentionStartMs, retentionEndMs - windowMs);
  const maxOffsetMinutes = Math.max(0, Math.floor((maxStart - retentionStartMs) / minuteMs));
  slider.min = '0';
  slider.max = String(maxOffsetMinutes);
  slider.step = '60';
  slider.value = String(maxOffsetMinutes);

  render(retentionStartMs + (Number(slider.value) * minuteMs));

  slider.addEventListener('input', () => {
    render(retentionStartMs + ((Number(slider.value) || 0) * minuteMs));
  });
}());
