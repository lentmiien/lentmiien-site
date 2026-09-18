(function () {
  function initHistory(root, requestJson, renderSessions) {
    const find = (name) => root.querySelector(`[data-codex-history-${name}]`);
    const form = find('filters');
    if (!form) return null;
    const status = find('status');
    const results = find('results');
    let current = { page: 1, status: 'recent', workspaceId: '', search: '' };
    let pagination = { page: 1, total: 0, pages: 0, hasNext: false };
    let serial = 0;
    let busy = false;
    let failed = false;
    let retryTarget = null;

    function controls() {
      find('previous').disabled = busy || current.page <= 1;
      find('latest').disabled = busy || current.page <= 1;
      find('next').disabled = busy || !pagination.hasNext || current.page >= 10000;
      find('refresh').disabled = busy;
      results.setAttribute('aria-busy', String(busy));
    }

    async function load(target = retryTarget || current, automatic = false) {
      const sequence = ++serial;
      busy = true;
      controls();
      if (!automatic) status.textContent = 'Loading session history…';
      try {
        const query = new URLSearchParams({ ...target, limit: '12' });
        const payload = await requestJson(`/codex/api/session-history?${query}`);
        if (sequence !== serial) return;
        current = { ...target };
        pagination = payload.pagination;
        renderSessions(root.querySelector('[data-codex-session-table]'), payload.sessions);
        root.querySelector('[data-codex-session-count]').textContent = String(pagination.total);
        find('page').textContent = `Page ${current.page} of ${Math.max(1, pagination.pages)}`;
        const start = (current.page - 1) * pagination.limit + 1;
        status.textContent = payload.sessions.length
          ? `${start}–${start + payload.sessions.length - 1} of ${pagination.total} sessions`
          : pagination.total ? 'This page is empty. Use Previous or Latest.' : 'No sessions match these filters.';
        find('live').hidden = current.page === 1;
        find('refresh').textContent = 'Refresh';
        failed = false;
        retryTarget = null;
      } catch (error) {
        if (sequence !== serial) return;
        status.textContent = `${error.message || 'Unable to load session history.'} Previous results are unchanged.`;
        find('refresh').textContent = 'Retry';
        failed = true;
        retryTarget = { ...target };
      } finally {
        if (sequence === serial) {
          busy = false;
          controls();
        }
      }
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      load({
        page: 1,
        status: form.elements.status.value,
        workspaceId: form.elements.workspaceId.value,
        search: form.elements.search.value.trim(),
      });
    });
    find('previous').addEventListener('click', () => load({ ...current, page: Math.max(1, current.page - 1) }));
    find('next').addEventListener('click', () => load({ ...current, page: current.page + 1 }));
    find('latest').addEventListener('click', () => load({ ...current, page: 1 }));
    find('refresh').addEventListener('click', () => load());
    load();
    return {
      refresh() {
        const interacting = form.closest('.codex-history')?.contains(root.ownerDocument.activeElement);
        if (!busy && !failed && !interacting && current.page === 1) return load(current, true);
        return Promise.resolve();
      },
    };
  }

  function renderCharts(container, stats = {}) {
    if (!container) return;
    const doc = container.ownerDocument;
    function element(tag, className, text) {
      const node = doc.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    const number = (value) => Math.max(0, Number(value) || 0);
    function chart(title, entries, unit) {
      const figure = element('figure', 'codex-chart');
      figure.appendChild(element('figcaption', '', title));
      const max = Math.max(0, ...entries.map((entry) => entry.value));
      if (!max) {
        figure.appendChild(element('p', 'codex-empty', `No ${unit} recorded in this period.`));
        return figure;
      }
      const list = element('ul', 'codex-chart-bars');
      entries.forEach((entry) => {
        const row = element('li', 'codex-chart-row');
        row.appendChild(element('span', 'codex-chart-label', entry.label));
        row.appendChild(element('strong', 'codex-chart-value', `${entry.value.toLocaleString()} ${unit}`));
        const track = element('span', 'codex-chart-track');
        track.setAttribute('aria-hidden', 'true');
        const fill = element('span', 'codex-chart-fill');
        fill.style.width = `${entry.value / max * 100}%`;
        track.appendChild(fill);
        row.appendChild(track);
        list.appendChild(row);
      });
      figure.appendChild(list);
      return figure;
    }
    const months = (stats.months || []).slice().sort((a, b) => String(a.key).localeCompare(String(b.key)));
    container.replaceChildren(
      chart('Monthly token trend', months.map((month) => ({ label: month.label || month.key, value: number(month.tokens?.total) })), 'tokens'),
      chart('Turn status distribution', (stats.summary?.statusDistribution || []).map((item) => ({ label: item.label, value: number(item.count) })), 'turns'),
    );
  }

  const api = { initHistory, renderCharts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.CodexDashboard = api;
})();
