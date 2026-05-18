(function () {
  const grid = document.querySelector('[data-mypage-icon-grid]');
  if (!grid) return;

  const customizeButton = document.getElementById('mypage-icons-customize');
  const saveButton = document.getElementById('mypage-icons-save');
  const cancelButton = document.getElementById('mypage-icons-cancel');
  const resetButton = document.getElementById('mypage-icons-reset');
  const status = document.getElementById('mypage-icons-status');
  let editing = false;
  let dragItem = null;
  let savedState = readState();

  function getItems() {
    return Array.from(grid.querySelectorAll('.mypage-tile-shell'));
  }

  function setStatus(message) {
    if (status) {
      status.textContent = message || '';
    }
  }

  function readState() {
    return getItems().map((item) => ({
      id: item.dataset.tileId,
      hidden: item.classList.contains('is-hidden'),
    })).filter((item) => item.id);
  }

  function applyState(state) {
    const itemById = new Map(getItems().map((item) => [item.dataset.tileId, item]));
    state.forEach((entry) => {
      const item = itemById.get(entry.id);
      if (!item) return;
      item.classList.toggle('is-hidden', Boolean(entry.hidden));
      updateToggleButton(item);
      grid.appendChild(item);
      itemById.delete(entry.id);
    });
    itemById.forEach((item) => {
      grid.appendChild(item);
    });
  }

  function updateToggleButton(item) {
    const button = item.querySelector('.mypage-tile-hide');
    if (!button) return;
    const hidden = item.classList.contains('is-hidden');
    button.textContent = hidden ? 'Show' : 'Hide';
    button.setAttribute('aria-pressed', hidden ? 'true' : 'false');
  }

  function setEditing(nextEditing) {
    editing = nextEditing;
    grid.classList.toggle('is-editing', editing);
    getItems().forEach((item) => {
      item.draggable = editing;
      updateToggleButton(item);
    });
    if (customizeButton) customizeButton.hidden = editing;
    if (saveButton) saveButton.hidden = !editing;
    if (cancelButton) cancelButton.hidden = !editing;
    if (resetButton) resetButton.hidden = !editing;
    setStatus(editing ? 'Editing icons.' : '');
  }

  async function saveState(payload) {
    setStatus('Saving...');
    const response = await fetch('/mypage/icon-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Unable to save icon settings.');
    }
    return data;
  }

  async function saveCurrentState() {
    const state = readState();
    await saveState({
      order: state.map((item) => item.id),
      hidden: state.filter((item) => item.hidden).map((item) => item.id),
    });
    savedState = readState();
    setEditing(false);
    setStatus('Saved.');
  }

  async function resetSettings() {
    await saveState({ reset: true });
    getItems().forEach((item) => {
      item.classList.remove('is-hidden');
      updateToggleButton(item);
    });
    savedState = readState();
    setEditing(false);
    window.location.reload();
  }

  function moveItem(item, direction) {
    if (!item) return;
    if (direction < 0 && item.previousElementSibling) {
      grid.insertBefore(item, item.previousElementSibling);
    } else if (direction > 0 && item.nextElementSibling) {
      grid.insertBefore(item.nextElementSibling, item);
    }
  }

  customizeButton?.addEventListener('click', () => {
    savedState = readState();
    setEditing(true);
  });

  cancelButton?.addEventListener('click', () => {
    applyState(savedState);
    setEditing(false);
  });

  saveButton?.addEventListener('click', () => {
    saveCurrentState().catch((error) => {
      setStatus(error.message);
    });
  });

  resetButton?.addEventListener('click', () => {
    resetSettings().catch((error) => {
      setStatus(error.message);
    });
  });

  grid.addEventListener('click', (event) => {
    if (editing && event.target.closest('a.mypage-tile')) {
      event.preventDefault();
    }

    const item = event.target.closest('.mypage-tile-shell');
    if (!editing || !item) return;

    if (event.target.closest('.mypage-tile-hide')) {
      item.classList.toggle('is-hidden');
      updateToggleButton(item);
    } else if (event.target.closest('.mypage-tile-up')) {
      moveItem(item, -1);
    } else if (event.target.closest('.mypage-tile-down')) {
      moveItem(item, 1);
    }
  });

  grid.addEventListener('dragstart', (event) => {
    if (!editing) {
      event.preventDefault();
      return;
    }
    dragItem = event.target.closest('.mypage-tile-shell');
    if (!dragItem) return;
    dragItem.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragItem.dataset.tileId || '');
  });

  grid.addEventListener('dragover', (event) => {
    if (!editing || !dragItem) return;
    event.preventDefault();

    const target = event.target.closest('.mypage-tile-shell');
    if (!target || target === dragItem) return;

    const rect = target.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2
      || (event.clientY >= rect.top && event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2);

    if (before) {
      grid.insertBefore(dragItem, target);
    } else {
      grid.insertBefore(dragItem, target.nextElementSibling);
    }
  });

  grid.addEventListener('dragend', () => {
    if (dragItem) {
      dragItem.classList.remove('is-dragging');
    }
    dragItem = null;
  });
})();
