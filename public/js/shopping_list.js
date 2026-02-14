'use strict';

(() => {
  const data = window.SHOPPING_LIST_DATA;
  if (!data) {
    return;
  }

  const STORAGE_KEY = 'shoppingListState';
  const todayLabel = data?.meta?.today || new Date().toISOString().slice(0, 10);

  const listEls = {
    tobuy: document.getElementById('tobuyList'),
    emergency: document.getElementById('emergencyList'),
    cooking: document.getElementById('cookingList'),
  };

  const countEls = {
    tobuy: document.getElementById('tobuyCount'),
    emergency: document.getElementById('emergencyCount'),
    cooking: document.getElementById('cookingCount'),
  };

  const totalCountEl = document.getElementById('shoppingTotalCount');
  const remainingCountEl = document.getElementById('shoppingRemainingCount');
  const doneCountEl = document.getElementById('shoppingDoneCount');
  const updatedAtEl = document.getElementById('shoppingUpdatedAt');

  const sources = buildSources(data);
  const allItems = Object.values(sources).flatMap(source => source.items);

  let state = loadState();
  if (!state || state.date !== todayLabel) {
    localStorage.removeItem(STORAGE_KEY);
    state = { date: todayLabel, items: {} };
  }

  syncState(state, allItems);
  saveState(state);

  renderAll();
  bindInteractions();

  function buildSources(payload) {
    const tobuy = (payload.toBuyTasks || []).map(task => ({
      key: `tobuy:${task.id}`,
      title: task.title || 'Untitled task',
      description: task.description || '',
      meta: [task.start ? `Start: ${formatShortDate(task.start)}` : 'No start date'],
      details: '',
    }));

    const emergency = (payload.emergencyStock || []).map(item => {
      const remaining = formatAmount(item.remaining);
      const current = formatAmount(item.currentStock);
      const recommended = formatAmount(item.recommendedStock);
      return {
        key: `emergency:${item.id}`,
        title: item.name || 'Unlabeled category',
        description: `Need ${remaining} ${item.unit}`,
        meta: [`Stock: ${current} / ${recommended} ${item.unit}`],
        details: '',
      };
    });

    const cooking = (payload.cookingEntries || []).map(entry => ({
      key: `cooking:${entry.id}`,
      title: entry.title || 'Recipe',
      description: entry.category ? `Category: ${entry.category}` : 'Category: Other',
      meta: [`Date: ${entry.date}`],
      details: entry.contentMarkdown || 'No recipe notes available.',
    }));

    return {
      tobuy: { label: 'To Buy Tasks', items: tobuy },
      emergency: { label: 'Emergency Stock', items: emergency },
      cooking: { label: 'Cooking Calendar', items: cooking },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function saveState(nextState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }

  function syncState(nextState, items) {
    const currentKeys = new Set(items.map(item => item.key));
    Object.keys(nextState.items).forEach(key => {
      if (!currentKeys.has(key)) {
        delete nextState.items[key];
      }
    });

    items.forEach(item => {
      if (!nextState.items[item.key]) {
        nextState.items[item.key] = {
          done: false,
          addedAt: new Date().toISOString(),
        };
      }
    });
  }

  function renderAll() {
    renderSection('tobuy', sources.tobuy.items);
    renderSection('emergency', sources.emergency.items);
    renderSection('cooking', sources.cooking.items);
    updateCounts();
    renderUpdatedAt();
  }

  function renderSection(sourceKey, items) {
    const container = listEls[sourceKey];
    if (!container) {
      return;
    }

    container.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'shopping-empty';
      empty.textContent = sourceKey === 'tobuy'
        ? 'Nothing queued right now.'
        : sourceKey === 'emergency'
          ? 'Stock levels are healthy.'
          : 'No upcoming recipes in the next week.';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'shopping-item';
      card.dataset.key = item.key;
      card.dataset.done = state.items[item.key]?.done ? 'true' : 'false';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', state.items[item.key]?.done ? 'true' : 'false');
      card.style.setProperty('--item-delay', `${Math.min(index * 0.05, 0.4)}s`);

      const marker = document.createElement('div');
      marker.className = 'shopping-item__marker';

      const content = document.createElement('div');

      const header = document.createElement('div');
      header.className = 'shopping-item__header';

      const title = document.createElement('h3');
      title.className = 'shopping-item__title';
      title.textContent = item.title;

      const status = document.createElement('span');
      status.className = 'shopping-item__status';
      status.textContent = state.items[item.key]?.done ? 'Done' : 'Not done';

      header.appendChild(title);
      header.appendChild(status);

      content.appendChild(header);

      if (item.description) {
        const desc = document.createElement('p');
        desc.className = 'shopping-item__description';
        desc.textContent = item.description;
        content.appendChild(desc);
      }

      if (Array.isArray(item.meta) && item.meta.length) {
        const meta = document.createElement('div');
        meta.className = 'shopping-item__meta';
        item.meta.forEach(text => {
          const chip = document.createElement('span');
          chip.className = 'shopping-chip';
          chip.textContent = text;
          meta.appendChild(chip);
        });
        content.appendChild(meta);
      }

      if (item.details) {
        const details = document.createElement('div');
        details.className = 'shopping-item__details';
        details.setAttribute('data-no-toggle', 'true');
        details.textContent = item.details;
        content.appendChild(details);
      }

      card.appendChild(marker);
      card.appendChild(content);
      fragment.appendChild(card);
    });

    container.appendChild(fragment);
  }

  function bindInteractions() {
    Object.values(listEls).forEach(container => {
      if (!container) {
        return;
      }
      container.addEventListener('click', event => {
        const card = event.target.closest('.shopping-item');
        if (!card || !container.contains(card)) {
          return;
        }
        if (event.target.closest('[data-no-toggle]')) {
          return;
        }
        const selection = window.getSelection();
        if (selection && selection.toString()) {
          return;
        }
        toggleItem(card);
      });

      container.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        const card = event.target.closest('.shopping-item');
        if (!card || !container.contains(card)) {
          return;
        }
        event.preventDefault();
        toggleItem(card);
      });
    });
  }

  function toggleItem(card) {
    const key = card.dataset.key;
    if (!key || !state.items[key]) {
      return;
    }
    const nextDone = !state.items[key].done;
    state.items[key].done = nextDone;
    saveState(state);
    card.dataset.done = nextDone ? 'true' : 'false';
    card.setAttribute('aria-pressed', nextDone ? 'true' : 'false');
    const status = card.querySelector('.shopping-item__status');
    if (status) {
      status.textContent = nextDone ? 'Done' : 'Not done';
    }
    updateCounts();
  }

  function updateCounts() {
    let total = 0;
    let done = 0;

    Object.entries(sources).forEach(([key, source]) => {
      const items = source.items || [];
      const doneCount = items.filter(item => state.items[item.key]?.done).length;
      const totalCount = items.length;
      if (countEls[key]) {
        countEls[key].textContent = `${doneCount}/${totalCount}`;
      }
      total += totalCount;
      done += doneCount;
    });

    const remaining = total - done;
    if (totalCountEl) {
      totalCountEl.textContent = total;
    }
    if (doneCountEl) {
      doneCountEl.textContent = done;
    }
    if (remainingCountEl) {
      remainingCountEl.textContent = remaining;
    }
  }

  function renderUpdatedAt() {
    if (!updatedAtEl) {
      return;
    }
    if (!data?.meta?.generatedAt) {
      updatedAtEl.textContent = 'Today';
      return;
    }
    try {
      const date = new Date(data.meta.generatedAt);
      updatedAtEl.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      updatedAtEl.textContent = 'Today';
    }
  }

  function formatShortDate(value) {
    try {
      const date = new Date(value);
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch (error) {
      return value ? String(value) : 'Unknown';
    }
  }

  function formatAmount(value) {
    if (value === null || value === undefined) {
      return '0';
    }
    if (Number.isInteger(value)) {
      return String(value);
    }
    return Number(value).toFixed(1);
  }
})();
