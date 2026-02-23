(() => {
  const config = window.COOKING_RECOMMENDATIONS || {};
  const state = {
    stats: Array.isArray(config.stats) ? config.stats : [],
  };

  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  let listEl;
  let countEl;
  let hiddenEl;
  let randomizeBtn;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    listEl = document.getElementById('recommendationList');
    countEl = document.getElementById('recommendationCount');
    hiddenEl = document.getElementById('hiddenCount');
    randomizeBtn = document.getElementById('randomizeRecommendations');

    if (randomizeBtn) {
      randomizeBtn.addEventListener('click', renderRecommendations);
    }

    renderRecommendations();
  }

  function renderRecommendations() {
    if (!listEl) {
      return;
    }

    const today = startOfDay(new Date());
    const entries = state.stats.map(item => buildEntry(item, today));
    const recent = entries.filter(entry => entry.isRecent);
    const eligible = entries.filter(entry => !entry.isRecent);
    const randomized = weightedShuffle(eligible);

    if (countEl) {
      countEl.textContent = `${randomized.length} shown`;
    }
    if (hiddenEl) {
      hiddenEl.textContent = `${recent.length} hidden (last 10 days)`;
    }

    if (!randomized.length) {
      listEl.innerHTML = '<div class="recommendation-empty text-muted">No recommendations available right now. Everything was cooked in the last 10 days.</div>';
      return;
    }

    listEl.innerHTML = randomized.map(renderCard).join('');
  }

  function buildEntry(item, today) {
    const usage = item.usage || {};
    const lastCookedDate = usage.lastCookedDate || null;
    const totalCount = usage.totalCount || 0;
    let daysSince = null;

    if (lastCookedDate) {
      daysSince = daysBetween(lastCookedDate, today);
    }

    const isRecent = Boolean(usage.existInLast10Days)
      || (Number.isFinite(daysSince) && daysSince >= 0 && daysSince < 10);
    const stale = !lastCookedDate || (Number.isFinite(daysSince) && daysSince >= 30);
    const totalScore = Math.min(totalCount, 25) / 25;
    const weight = 1 + (stale ? 1 : 0) + totalScore * 0.35;

    return {
      recipeId: item.recipeId,
      title: item.title,
      usage,
      lastCookedDate,
      daysSince,
      totalScore,
      isRecent,
      stale,
      weight,
    };
  }

  function renderCard(entry) {
    const usage = entry.usage || {};
    const lastCookedLabel = entry.lastCookedDate || 'Not recorded';
    const daysLabel = Number.isFinite(entry.daysSince)
      ? `${entry.daysSince} day${entry.daysSince === 1 ? '' : 's'} ago`
      : 'Never cooked';
    const statsLine = `90d: ${usage.countLast90Days || 0} | Prev 90d: ${usage.countPrev90Days || 0} | Total: ${usage.totalCount || 0}`;

    const badges = [];
    if (!entry.lastCookedDate) {
      badges.push('<span class="badge bg-info text-dark">Never cooked</span>');
    } else if (entry.stale) {
      badges.push('<span class="badge bg-warning text-dark">Stale</span>');
    }
    if ((usage.totalCount || 0) >= 25) {
      badges.push('<span class="badge bg-success">Popular</span>');
    } else if ((usage.totalCount || 0) >= 10) {
      badges.push('<span class="badge bg-secondary">Tried and true</span>');
    }

    const badgeMarkup = badges.length ? `<div class="recommendation-badges">${badges.join('')}</div>` : '';
    const lastCookedText = entry.lastCookedDate
      ? `${lastCookedLabel} (${daysLabel})`
      : lastCookedLabel;

    return `
      <div class="recommendation-card">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div>
            <h5 class="mb-1"><a href="/chat4/viewknowledge/${entry.recipeId}">${escapeHtml(entry.title)}</a></h5>
            <div class="recommendation-meta">Last cooked: ${escapeHtml(lastCookedText)}</div>
            <div class="recommendation-meta">${escapeHtml(statsLine)}</div>
          </div>
          ${badgeMarkup}
        </div>
      </div>
    `;
  }

  function weightedShuffle(items) {
    // Weighted random order using exponential draws.
    return items
      .map(item => ({
        item,
        sortKey: -Math.log(Math.random()) / item.weight,
      }))
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(entry => entry.item);
  }

  function daysBetween(fromDateStr, toDate) {
    const from = parseDate(fromDateStr);
    return Math.floor((toDate.getTime() - from.getTime()) / MS_PER_DAY);
  }

  function parseDate(value) {
    return new Date(`${value}T00:00:00Z`);
  }

  function startOfDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
