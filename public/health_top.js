let healthLogEntries = [];
const analyticsState = {
  metric: 'auto',
  windowSize: 7,
  analytics: null,
  chart: null,
};

const getElement = (selector) => document.querySelector(selector);

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }
  return response.json();
};

const fetchHealthLogs = async (startDate, endDate) => {
  try {
    return await fetchJson(`/health/health-entries?start=${startDate}&end=${endDate}`);
  } catch (error) {
    console.error('Failed to fetch health logs:', error);
    return { data: [] };
  }
};

const fetchHealthAnalytics = async (startDate, endDate, metric) => {
  const params = new URLSearchParams({
    start: startDate,
    end: endDate,
    window: analyticsState.windowSize,
  });
  if (metric && metric !== 'auto') {
    params.append('metrics', metric);
  }

  try {
    return await fetchJson(`/health/analytics?${params.toString()}`);
  } catch (error) {
    console.warn('Analytics unavailable:', error.message);
    return { data: null };
  }
};

const formatMeasurement = (entry) => {
  const parts = [];
  if (entry.measurementType) parts.push(entry.measurementType);
  if (entry.measurementContext) parts.push(`(${entry.measurementContext})`);
  return parts.length ? parts.join(' ') : '—';
};

const UpdateHealthLog = (startDate, endDate) => {
  const table = getElement('#health_log');
  table.innerHTML = '';

  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const formattedDate = date.toISOString().split('T')[0];
    const entry = healthLogEntries.find((e) => e.dateOfEntry === formattedDate);
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${entry ? Object.keys(entry.basicData || {}).length : '—'}</td>
      <td>${entry ? Object.keys(entry.medicalRecord || {}).length : '—'}</td>
      <td>${entry ? entry.diary.length : '—'}</td>
      <td>${entry ? formatMeasurement(entry) : '—'}</td>
      <td>${entry && entry.tags && entry.tags.length ? entry.tags.join(', ') : '—'}</td>
      <td>${entry && entry.analyticsSummary && entry.analyticsSummary.alerts && entry.analyticsSummary.alerts.length ? `${entry.analyticsSummary.alerts.length} alert(s)` : 'None'}</td>
      <td>
        ${entry ? `<button class="btn btn-info btn-sm mb-1" onclick="ViewHealthLogEntry('${formattedDate}')">View</button>` : ''}
        <a href="/health/edit/${formattedDate}" class="btn btn-primary btn-sm">Edit</a>
      </td>
    `;
    table.appendChild(row);
  }
};

const populateMetricSelect = () => {
  const select = getElement('#metricSelect');
  const selected = select.value;

  select.querySelectorAll('option:not([value="auto"])').forEach((option) => option.remove());

  if (!analyticsState.analytics || !analyticsState.analytics.metricSummaries) return;
  const metrics = Object.keys(analyticsState.analytics.metricSummaries);
  metrics.forEach((metric) => {
    const option = document.createElement('option');
    option.value = metric;
    option.textContent = metric;
    select.appendChild(option);
  });

  if (selected !== 'auto' && metrics.includes(selected)) {
    select.value = selected;
    analyticsState.metric = selected;
  } else {
    select.value = 'auto';
    analyticsState.metric = 'auto';
  }
};

const renderAlertBanners = () => {
  const container = getElement('#alertBanners');
  container.innerHTML = '';
  if (!analyticsState.analytics) {
    container.innerHTML = '<p class="text-muted mb-0">Analytics not available for this range.</p>';
    return;
  }

  const filter = getElement('#alertFilter').value;
  const alerts = analyticsState.analytics.alertBanners || [];
  const filtered = filter === 'all' ? alerts : alerts.filter((alert) => alert.type === filter);

  if (!filtered.length) {
    container.innerHTML = '<p class="text-muted mb-0">No alerts triggered.</p>';
    return;
  }

  filtered.forEach((alert) => {
    const card = document.createElement('div');
    card.className = 'alert alert-warning';
    card.innerHTML = `
      <strong>${alert.metric}</strong> ${alert.message}<br/>
      Latest: ${alert.latestValue} (threshold ${alert.threshold}) on ${alert.lastTriggeredAt}
    `;
    container.appendChild(card);
  });
};

const renderTrendCards = () => {
  const container = getElement('#trendCards');
  container.innerHTML = '';

  if (!analyticsState.analytics) {
    container.innerHTML = '<div class="col text-muted">No analytics data.</div>';
    return;
  }

  const summaries = Object.values(analyticsState.analytics.metricSummaries || {});
  if (!summaries.length) {
    container.innerHTML = '<div class="col text-muted">No numeric metrics detected.</div>';
    return;
  }

  summaries.forEach((summary) => {
    const card = document.createElement('div');
    card.className = 'col-md-4';
    card.innerHTML = `
      <div class="card h-100">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-center">
            <h5 class="card-title text-capitalize mb-0">${summary.metric}</h5>
            <span class="badge ${summary.trend === 'up' ? 'bg-danger' : summary.trend === 'down' ? 'bg-success' : 'bg-secondary'}">
              ${summary.trend}
            </span>
          </div>
          <p class="mb-1 mt-3">Latest: <strong>${summary.latest}</strong></p>
          <p class="mb-1">Min: ${summary.min.value} (${summary.min.date})</p>
          <p class="mb-0">Max: ${summary.max.value} (${summary.max.date})</p>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
};

