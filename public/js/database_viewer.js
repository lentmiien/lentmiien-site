(function() {
  const config = window.databaseViewerConfig || {};
  const collectionSelect = document.getElementById('dbViewerCollection');
  const limitInput = document.getElementById('dbViewerLimit');
  const loadButton = document.getElementById('dbViewerLoadBtn');
  const resultsContainer = document.getElementById('dbViewerResults');
  const statusEl = document.getElementById('dbViewerStatus');
  let activeCollection = collectionSelect.value || (typeof config.selectedCollection === 'string' ? config.selectedCollection : '');

  if (!collectionSelect || !limitInput || !loadButton || !resultsContainer) {
    return;
  }

  const defaultLimit = Number.isFinite(config.defaultLimit) ? config.defaultLimit : 25;
  const maxLimit = Number.isFinite(config.maxLimit) ? config.maxLimit : 200;
  const dataEndpoint = typeof config.dataEndpoint === 'string' ? config.dataEndpoint : '/admin/database-viewer/data';
  const deleteEndpoint = typeof config.deleteEndpoint === 'string' ? config.deleteEndpoint : '/admin/database-viewer/delete';

  function clampLimit(raw) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return defaultLimit;
    }
    if (parsed > maxLimit) {
      return maxLimit;
    }
    return parsed;
  }

  function setStatus(message, variant = 'info') {
    if (!statusEl) return;
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      statusEl.className = 'db-viewer__status';
      return;
    }

    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.className = `db-viewer__status db-viewer__status--${variant}`;
  }

  function setLoading(isLoading) {
    loadButton.disabled = isLoading;
    collectionSelect.disabled = isLoading;
    limitInput.disabled = isLoading;
    loadButton.textContent = isLoading ? 'Loading...' : 'Load latest';
  }

  function formatTimestamp(isoString) {
    if (!isoString) return 'No timestamp';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'No timestamp';
    return date.toLocaleString();
  }

  function clearResults() {
    resultsContainer.innerHTML = '';
  }

  function showPlaceholder(message) {
    clearResults();
    const placeholder = document.createElement('div');
    placeholder.className = 'db-viewer__placeholder';
    placeholder.textContent = message;
    resultsContainer.appendChild(placeholder);
  }

  function renderEntries(entries, collectionName) {
    clearResults();

    if (!entries || entries.length === 0) {
      showPlaceholder('No entries found for this collection.');
      return;
    }

    entries.forEach((entry) => {
      const card = document.createElement('article');
      card.className = 'db-viewer__entry';
      card.dataset.collection = collectionName || '';

      const header = document.createElement('header');
      header.className = 'db-viewer__entry-header';

      const meta = document.createElement('div');
      meta.className = 'db-viewer__entry-meta';

      const idEl = document.createElement('div');
      idEl.className = 'db-viewer__entry-id';
      idEl.textContent = entry.id || '(no _id)';
      meta.appendChild(idEl);

      const createdLine = document.createElement('span');
      createdLine.className = 'db-viewer__entry-timestamp';
      createdLine.textContent = entry.createdAt ? `Created: ${formatTimestamp(entry.createdAt)}` : 'Created: (unknown)';
      meta.appendChild(createdLine);

      if (entry.updatedAt) {
        const updatedLine = document.createElement('span');
        updatedLine.className = 'db-viewer__entry-timestamp';
        updatedLine.textContent = `Updated: ${formatTimestamp(entry.updatedAt)}`;
        meta.appendChild(updatedLine);
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'db-viewer__delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => handleDelete(entry, card, deleteBtn));

      header.appendChild(meta);
      header.appendChild(deleteBtn);

      const code = document.createElement('pre');
      code.className = 'db-viewer__code';
      const payload = entry.document || entry;
      code.textContent = JSON.stringify(payload, null, 2);

      card.appendChild(header);
      card.appendChild(code);
      resultsContainer.appendChild(card);
    });
  }

  async function loadEntries() {
    const collection = collectionSelect.value;
    const limit = clampLimit(limitInput.value);
    limitInput.value = limit;

    if (!collection) {
      setStatus('Select a collection to load entries.', 'error');
      return;
    }

    setLoading(true);
    setStatus('Loading entries...', 'info');

    try {
      const params = new URLSearchParams({ collection, limit });
      const response = await fetch(`${dataEndpoint}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || `Request failed with status ${response.status}`);
      }

      renderEntries(payload.entries || [], collection);
      const count = Array.isArray(payload.entries) ? payload.entries.length : 0;
      activeCollection = collection;
      setStatus(`Loaded ${count} entr${count === 1 ? 'y' : 'ies'} from ${collection}.`, 'success');
    } catch (error) {
      setStatus(error.message || 'Unable to load entries.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(entry, card, button) {
    if (!entry || !entry.id) {
      setStatus('Missing document id for deletion.', 'error');
      return;
    }

    const confirmDelete = window.confirm(`Delete entry ${entry.id}? This cannot be undone.`);
    if (!confirmDelete) {
      return;
    }

    button.disabled = true;
    button.textContent = 'Deleting...';
    setStatus('', 'info');

    try {
      const response = await fetch(deleteEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          collection: card?.dataset?.collection || activeCollection || collectionSelect.value,
          id: entry.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || `Delete failed with status ${response.status}`);
      }

      card.remove();
      const deletedCount = Number(payload.deletedCount || 0);
      const message = deletedCount > 0
        ? `Deleted entry ${entry.id}.`
        : `No document was removed for ${entry.id}.`;
      setStatus(message, deletedCount > 0 ? 'success' : 'info');

      if (!resultsContainer.children.length) {
        showPlaceholder('All loaded entries have been removed.');
      }
    } catch (error) {
      setStatus(error.message || 'Unable to delete entry.', 'error');
      button.disabled = false;
      button.textContent = 'Delete';
      return;
    }

    button.textContent = 'Delete';
    button.disabled = false;
  }

  loadButton.addEventListener('click', loadEntries);
  limitInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadEntries();
    }
  });
  collectionSelect.addEventListener('change', () => setStatus(''));

  if (collectionSelect.value) {
    loadEntries();
  }
})();
