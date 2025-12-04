// public/js/image_gen_bulk_analytics.js
(function () {
  const root = document.getElementById('analyticsRoot');
  if (!root) return;
  const jobId = root.dataset.jobId;
  if (!jobId) return;

  const summaryEl = document.getElementById('analyticsSummary');
  const emptyEl = document.getElementById('analyticsEmpty');
  const metricTotal = document.getElementById('metricTotal');
  const metricTotalSub = document.getElementById('metricTotalSub');
  const metricRated = document.getElementById('metricRated');
  const metricRatedSub = document.getElementById('metricRatedSub');
  const metricAvgScore = document.getElementById('metricAvgScore');
  const metricAvgScoreSub = document.getElementById('metricAvgScoreSub');
  const metricAvgDefect = document.getElementById('metricAvgDefect');
  const metricAvgDefectSub = document.getElementById('metricAvgDefectSub');
  const metricAlignment = document.getElementById('metricAlignment');
  const metricAlignmentSub = document.getElementById('metricAlignmentSub');
  const defectBucketList = document.getElementById('defectBucketList');
  const templateTable = document.getElementById('templateTable');
  const negativeTable = document.getElementById('negativeTable');
  const placeholderTable = document.getElementById('placeholderTable');
  const inputTable = document.getElementById('inputTable');
  const alignmentTable = document.getElementById('alignmentTable');
  const highlightBest = document.getElementById('highlightBest');
  const highlightRisk = document.getElementById('highlightRisk');
  const topImagesGrid = document.getElementById('topImagesGrid');
  const lowDefectGrid = document.getElementById('lowDefectImagesGrid');

  function formatNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '-';
    return num.toLocaleString();
  }

  function formatScore(value, digits = 2) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '–';
    return value.toFixed(digits);
  }

  function formatDelta(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '–';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}`;
  }

  function formatDefect(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '–';
    return value.toFixed(1);
  }

  function clearChildren(node) {
    if (!node) return;
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function setSummary(text) {
    if (summaryEl) summaryEl.textContent = text;
  }

  function setEmptyState(visible) {
    if (!emptyEl) return;
    emptyEl.style.display = visible ? '' : 'none';
  }

  function renderOverview(data) {
    const job = data.job || {};
    const overall = data.overall || {};
    if (summaryEl) {
      summaryEl.textContent = job.name
        ? `Insights for “${job.name}”`
        : 'Bulk job analytics';
    }
    if (metricTotal) {
      metricTotal.textContent = formatNumber(overall.total_prompts || 0);
      const completed = job.counters?.completed || 0;
      metricTotalSub.textContent = `${formatNumber(completed)} completed prompts`;
    }
    if (metricRated) {
      const rated = overall.scored_prompts || 0;
      metricRated.textContent = formatNumber(rated);
      const total = overall.total_prompts || 0;
      const pct = total > 0 ? ((rated / total) * 100).toFixed(1) : '0.0';
      metricRatedSub.textContent = total
        ? `${pct}% of completed prompts`
        : 'No rated prompts yet';
    }
    if (metricAvgScore) {
      metricAvgScore.textContent = formatScore(overall.avg_score ?? null);
      const voteCount = overall.score_votes || 0;
      metricAvgScoreSub.textContent = voteCount
        ? `${formatNumber(voteCount)} pairwise votes`
        : 'No like ratings yet';
    }
    if (metricAvgDefect) {
      metricAvgDefect.textContent = formatDefect(overall.avg_defect ?? null);
      metricAvgDefectSub.textContent = overall.defect_rated
        ? `${formatNumber(overall.defect_rated)} images reviewed`
        : 'No defect ratings yet';
    }
    if (metricAlignment) {
      metricAlignment.textContent = formatNumber(overall.alignment_entries || 0);
      metricAlignmentSub.textContent = overall.alignment_prompts
        ? `${formatNumber(overall.alignment_prompts)} prompts with breakdown ratings`
        : 'No alignment ratings yet';
    }
  }

  function renderDefectBuckets(buckets) {
    if (!defectBucketList) return;
    clearChildren(defectBucketList);
    if (!Array.isArray(buckets) || !buckets.length) {
      const li = document.createElement('li');
      li.className = 'bar-item text-soft';
      li.textContent = 'No defect ratings yet.';
      defectBucketList.appendChild(li);
      return;
    }
    const max = buckets.reduce((acc, entry) => Math.max(acc, entry.count || 0), 0) || 1;
    buckets.forEach((bucket) => {
      const li = document.createElement('li');
      li.className = 'bar-item';
      const label = document.createElement('div');
      label.className = 'bar-label';
      label.textContent = bucket.label || 'Unlabeled';
      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      const width = Math.max(4, Math.round((bucket.count || 0) / max * 100));
      fill.style.width = `${width}%`;
      track.appendChild(fill);
      const value = document.createElement('div');
      value.className = 'bar-value';
      value.textContent = formatNumber(bucket.count || 0);
      li.appendChild(label);
      li.appendChild(track);
      li.appendChild(value);
      defectBucketList.appendChild(li);
    });
  }

  function buildPerfRows(rows, limit, sortByDelta = false) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const clone = rows.slice();
    if (sortByDelta) {
      clone.sort((a, b) => {
        const aDelta = typeof a.score_delta === 'number' ? a.score_delta : -Infinity;
        const bDelta = typeof b.score_delta === 'number' ? b.score_delta : -Infinity;
        return bDelta - aDelta;
      });
    } else {
      clone.sort((a, b) => (b.prompts || 0) - (a.prompts || 0));
    }
    return clone.slice(0, limit);
  }

  function renderPerfTable(tbody, rows) {
    if (!tbody) return;
    clearChildren(tbody);
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'text-soft';
      td.textContent = 'Not enough data yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const label = document.createElement('td');
      label.textContent = row.label || row.key || '-';
      const score = document.createElement('td');
      score.textContent = formatScore(row.score_avg);
      const defect = document.createElement('td');
      defect.textContent = formatDefect(row.defect_avg);
      const samples = document.createElement('td');
      samples.textContent = formatNumber(row.prompts || 0);
      tr.appendChild(label);
      tr.appendChild(score);
      tr.appendChild(defect);
      tr.appendChild(samples);
      tbody.appendChild(tr);
    });
  }

  function renderDeltaTable(tbody, rows) {
    if (!tbody) return;
    clearChildren(tbody);
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'text-soft';
      td.textContent = 'No correlations yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const label = document.createElement('td');
      label.textContent = row.label || `${row.key}: ${row.value}`;
      const delta = document.createElement('td');
      delta.textContent = formatDelta(row.score_delta);
      const defect = document.createElement('td');
      defect.textContent = formatDefect(row.defect_avg);
      const samples = document.createElement('td');
      samples.textContent = formatNumber(row.prompts || 0);
      tr.appendChild(label);
      tr.appendChild(delta);
      tr.appendChild(defect);
      tr.appendChild(samples);
      tbody.appendChild(tr);
    });
  }

  function renderAlignmentRows(tbody, rows) {
    if (!tbody) return;
    clearChildren(tbody);
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'text-soft';
      td.textContent = 'No alignment ratings yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const label = document.createElement('td');
      label.textContent = row.label || row.key || '-';
      const rating = document.createElement('td');
      rating.textContent = formatScore(row.rating_avg ?? null, 2);
      const score = document.createElement('td');
      score.textContent = formatScore(row.score_avg);
      const defect = document.createElement('td');
      defect.textContent = formatDefect(row.defect_avg);
      const samples = document.createElement('td');
      samples.textContent = formatNumber(row.prompts || 0);
      tr.appendChild(label);
      tr.appendChild(rating);
      tr.appendChild(score);
      tr.appendChild(defect);
      tr.appendChild(samples);
      tbody.appendChild(tr);
    });
  }

  function renderHighlights(listEl, rows, emptyText) {
    if (!listEl) return;
    clearChildren(listEl);
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'highlight-item text-soft';
      li.textContent = emptyText;
      listEl.appendChild(li);
      return;
    }
    rows.forEach((row) => {
      const li = document.createElement('li');
      li.className = 'highlight-item';
      const label = document.createElement('span');
      label.textContent = row.label || row.key || '-';
      const detail = document.createElement('span');
      const delta = formatDelta(row.score_delta);
      const defect = formatDefect(row.defect_avg);
      detail.textContent = `${delta} score | defect ${defect}`;
      li.appendChild(label);
      li.appendChild(detail);
      listEl.appendChild(li);
    });
  }

  function createMediaElement(item) {
    const url = item.cached_url || item.download_url;
    if (!url) {
      const placeholder = document.createElement('div');
      placeholder.className = 'text-soft';
      placeholder.style.padding = '2rem';
      placeholder.textContent = 'No preview';
      return placeholder;
    }
    if (item.media_type === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.muted = true;
      video.src = url;
      return video;
    }
    const img = document.createElement('img');
    img.src = url;
    img.alt = item.filename || 'Image preview';
    img.loading = 'lazy';
    return img;
  }

  function renderImageGrid(container, items) {
    if (!container) return;
    clearChildren(container);
    if (!items.length) {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'No images meet this criteria yet.';
      container.appendChild(note);
      return;
    }
    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'image-card';
      const figure = document.createElement('figure');
      figure.appendChild(createMediaElement(item));
      card.appendChild(figure);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('div');
      title.textContent = item.template_label || 'Template';
      meta.appendChild(title);
      const score = document.createElement('div');
      score.textContent = `Score ${formatScore(item.score_average)} (${item.score_count || 0})`;
      meta.appendChild(score);
      const defect = document.createElement('div');
      defect.textContent = `Defect ${formatDefect(item.defect_rating)}`;
      meta.appendChild(defect);
      if (item.placeholder_values && Object.keys(item.placeholder_values).length) {
        const placeholders = document.createElement('div');
        placeholders.textContent = Object.entries(item.placeholder_values)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        meta.appendChild(placeholders);
      }
      card.appendChild(meta);
      container.appendChild(card);
    });
  }

  function api(path) {
    return fetch(`/image_gen${path}`).then((resp) => {
      if (!resp.ok) {
        return resp.text().then((text) => {
          throw new Error(text || resp.statusText);
        });
      }
      return resp.json();
    });
  }

  async function loadAnalytics() {
    setSummary('Loading analytics…');
    setEmptyState(false);
    try {
      const data = await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/analytics`);
      renderOverview(data);
      renderDefectBuckets(data.defectBuckets || []);
      renderPerfTable(templateTable, buildPerfRows(data.performance?.templates || [], 12));
      renderPerfTable(negativeTable, buildPerfRows(data.performance?.negative || [], 4));
      renderDeltaTable(placeholderTable, buildPerfRows(data.performance?.placeholders || [], 10, true));
      renderDeltaTable(inputTable, buildPerfRows(data.performance?.inputs || [], 8, true));
      const alignRows = (data.alignment || [])
        .slice()
        .sort((a, b) => (b.prompts || 0) - (a.prompts || 0));
      renderAlignmentRows(alignmentTable, alignRows.slice(0, 10));
      renderHighlights(highlightBest, data.highlights?.best || [], 'No stand-out positives yet.');
      renderHighlights(highlightRisk, data.highlights?.needs_attention || [], 'Nothing concerning yet.');
      renderImageGrid(topImagesGrid, data.topImages || []);
      renderImageGrid(lowDefectGrid, data.lowDefectImages || []);
      const hasData = (data.overall?.total_prompts || 0) > 0;
      setEmptyState(!hasData);
      setSummary(`Insights for “${data.job?.name || 'bulk job'}”`);
    } catch (err) {
      setSummary('Failed to load analytics');
      setEmptyState(true);
      if (defectBucketList) {
        clearChildren(defectBucketList);
        const li = document.createElement('li');
        li.className = 'bar-item text-danger';
        li.textContent = err.message || 'Failed to load analytics.';
        defectBucketList.appendChild(li);
      }
    }
  }

  loadAnalytics();
})();