const renderChart = () => {
  const ctx = getElement('#metricChart');
  if (!ctx) return;
  const container = ctx.parentElement;
  let placeholder = container.querySelector('.chart-placeholder');
  const noData = !analyticsState.analytics || !Object.keys(analyticsState.analytics.metricSummaries || {}).length;

  if (noData) {
    if (analyticsState.chart) {
      analyticsState.chart.destroy();
      analyticsState.chart = null;
    }
    ctx.style.display = 'none';
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'chart-placeholder text-muted mt-3';
      container.appendChild(placeholder);
    }
    placeholder.textContent = 'No chart data available.';
    return;
  }

  ctx.style.display = 'block';
  if (placeholder) {
    placeholder.remove();
  }

  const metrics = Object.keys(analyticsState.analytics.metricSummaries);
  let metricKey = analyticsState.metric !== 'auto' ? analyticsState.metric : metrics[0];
  if (!analyticsState.analytics.seriesByMetric[metricKey]) {
    metricKey = metrics[0];
  }

  const series = analyticsState.analytics.seriesByMetric[metricKey] || [];
  const rolling = analyticsState.analytics.metricSummaries[metricKey]?.rollingAverage || [];
  const labels = series.map((point) => point.date);
  const values = series.map((point) => point.value);
  const rollingValues = rolling.map((point) => point.value);

  if (analyticsState.chart) {
    analyticsState.chart.data.labels = labels;
    analyticsState.chart.data.datasets[0].data = values;
    analyticsState.chart.data.datasets[1].data = rollingValues;
    analyticsState.chart.data.datasets[0].label = `${metricKey} value`;
    analyticsState.chart.data.datasets[1].label = `${metricKey} rolling avg`;
    analyticsState.chart.update();
  } else {
    analyticsState.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: `${metricKey} value`,
            data: values,
            borderColor: '#0d6efd',
            tension: 0.3,
            fill: false,
          },
          {
            label: `${metricKey} rolling avg`,
            data: rollingValues,
            borderColor: '#6610f2',
            borderDash: [5, 5],
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { display: true },
          y: { display: true },
        },
      },
    });
  }

  getElement('#windowLabel').textContent = `${analyticsState.windowSize}d`;
};

