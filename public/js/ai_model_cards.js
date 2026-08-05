(function exposeAIModelCards(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AIModelCardsPage = api;
    if (root.document) {
      root.document.addEventListener('DOMContentLoaded', () => api.initialize(root.document, root));
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createAIModelCardsPage() {
  const FILTERS = [
    { key: 'search', id: 'ai-model-filter-search', parameter: 'filter_q', event: 'input' },
    { key: 'provider', id: 'ai-model-filter-provider', parameter: 'filter_provider', event: 'change' },
    { key: 'type', id: 'ai-model-filter-type', parameter: 'filter_type', event: 'change' },
    { key: 'input', id: 'ai-model-filter-input', parameter: 'filter_input', event: 'change' },
    { key: 'output', id: 'ai-model-filter-output', parameter: 'filter_output', event: 'change' },
    { key: 'status', id: 'ai-model-filter-status', parameter: 'filter_status', event: 'change' },
    { key: 'batch', id: 'ai-model-filter-batch', parameter: 'filter_batch', event: 'change' },
    { key: 'context', id: 'ai-model-filter-context', parameter: 'filter_context', event: 'change' },
  ];

  function normalize(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  function normalizeList(value) {
    const list = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
    return list.map(normalize).filter(Boolean);
  }

  function normalizeFilters(filters = {}) {
    return FILTERS.reduce((result, filter) => {
      result[filter.key] = normalize(filters[filter.key]);
      return result;
    }, {});
  }

  function matchesModelFilters(model = {}, rawFilters = {}) {
    const filters = normalizeFilters(rawFilters);
    const searchText = normalize(model.search);
    const searchTerms = filters.search.split(/\s+/).filter(Boolean);
    if (searchTerms.some((term) => !searchText.includes(term))) return false;
    if (filters.provider && normalize(model.provider) !== filters.provider) return false;
    if (filters.type && normalize(model.type) !== filters.type) return false;
    if (filters.input && !normalizeList(model.input).includes(filters.input)) return false;
    if (filters.output && !normalizeList(model.output).includes(filters.output)) return false;
    if (filters.status && normalize(model.status) !== filters.status) return false;
    if (filters.batch && normalize(model.batch) !== filters.batch) return false;
    if (filters.context && normalize(model.context) !== filters.context) return false;
    return true;
  }

  function readFilters(doc) {
    return FILTERS.reduce((result, filter) => {
      const control = doc.getElementById(filter.id);
      result[filter.key] = control ? control.value : '';
      return result;
    }, {});
  }

  function readRow(row) {
    return {
      search: row.dataset.modelSearch,
      provider: row.dataset.modelProvider,
      type: row.dataset.modelType,
      input: row.dataset.modelInput,
      output: row.dataset.modelOutput,
      status: row.dataset.modelStatus,
      batch: row.dataset.modelBatch,
      context: row.dataset.modelContext,
    };
  }

  function getCurrentUrl(root) {
    if (!root || !root.location || !root.location.href) return null;
    try {
      return new URL(root.location.href);
    } catch (error) {
      return null;
    }
  }

  function relativeUrl(url) {
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function updateFilterUrl(filters, root) {
    const url = getCurrentUrl(root);
    if (!url || !root.history || typeof root.history.replaceState !== 'function') return;
    FILTERS.forEach((filter) => {
      const value = typeof filters[filter.key] === 'string' ? filters[filter.key].trim() : '';
      if (value) {
        url.searchParams.set(filter.parameter, value);
      } else {
        url.searchParams.delete(filter.parameter);
      }
    });
    root.history.replaceState(null, '', relativeUrl(url));
  }

  function buildNavigationUrl(root, { editId = '', clearEdit = false, hash = '' } = {}) {
    const current = getCurrentUrl(root);
    const url = current || new URL('http://localhost/chat5/ai_model_cards');
    url.pathname = '/chat5/ai_model_cards';
    url.hash = hash;
    url.searchParams.delete('error');
    url.searchParams.delete('saved');
    if (clearEdit || editId) url.searchParams.delete('edit');
    if (editId) url.searchParams.set('edit', editId);
    return relativeUrl(url);
  }

  function syncNavigationTargets(doc, root) {
    doc.querySelectorAll('.ai-model-return-target').forEach((input) => {
      input.value = buildNavigationUrl(root, { clearEdit: input.dataset.clearEdit === 'true' });
    });
    doc.querySelectorAll('[data-model-edit-link]').forEach((link) => {
      link.href = buildNavigationUrl(root, {
        editId: link.dataset.modelEditId,
        hash: '#model-card-form',
      });
    });
    doc.querySelectorAll('[data-model-edit-cancel]').forEach((link) => {
      link.href = buildNavigationUrl(root, { clearEdit: true });
    });
  }

  function applyFilters(doc, root, { updateUrl = true } = {}) {
    const filters = readFilters(doc);
    const rows = Array.from(doc.querySelectorAll('[data-ai-model-row]'));
    let visibleCount = 0;
    rows.forEach((row) => {
      const visible = matchesModelFilters(readRow(row), filters);
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const count = doc.getElementById('ai-model-result-count');
    if (count) {
      count.textContent = `${visibleCount} of ${rows.length} ${rows.length === 1 ? 'model' : 'models'}`;
    }
    const emptyState = doc.getElementById('ai-model-no-results');
    if (emptyState) emptyState.hidden = visibleCount !== 0;

    if (updateUrl) updateFilterUrl(filters, root);
    syncNavigationTargets(doc, root);
    return visibleCount;
  }

  function restoreFiltersFromUrl(doc, root) {
    const url = getCurrentUrl(root);
    if (!url) return;
    FILTERS.forEach((filter) => {
      const control = doc.getElementById(filter.id);
      const value = url.searchParams.get(filter.parameter);
      if (control && value !== null) control.value = value;
    });
  }

  function resetFilters(doc) {
    FILTERS.forEach((filter) => {
      const control = doc.getElementById(filter.id);
      if (control) control.value = '';
    });
  }

  function initialize(doc, root) {
    if (!doc) return;
    restoreFiltersFromUrl(doc, root);
    const runFilter = () => applyFilters(doc, root);

    FILTERS.forEach((filter) => {
      const control = doc.getElementById(filter.id);
      if (!control || control.dataset.aiModelFilterBound === 'true') return;
      control.dataset.aiModelFilterBound = 'true';
      control.addEventListener(filter.event, runFilter);
    });

    const localButton = doc.getElementById('ai-model-filter-local');
    if (localButton && localButton.dataset.aiModelFilterBound !== 'true') {
      localButton.dataset.aiModelFilterBound = 'true';
      localButton.addEventListener('click', () => {
        const provider = doc.getElementById('ai-model-filter-provider');
        if (provider) provider.value = 'Local';
        runFilter();
      });
    }

    const resetButton = doc.getElementById('ai-model-filter-reset');
    if (resetButton && resetButton.dataset.aiModelFilterBound !== 'true') {
      resetButton.dataset.aiModelFilterBound = 'true';
      resetButton.addEventListener('click', () => {
        resetFilters(doc);
        runFilter();
      });
    }

    applyFilters(doc, root);
  }

  return {
    applyFilters,
    buildNavigationUrl,
    initialize,
    matchesModelFilters,
    normalizeFilters,
  };
}));
