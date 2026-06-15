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
  const labels = Array.isArray(data.labels) ? data.labels : [];
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

  if (!canvas || !bounds || !points.length) {
    return;
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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

  function drawLabels(ctx, plot, colors, width) {
    ctx.font = '700 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';

    labels.forEach((label, index) => {
      const latitude = Number(label.latitude);
      const longitude = Number(label.longitude);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }

      const projected = project({ latitude, longitude }, plot);
      const text = String(label.name || 'Named location');
      const xOffset = index % 2 === 0 ? 9 : -9;
      const alignLeft = xOffset > 0;
      const measured = ctx.measureText(text).width;
      const textX = alignLeft
        ? clamp(projected.x + xOffset, plot.x + 4, width - measured - 8)
        : clamp(projected.x + xOffset - measured, plot.x + 4, width - measured - 8);
      const textY = clamp(projected.y - 11, plot.y + 10, plot.y + plot.height - 10);

      ctx.beginPath();
      ctx.arc(projected.x, projected.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = colors.labelMarker;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.background;
      ctx.stroke();

      ctx.lineWidth = 4;
      ctx.strokeStyle = colors.textStroke;
      ctx.strokeText(text, textX, textY);
      ctx.fillStyle = colors.text;
      ctx.fillText(text, textX, textY);
    });
  }

  function draw(width, height) {
    const plot = getPlot(width, height);
    const info = cssVar('--ml-info', '#19E3E3');
    const accent = cssVar('--ml-accent', '#FFC247');
    const text = cssVar('--ml-text', '#E8ECF2');
    const colors = {
      background: cssVar('--ml-bg', '#0E0F13'),
      grid: 'rgba(154, 163, 178, 0.14)',
      frame: 'rgba(154, 163, 178, 0.34)',
      route: withAlpha(info, 0.15),
      inactivePoint: 'rgba(154, 163, 178, 0.28)',
      point: withAlpha(info, 0.38),
      namedPoint: withAlpha(accent, 0.58),
      labelMarker: info,
      text,
      textStroke: 'rgba(14, 15, 19, 0.86)',
    };
    const ctx = canvas.getContext('2d');

    drawGrid(ctx, width, height, plot, colors);
    drawRoutes(ctx, plot, colors);
    drawPointSet(ctx, plot, points.filter((point) => !point.active && !point.name), colors.inactivePoint, 1.15);
    drawPointSet(ctx, plot, points.filter((point) => point.active && !point.name), colors.point, 1.25);
    drawPointSet(ctx, plot, points.filter((point) => point.name), colors.namedPoint, 1.75);
    drawLabels(ctx, plot, colors, width);
  }

  function resize() {
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

  resize();
}());
