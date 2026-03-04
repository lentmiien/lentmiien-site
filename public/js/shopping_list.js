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

  let state = loadState();
  if (!state || state.date !== todayLabel) {
    localStorage.removeItem(STORAGE_KEY);
    state = { date: todayLabel, items: {}, cookbookGroups: {} };
  }

  if (!state.items || typeof state.items !== 'object') {
    state.items = {};
  }
  if (!state.cookbookGroups || typeof state.cookbookGroups !== 'object') {
    state.cookbookGroups = {};
  }

  syncState(state, sources);
  saveState(state);

  renderAll();
  bindInteractions();

  function buildSources(payload) {
    const tobuy = (payload.toBuyTasks || []).map(task => ({
      kind: 'basic',
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
        kind: 'basic',
        key: `emergency:${item.id}`,
        title: item.name || 'Unlabeled category',
        description: `Need ${remaining} ${item.unit}`,
        meta: [`Stock: ${current} / ${recommended} ${item.unit}`],
        details: '',
      };
    });

    const cookbookGroups = new Map();
    const legacyCooking = [];

    (payload.cookingEntries || []).forEach((entry) => {
      if (entry && entry.source === 'cookbook') {
        const recipeKey = String(entry.recipeId || entry.id || '').trim();
        if (!recipeKey) {
          return;
        }

        let group = cookbookGroups.get(recipeKey);
        if (!group) {
          group = {
            recipeKey,
            title: entry.title || 'Recipe',
            basePortions: parsePositiveNumber(entry.portions),
            ingredients: normalizeCookbookIngredients(entry.ingredients),
            optionalVariants: new Map(),
            categories: new Set(),
            dates: new Set(),
            count: 0,
            sortDate: entry.date || '',
          };
          cookbookGroups.set(recipeKey, group);
        }

        group.count += 1;
        if (entry.category) {
          group.categories.add(entry.category);
        }
        if (entry.date) {
          group.dates.add(entry.date);
          if (!group.sortDate || entry.date < group.sortDate) {
            group.sortDate = entry.date;
          }
        }
        if (!group.basePortions) {
          group.basePortions = parsePositiveNumber(entry.portions);
        }
        if ((!group.ingredients || group.ingredients.length === 0) && Array.isArray(entry.ingredients)) {
          group.ingredients = normalizeCookbookIngredients(entry.ingredients);
        }
        if (Array.isArray(entry.optionalVariants)) {
          entry.optionalVariants.forEach((variant, variantIndex) => {
            const normalizedVariant = normalizeOptionalVariant(variant, `Optional variant ${variantIndex + 1}`);
            if (!normalizedVariant) {
              return;
            }
            const variantKey = `${normalizedVariant.label}::${normalizedVariant.details}`;
            group.optionalVariants.set(variantKey, normalizedVariant);
          });
        }
        return;
      }

      legacyCooking.push({
        kind: 'legacy',
        key: `cooking:${entry.id}`,
        title: entry.title || 'Recipe',
        description: entry.category ? `Category: ${entry.category}` : 'Category: Other',
        meta: [`Date: ${entry.date}`],
        details: entry.contentMarkdown || 'No recipe notes available.',
        sortDate: entry.date || '',
      });
    });

    const groupedCookbook = Array.from(cookbookGroups.values()).map((group) => {
      const categoryList = Array.from(group.categories).filter(Boolean).sort();
      const dateList = Array.from(group.dates).filter(Boolean).sort();
      const basePortions = group.basePortions;
      const defaultPortions = basePortions
        ? basePortions * Math.max(group.count, 1)
        : Math.max(group.count, 1);
      const sortedOptionalVariants = Array.from(group.optionalVariants.values()).sort((a, b) => {
        if (a.label !== b.label) {
          return a.label.localeCompare(b.label);
        }
        return a.details.localeCompare(b.details);
      });

      const metaLabel = dateList.length <= 1
        ? `Date: ${dateList[0] || 'Unknown'}`
        : `Dates: ${dateList.join(', ')}`;

      return {
        kind: 'cookbook',
        groupKey: `cookbook:${group.recipeKey}`,
        title: group.title,
        description: categoryList.length ? `Category: ${categoryList.join(', ')}` : 'Category: Other',
        meta: [metaLabel],
        basePortions,
        defaultPortions,
        ingredients: Array.isArray(group.ingredients) ? group.ingredients : [],
        optionalVariants: sortedOptionalVariants,
        checklist: buildCookbookChecklistItems(
          Array.isArray(group.ingredients) ? group.ingredients : [],
          sortedOptionalVariants
        ),
        sortDate: group.sortDate,
      };
    });

    const cooking = [...groupedCookbook, ...legacyCooking].sort((a, b) => {
      if (a.sortDate !== b.sortDate) {
        return String(a.sortDate).localeCompare(String(b.sortDate));
      }
      return String(a.title || '').localeCompare(String(b.title || ''));
    });

    return {
      tobuy: { label: 'To Buy Tasks', items: tobuy },
      emergency: { label: 'Emergency Stock', items: emergency },
      cooking: { label: 'Cooking Calendar', items: cooking },
    };
  }

  function normalizeCookbookIngredients(rawIngredients) {
    if (!Array.isArray(rawIngredients)) {
      return [];
    }

    return rawIngredients.map((ingredient, index) => ({
      index,
      label: String(ingredient?.label || `Ingredient ${index + 1}`),
      amount: Number.isFinite(ingredient?.amount) ? ingredient.amount : null,
      unit: String(ingredient?.unit || ''),
      amountInGram: Number.isFinite(ingredient?.amountInGram) ? ingredient.amountInGram : null,
    }));
  }

  function normalizeOptionalVariant(rawVariant, fallbackLabel) {
    if (!rawVariant || typeof rawVariant !== 'object') {
      const label = String(rawVariant || '').trim();
      if (!label) {
        return null;
      }
      return {
        label,
        details: '',
      };
    }

    const label = String(rawVariant.label || '').trim() || fallbackLabel;
    const details = String(rawVariant.details || '').trim();
    if (!label && !details) {
      return null;
    }

    return {
      label: label || fallbackLabel,
      details,
    };
  }

  function buildCookbookChecklistItems(ingredients, optionalVariants) {
    const checklist = [];

    ingredients.forEach((ingredient) => {
      checklist.push({
        key: `base:${ingredient.index}`,
        label: ingredient.label,
        amount: ingredient.amount,
        unit: ingredient.unit,
        amountInGram: ingredient.amountInGram,
        required: true,
        optional: false,
        variantLabel: '',
      });
    });

    (optionalVariants || []).forEach((variant, variantIndex) => {
      const lines = extractOptionalChecklistLines(variant.details);
      lines.forEach((line, lineIndex) => {
        checklist.push({
          key: `optional:${variantIndex}:${lineIndex}:${toChecklistKey(line)}`,
          label: line,
          amount: null,
          unit: '',
          amountInGram: null,
          required: false,
          optional: true,
          variantLabel: variant.label || 'Optional',
        });
      });
    });

    return checklist;
  }

  function extractOptionalChecklistLines(details) {
    if (!details || typeof details !== 'string') {
      return [];
    }

    const lines = details
      .split('\n')
      .map((line) => line.trim())
      .map((line) => line.replace(/^[-*+]\s+/, ''))
      .map((line) => line.replace(/^\d+[.)]\s+/, ''))
      .map((line) => line.replace(/^\[\s*\]\s*/i, ''))
      .map((line) => line.replace(/^\[[xX]\]\s*/i, ''))
      .filter(Boolean);

    return lines;
  }

  function toChecklistKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item';
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

  function syncState(nextState, sourceData) {
    const cardItems = [];
    const cookbookItems = [];

    Object.values(sourceData).forEach((source) => {
      (source.items || []).forEach((item) => {
        if (item.kind === 'cookbook') {
          cookbookItems.push(item);
        } else {
          cardItems.push(item);
        }
      });
    });

    const currentCardKeys = new Set(cardItems.map(item => item.key));
    Object.keys(nextState.items).forEach((key) => {
      if (!currentCardKeys.has(key)) {
        delete nextState.items[key];
      }
    });

    cardItems.forEach((item) => {
      if (!nextState.items[item.key]) {
        nextState.items[item.key] = {
          done: false,
          addedAt: new Date().toISOString(),
        };
      }
    });

    const currentCookbookKeys = new Set(cookbookItems.map(item => item.groupKey));
    Object.keys(nextState.cookbookGroups).forEach((groupKey) => {
      if (!currentCookbookKeys.has(groupKey)) {
        delete nextState.cookbookGroups[groupKey];
      }
    });

    cookbookItems.forEach((item) => {
      ensureCookbookGroupState(item);
    });
  }

  function ensureCookbookGroupState(item) {
    const existing = state.cookbookGroups[item.groupKey] || {};
    const portions = parsePositiveNumber(existing.portions) || item.defaultPortions;
    const checked = {};

    item.checklist.forEach((entry) => {
      checked[entry.key] = Boolean(existing.checked && existing.checked[entry.key]);
    });

    state.cookbookGroups[item.groupKey] = {
      portions,
      checked,
    };

    return state.cookbookGroups[item.groupKey];
  }

  function renderAll() {
    renderSection('tobuy', sources.tobuy.items);
    renderSection('emergency', sources.emergency.items);
    renderCookingSection(sources.cooking.items);
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
        : 'Stock levels are healthy.';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      fragment.appendChild(createCardElement(item, index));
    });

    container.appendChild(fragment);
  }

  function renderCookingSection(items) {
    const container = listEls.cooking;
    if (!container) {
      return;
    }

    container.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'shopping-empty';
      empty.textContent = 'No upcoming recipes in the next week.';
      container.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      if (item.kind === 'cookbook') {
        fragment.appendChild(createCookbookGroupElement(item, index));
      } else {
        fragment.appendChild(createCardElement(item, index));
      }
    });

    container.appendChild(fragment);
  }

  function createCardElement(item, index) {
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
      item.meta.forEach((text) => {
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
    return card;
  }

  function createCookbookGroupElement(item, index) {
    const groupState = ensureCookbookGroupState(item);
    const portions = parsePositiveNumber(groupState.portions) || item.defaultPortions;
    const basePortions = item.basePortions || item.defaultPortions;
    const scale = basePortions > 0 ? portions / basePortions : 1;
    const done = isCookbookGroupDone(item, groupState);

    const card = document.createElement('article');
    card.className = 'shopping-cookbook-group';
    card.dataset.groupKey = item.groupKey;
    card.dataset.done = done ? 'true' : 'false';
    card.style.setProperty('--item-delay', `${Math.min(index * 0.05, 0.4)}s`);

    const marker = document.createElement('div');
    marker.className = 'shopping-cookbook-group__marker';

    const content = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'shopping-item__header';

    const title = document.createElement('h3');
    title.className = 'shopping-item__title';
    title.textContent = item.title;

    const status = document.createElement('span');
    status.className = 'shopping-item__status';
    status.textContent = done ? 'Done' : 'Not done';

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
      item.meta.forEach((text) => {
        const chip = document.createElement('span');
        chip.className = 'shopping-chip';
        chip.textContent = text;
        meta.appendChild(chip);
      });
      content.appendChild(meta);
    }

    const portionsWrap = document.createElement('div');
    portionsWrap.className = 'shopping-cookbook-portions';

    const portionsLabel = document.createElement('label');
    portionsLabel.className = 'shopping-cookbook-portions__label';
    portionsLabel.textContent = 'Number of portions';

    const portionsInput = document.createElement('input');
    portionsInput.className = 'shopping-cookbook-portions__input';
    portionsInput.type = 'number';
    portionsInput.min = '0.1';
    portionsInput.step = '0.5';
    portionsInput.value = formatInputNumber(portions);
    portionsInput.dataset.action = 'portion-input';
    portionsInput.dataset.groupKey = item.groupKey;

    portionsLabel.appendChild(portionsInput);
    portionsWrap.appendChild(portionsLabel);
    content.appendChild(portionsWrap);

    if (item.checklist.length) {
      const list = document.createElement('ul');
      list.className = 'shopping-ingredient-list';

      item.checklist.forEach((checkItem) => {
        const li = document.createElement('li');
        li.className = 'shopping-ingredient-list__item';

        const rowLabel = document.createElement('label');
        rowLabel.className = `shopping-ingredient-row${checkItem.optional ? ' shopping-ingredient-row--optional' : ''}`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'shopping-ingredient-row__checkbox';
        checkbox.dataset.action = 'ingredient-toggle';
        checkbox.dataset.groupKey = item.groupKey;
        checkbox.dataset.ingredientKey = checkItem.key;
        checkbox.checked = Boolean(groupState.checked[checkItem.key]);

        const textWrap = document.createElement('span');
        textWrap.className = 'shopping-ingredient-row__text';

        const titleText = document.createElement('span');
        titleText.className = 'shopping-ingredient-row__title';
        titleText.textContent = checkItem.label;

        const amountText = document.createElement('span');
        amountText.className = 'shopping-ingredient-row__amount';
        amountText.textContent = formatChecklistAmount(checkItem, scale);

        textWrap.appendChild(titleText);
        textWrap.appendChild(amountText);

        rowLabel.appendChild(checkbox);
        rowLabel.appendChild(textWrap);

        li.appendChild(rowLabel);
        list.appendChild(li);
      });

      content.appendChild(list);
    } else {
      const noIngredients = document.createElement('div');
      noIngredients.className = 'shopping-item__details';
      noIngredients.textContent = 'No ingredients available for this cookbook entry.';
      content.appendChild(noIngredients);
    }

    if (item.optionalVariants.length) {
      const variantsBlock = document.createElement('div');
      variantsBlock.className = 'shopping-cookbook-variants';

      const variantsLabel = document.createElement('p');
      variantsLabel.className = 'shopping-cookbook-variants__label';
      variantsLabel.textContent = 'Optional';
      variantsBlock.appendChild(variantsLabel);

      item.optionalVariants.forEach((variant) => {
        const variantEntry = document.createElement('article');
        variantEntry.className = 'shopping-cookbook-variant';

        const variantTitle = document.createElement('p');
        variantTitle.className = 'shopping-cookbook-variant__title';
        variantTitle.textContent = variant.label || 'Optional variant';
        variantEntry.appendChild(variantTitle);

        const variantDetails = document.createElement('div');
        variantDetails.className = 'shopping-cookbook-variant__details';
        variantDetails.textContent = variant.details || 'No details provided.';
        variantEntry.appendChild(variantDetails);

        variantsBlock.appendChild(variantEntry);
      });
      content.appendChild(variantsBlock);
    }

    card.appendChild(marker);
    card.appendChild(content);

    return card;
  }

  function bindInteractions() {
    Object.values(listEls).forEach((container) => {
      if (!container) {
        return;
      }

      container.addEventListener('click', (event) => {
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

      container.addEventListener('keydown', (event) => {
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

    if (listEls.cooking) {
      listEls.cooking.addEventListener('change', handleCookingInteraction);
    }
  }

  function handleCookingInteraction(event) {
    const ingredientCheckbox = event.target.closest('input[data-action="ingredient-toggle"]');
    if (ingredientCheckbox) {
      const groupKey = ingredientCheckbox.dataset.groupKey;
      const ingredientKey = String(ingredientCheckbox.dataset.ingredientKey || '').trim();
      if (groupKey && ingredientKey) {
        updateCookbookIngredient(groupKey, ingredientKey, ingredientCheckbox.checked);
      }
      return;
    }

    const portionsInput = event.target.closest('input[data-action="portion-input"]');
    if (portionsInput) {
      const groupKey = portionsInput.dataset.groupKey;
      if (groupKey) {
        updateCookbookPortions(groupKey, portionsInput.value);
      }
    }
  }

  function updateCookbookIngredient(groupKey, ingredientKey, checked) {
    const groupState = state.cookbookGroups[groupKey];
    if (!groupState || !groupState.checked) {
      return;
    }
    groupState.checked[ingredientKey] = Boolean(checked);
    saveState(state);
    renderCookingSection(sources.cooking.items);
    updateCounts();
  }

  function updateCookbookPortions(groupKey, rawValue) {
    const parsed = parsePositiveNumber(rawValue);
    if (!parsed) {
      renderCookingSection(sources.cooking.items);
      return;
    }

    const groupState = state.cookbookGroups[groupKey];
    if (!groupState) {
      return;
    }

    groupState.portions = parsed;
    saveState(state);
    renderCookingSection(sources.cooking.items);
    updateCounts();
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
      const doneCount = items.filter(item => isItemDone(item)).length;
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

  function isItemDone(item) {
    if (item.kind === 'cookbook') {
      const groupState = state.cookbookGroups[item.groupKey];
      return isCookbookGroupDone(item, groupState);
    }
    return Boolean(state.items[item.key]?.done);
  }

  function isCookbookGroupDone(item, groupState = null) {
    const localState = groupState || state.cookbookGroups[item.groupKey];
    const requiredChecklist = item.checklist.filter((entry) => entry.required);
    if (!requiredChecklist.length || !localState || !localState.checked) {
      return false;
    }
    return requiredChecklist.every(entry => Boolean(localState.checked[entry.key]));
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

  function formatChecklistAmount(checkItem, scale) {
    if (checkItem.optional) {
      return checkItem.variantLabel ? `Optional (${checkItem.variantLabel})` : 'Optional';
    }

    const amountValue = Number.isFinite(checkItem.amount) ? checkItem.amount * scale : null;
    const gramValue = Number.isFinite(checkItem.amountInGram) ? checkItem.amountInGram * scale : null;

    const amountText = amountValue !== null
      ? `${formatAmount(amountValue)}${checkItem.unit ? ` ${checkItem.unit}` : ''}`
      : '';
    const gramText = gramValue !== null ? `${formatAmount(gramValue)} g` : '';

    if (amountText && gramText) {
      return `${amountText} (${gramText})`;
    }
    if (amountText) {
      return amountText;
    }
    if (gramText) {
      return gramText;
    }
    return 'amount not specified';
  }

  function parsePositiveNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      return null;
    }
    return number;
  }

  function formatInputNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return '1';
    }
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
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
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return '0';
    }
    if (Number.isInteger(numeric)) {
      return String(numeric);
    }
    return numeric.toFixed(1);
  }
})();
