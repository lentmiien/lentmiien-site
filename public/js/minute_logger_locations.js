(function () {
  const dataElement = document.getElementById('minuteLoggerLocationsMapData');
  const root = document.querySelector('[data-minute-logger-locations-map]');

  if (!dataElement || !root) {
    return;
  }

  let data = {};

  try {
    data = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    data = {};
  }

  const canvas = root.querySelector('[data-minute-logger-locations-canvas]');
  const bounds = data.bounds || null;
  const labels = (Array.isArray(data.labels) ? data.labels : [])
    .map((label) => ({
      name: String(label.name || 'Named location'),
      latitude: Number(label.latitude),
      longitude: Number(label.longitude),
      pointCount: Math.max(0, Number(label.pointCount) || 0),
    }))
    .filter((label) => Number.isFinite(label.latitude) && Number.isFinite(label.longitude));
  const points = (Array.isArray(data.points) ? data.points : [])
    .map((point) => ({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      receivedAtMs: Number(point.receivedAtMs),
      name: String(point.name || ''),
      deviceId: String(point.deviceId || 'unknown'),
      active: point.active !== false,
    }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  const routeGapMs = 45 * 60 * 1000;
  const padding = 28;
  const hoverRadius = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches ? 24 : 16;
  let activeLabelIndex = null;
  let labelHitAreas = [];
  let lastRender = null;

  if (!canvas || !bounds || (!points.length && !labels.length)) {
    return;
  }

  const stage = canvas.closest('.minute-logger-overview-map__stage') || root;
  const tooltip = document.createElement('div');
  const tooltipTitle = document.createElement('strong');
  const tooltipMeta = document.createElement('span');
  tooltip.className = 'minute-logger-overview-map__tooltip';
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'status');
  tooltip.append(tooltipTitle, tooltipMeta);
  stage.appendChild(tooltip);

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US');
  }

  function formatPointCount(value) {
    const count = Math.round(Number(value) || 0);
    return `${formatNumber(count)} retained ${count === 1 ? 'point' : 'points'}`;
  }

  function withAlpha(color, alpha) {
    const value = String(color || '').trim();

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

  function getPlot(width, height) {
    return {
      x: padding,
      y: padding,
      width: Math.max(1, width - (padding * 2)),
      height: Math.max(1, height - (padding * 2)),
    };
  }

  function project(point, plot) {
    const longitudeSpan = bounds.maxLongitude - bounds.minLongitude;
    const latitudeSpan = bounds.maxLatitude - bounds.minLatitude;
    const xRatio = longitudeSpan === 0
      ? 0.5
      : (point.longitude - bounds.minLongitude) / longitudeSpan;
    const yRatio = latitudeSpan === 0
      ? 0.5
      : (bounds.maxLatitude - point.latitude) / latitudeSpan;

    return {
      x: plot.x + (clamp(xRatio, 0, 1) * plot.width),
      y: plot.y + (clamp(yRatio, 0, 1) * plot.height),
    };
  }

  function drawGrid(ctx, width, height, plot, colors) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;

    for (let index = 0; index <= 6; index += 1) {
      const x = plot.x + ((plot.width / 6) * index);
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
      ctx.stroke();
    }

    for (let index = 0; index <= 4; index += 1) {
      const y = plot.y + ((plot.height / 4) * index);
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
      ctx.stroke();
    }

    ctx.strokeStyle = colors.frame;
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
  }

  function drawRoutes(ctx, plot, colors) {
    const pointsByDevice = new Map();

    points.forEach((point) => {
      if (!Number.isFinite(point.receivedAtMs)) {
        return;
      }

      if (!pointsByDevice.has(point.deviceId)) {
        pointsByDevice.set(point.deviceId, []);
      }

      pointsByDevice.get(point.deviceId).push(point);
    });

    ctx.beginPath();
    pointsByDevice.forEach((devicePoints) => {
      devicePoints.sort((left, right) => left.receivedAtMs - right.receivedAtMs);

      for (let index = 1; index < devicePoints.length; index += 1) {
        const previous = devicePoints[index - 1];
        const current = devicePoints[index];
        const gap = current.receivedAtMs - previous.receivedAtMs;

        if (!Number.isFinite(gap) || gap < 0 || gap > routeGapMs) {
          continue;
        }

        const start = project(previous, plot);
        const end = project(current, plot);
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }
    });
    ctx.strokeStyle = colors.route;
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  function drawPointSet(ctx, plot, source, fill, radius) {
    ctx.beginPath();
    source.forEach((point) => {
      const projected = project(point, plot);
      ctx.moveTo(projected.x + radius, projected.y);
      ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
    });
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawLabels(ctx, plot, colors) {
    labelHitAreas = [];

    labels.forEach((label, index) => {
      const projected = project(label, plot);
      const isActive = index === activeLabelIndex;
      const radius = isActive ? 6.25 : 4.5;
      labelHitAreas.push({
        ...label,
        index,
        x: projected.x,
        y: projected.y,
      });
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colors.labelMarker;
      ctx.fill();
      ctx.lineWidth = isActive ? 2.5 : 2;
      ctx.strokeStyle = isActive ? colors.labelMarkerActive : colors.background;
      ctx.stroke();
    });
  }

  function hideTooltip() {
    tooltip.hidden = true;
    canvas.style.cursor = '';
  }

  function showTooltip(label) {
    if (!label) {
      hideTooltip();
      return;
    }

    tooltipTitle.textContent = label.name;
    tooltipMeta.textContent = formatPointCount(label.pointCount);
    tooltip.hidden = false;

    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const canvasWidth = canvas.clientWidth || lastRender?.width || 1;
    const canvasHeight = canvas.clientHeight || lastRender?.height || 1;
    const maxLeft = Math.max(8, canvasWidth - tooltipWidth - 8);
    const maxTop = Math.max(8, canvasHeight - tooltipHeight - 8);
    const left = clamp(label.x + 12, 8, maxLeft);
    const top = clamp(label.y - tooltipHeight - 12, 8, maxTop);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    canvas.style.cursor = 'pointer';
  }

  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function findNearestLabel(x, y) {
    let nearest = null;
    let nearestDistance = hoverRadius * hoverRadius;

    labelHitAreas.forEach((label) => {
      const deltaX = label.x - x;
      const deltaY = label.y - y;
      const distance = (deltaX * deltaX) + (deltaY * deltaY);

      if (distance <= nearestDistance) {
        nearest = label;
        nearestDistance = distance;
      }
    });

    return nearest;
  }

  function setActiveLabel(label) {
    const nextIndex = label ? label.index : null;

    if (nextIndex !== activeLabelIndex) {
      activeLabelIndex = nextIndex;

      if (lastRender) {
        draw(lastRender.width, lastRender.height);
      }
    }

    if (nextIndex === null) {
      hideTooltip();
      return;
    }

    showTooltip(label);
  }

  function handlePointerMove(event) {
    const point = getCanvasPoint(event);
    setActiveLabel(findNearestLabel(point.x, point.y));
  }

  function draw(width, height) {
    const plot = getPlot(width, height);
    const info = cssVar('--ml-info', '#19E3E3');
    const accent = cssVar('--ml-accent', '#FFC247');
    const colors = {
      background: cssVar('--ml-bg', '#0E0F13'),
      grid: 'rgba(154, 163, 178, 0.14)',
      frame: 'rgba(154, 163, 178, 0.34)',
      route: withAlpha(info, 0.15),
      inactivePoint: 'rgba(154, 163, 178, 0.28)',
      point: withAlpha(info, 0.38),
      namedPoint: withAlpha(accent, 0.58),
      labelMarker: info,
      labelMarkerActive: accent,
    };
    const ctx = canvas.getContext('2d');
    lastRender = { width, height, plot };

    drawGrid(ctx, width, height, plot, colors);
    drawRoutes(ctx, plot, colors);
    drawPointSet(ctx, plot, points.filter((point) => !point.active && !point.name), colors.inactivePoint, 1.15);
    drawPointSet(ctx, plot, points.filter((point) => point.active && !point.name), colors.point, 1.25);
    drawPointSet(ctx, plot, points.filter((point) => point.name), colors.namedPoint, 1.75);
    drawLabels(ctx, plot, colors);
  }

  function resize() {
    activeLabelIndex = null;
    hideTooltip();

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw(width, height);
  }

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);
  } else {
    window.addEventListener('resize', resize);
  }

  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerdown', handlePointerMove);
  canvas.addEventListener('pointerleave', () => setActiveLabel(null));
  canvas.addEventListener('pointercancel', () => setActiveLabel(null));
  canvas.addEventListener('blur', () => setActiveLabel(null));

  resize();
}());