async function UpdateHealthLogDisplay() {
  const startDate = getElement('#start_date').value;
  const endDate = getElement('#end_date').value;
  analyticsState.windowSize = parseInt(getElement('#windowSelect').value, 10) || 7;

  const [entriesPayload, analyticsPayload] = await Promise.all([
    fetchHealthLogs(startDate, endDate),
    fetchHealthAnalytics(startDate, endDate, analyticsState.metric),
  ]);

  healthLogEntries = entriesPayload.data || [];
  analyticsState.analytics = analyticsPayload.data;

  UpdateHealthLog(startDate, endDate);
  populateMetricSelect();
  renderTrendCards();
  renderAlertBanners();
  renderChart();
}

async function ViewHealthLogEntry(date) {
  const entry = healthLogEntries.find((e) => e.dateOfEntry === date);
  if (!entry) return;

  let messageLookup = {};
  let messageLookup4 = {};

  if (entry.diary.length > 0) {
    try {
      const response = await fetch('/chat3/fetch_messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: entry.diary }),
      });
      messageLookup = await response.json();
    } catch (error) {
      console.warn('Failed to load Chat3 messages', error);
    }

    try {
      const response4 = await fetch('/chat4/fetch_messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: entry.diary }),
      });
      messageLookup4 = await response4.json();
    } catch (error) {
      console.warn('Failed to load Chat4 messages', error);
    }
  }

  const detailsContent = getElement('#detailsContent');
  detailsContent.innerHTML = `
    <strong>Basic Data:</strong>
    <pre class="bg-light p-2">${JSON.stringify(entry.basicData, null, 2)}</pre>
    <strong>Medical Record:</strong>
    <pre class="bg-light p-2">${JSON.stringify(entry.medicalRecord, null, 2)}</pre>
    <strong>Diary:</strong>
  `;

  entry.diary.forEach((id) => {
    const message = messageLookup[id] || messageLookup4[id] || '(message not found)';
    detailsContent.innerHTML += `<hr/><strong>${id}</strong><div>${message}</div>`;
  });

  const detailsMetadata = getElement('#detailsMetadata');
  const thresholds = entry.personalizedThresholds || {};
  detailsMetadata.innerHTML = `
    <p><strong>Measurement:</strong> ${formatMeasurement(entry)}</p>
    <p><strong>Tags:</strong> ${entry.tags && entry.tags.length ? entry.tags.join(', ') : '—'}</p>
    <p><strong>Notes:</strong> ${entry.notes || '—'}</p>
    <p><strong>Thresholds:</strong> ${Object.keys(thresholds).length ? JSON.stringify(thresholds) : '—'}</p>
  `;

  const detailsPopup = new bootstrap.Modal(document.getElementById('detailsPopup'));
  detailsPopup.show();
}

function HidePopup() {
  const detailsPopup = bootstrap.Modal.getInstance(document.getElementById('detailsPopup'));
  detailsPopup?.hide();
}

function OpenEditDate() {
  const date = getElement('#edit_date').value;
  if (date) {
    window.location.href = `/health/edit/${date}`;
  }
}

function handleMetricChange() {
  analyticsState.metric = getElement('#metricSelect').value;
  renderChart();
}

function exportAnalyticsCsv() {
  if (!analyticsState.analytics) {
    alert('No analytics data to export.');
    return;
  }

  const rows = [['metric', 'date', 'value', 'type']];
  Object.entries(analyticsState.analytics.seriesByMetric || {}).forEach(([metric, points]) => {
    points.forEach((point) => {
      rows.push([metric, point.date, point.value, 'raw']);
    });
  });

  Object.entries(analyticsState.analytics.metricSummaries || {}).forEach(([metric, summary]) => {
    summary.rollingAverage.forEach((point) => {
      rows.push([metric, point.date, point.value, 'rolling']);
    });
  });

  const csvContent = rows.map((row) => row.join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `health-analytics-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const lastMonth = new Date();
  lastMonth.setDate(today.getDate() - 30);

  getElement('#start_date').value = lastMonth.toISOString().split('T')[0];
  getElement('#end_date').value = today.toISOString().split('T')[0];
  getElement('#edit_date').value = today.toISOString().split('T')[0];

  UpdateHealthLogDisplay();
});
