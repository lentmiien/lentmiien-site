(function () {
  const dataElement = document.getElementById('minuteLoggerDailyTimelineData');
  const root = document.querySelector('[data-minute-logger-timeline]');

  if (!dataElement || !root) {
    return;
  }

  let data = null;

  try {
    data = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    data = {};
  }

  const slider = root.querySelector('#minuteLoggerTimelineSlider');
  const timeOutput = root.querySelector('#minuteLoggerTimelineTime');
  const summary = root.querySelector('[data-minute-logger-timeline-summary]');
  const labelsGroup = root.querySelector('[data-minute-logger-timeline-labels]');
  const pointsGroup = root.querySelector('[data-minute-logger-timeline-points]');
  const path = root.querySelector('[data-minute-logger-timeline-path]');
  const current = root.querySelector('[data-minute-logger-timeline-current]');
  const bounds = data.bounds || null;
  const points = Array.isArray(data.points) ? data.points : [];
  const labels = Array.isArray(data.labels) ? data.labels : [];
  const svgWidth = 900;
  const svgHeight = 520;
  const padding = 26;
  const rect = {
    x: padding,
    y: padding,
    width: svgWidth - (padding * 2),
    height: svgHeight - (padding * 2),
  };

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
      node.setAttribute(key, String(value));
    });
  }

  function formatMinute(minute) {
    const safeMinute = Math.max(0, Math.min(1439, Number(minute) || 0));
    const hour = Math.floor(safeMinute / 60);
    const minutePart = safeMinute % 60;

    return `${String(hour).padStart(2, '0')}:${String(minutePart).padStart(2, '0')}`;
  }

  function project(point) {
    const latitude = Number(point.latitude);
    const longitude = Number(point.longitude);

    if (!bounds || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    const longitudeSpan = bounds.maxLongitude - bounds.minLongitude;
    const latitudeSpan = bounds.maxLatitude - bounds.minLatitude;
    const xRatio = longitudeSpan === 0 ? 0.5 : (longitude - bounds.minLongitude) / longitudeSpan;
    const yRatio = latitudeSpan === 0 ? 0.5 : (bounds.maxLatitude - latitude) / latitudeSpan;
    const x = rect.x + (Math.max(0, Math.min(1, xRatio)) * rect.width);
    const y = rect.y + (Math.max(0, Math.min(1, yRatio)) * rect.height);

    return {
      x,
      y,
    };
  }

  function renderLabels() {
    clearNode(labelsGroup);

    if (!labelsGroup || !bounds) {
      return;
    }

    labels.forEach((label) => {
      const projected = project(label);

      if (!projected) {
        return;
      }

      const group = createSvgElement('g');
      group.setAttribute('class', 'minute-logger-timeline__label');

      const marker = createSvgElement('circle');
      setAttributes(marker, {
        cx: projected.x.toFixed(2),
        cy: projected.y.toFixed(2),
        r: 4,
      });

      const text = createSvgElement('text');
      setAttributes(text, {
        x: (projected.x + 8).toFixed(2),
        y: (projected.y - 8).toFixed(2),
      });
      text.textContent = label.name || 'Named location';

      group.appendChild(marker);
      group.appendChild(text);
      labelsGroup.appendChild(group);
    });
  }

  function render(selectedMinute) {
    clearNode(pointsGroup);

    const minute = Math.max(0, Math.min(1439, Number(selectedMinute) || 0));
    const trailStart = Math.max(0, minute - 60);
    const trail = points
      .filter((point) => {
        const pointMinute = Number(point.minuteOfDay) || 0;
        return pointMinute >= trailStart && pointMinute <= minute;
      })
      .map((point) => ({
        ...point,
        projected: project(point),
      }))
      .filter((point) => point.projected);

    if (timeOutput) {
      timeOutput.value = formatMinute(minute);
      timeOutput.textContent = formatMinute(minute);
    }

    if (slider && Number(slider.value) !== minute) {
      slider.value = String(minute);
    }

    if (!bounds || !trail.length) {
      if (path) {
        path.setAttribute('d', '');
      }

      if (current) {
        current.setAttribute('r', '0');
      }

      if (summary) {
        summary.textContent = 'No trail points';
      }
      return;
    }

    if (path) {
      const pathData = trail.map((point, index) => {
        const command = index === 0 ? 'M' : 'L';
        return `${command}${point.projected.x.toFixed(2)} ${point.projected.y.toFixed(2)}`;
      }).join(' ');
      path.setAttribute('d', pathData);
    }

    trail.forEach((point) => {
      const age = minute - (Number(point.minuteOfDay) || 0);
      const freshness = Math.max(0, Math.min(1, 1 - (age / 60)));
      const opacity = 0.18 + (freshness * 0.72);
      const radius = 2.6 + (freshness * 2.4);
      const circle = createSvgElement('circle');
      setAttributes(circle, {
        class: 'minute-logger-timeline__point',
        cx: point.projected.x.toFixed(2),
        cy: point.projected.y.toFixed(2),
        r: radius.toFixed(2),
        opacity: opacity.toFixed(2),
      });

      const title = createSvgElement('title');
      const name = point.name ? `${point.name} - ` : '';
      title.textContent = `${name}${point.package || 'unknown'} - ${point.deviceId || 'unknown'} - ${point.receivedAt || ''}`;
      circle.appendChild(title);
      pointsGroup.appendChild(circle);
    });

    const latest = trail[trail.length - 1];
    if (current && latest) {
      setAttributes(current, {
        cx: latest.projected.x.toFixed(2),
        cy: latest.projected.y.toFixed(2),
        r: 7,
      });
    }

    if (summary) {
      const namedCount = trail.filter((point) => point.name).length;
      summary.textContent = `${trail.length.toLocaleString('en-US')} points, ${namedCount.toLocaleString('en-US')} named`;
    }
  }

  if (!slider || !timeOutput || !summary) {
    return;
  }

  const defaultMinute = Number.isFinite(Number(data.defaultMinute))
    ? Number(data.defaultMinute)
    : (points.length ? Number(points[points.length - 1].minuteOfDay) || 720 : 720);

  slider.value = String(Math.max(0, Math.min(1439, defaultMinute)));
  renderLabels();
  render(Number(slider.value));

  slider.addEventListener('input', () => {
    render(Number(slider.value));
  });
}());
