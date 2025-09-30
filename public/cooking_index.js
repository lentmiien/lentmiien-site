
(() => {
  const config = window.COOKING_CALENDAR_V2 || {};
  const bs = window.bootstrap || null;
  const state = {
    defaultCategories: Array.isArray(config.categories) ? [...config.categories] : [],
    categories: Array.isArray(config.categories) ? [...config.categories] : [],
    startDate: config.initialDate || new Date().toISOString().slice(0, 10),
    recipes: [],
    filteredRecipes: [],
    selectedRecipeId: null,
    selectedDate: null,
  };

  let calendarContainer;
  let recipeModal;
  let toastInstance;
  let toastMessage;
  let recipeListEl;
  let categorySelectEl;
  let customCategoryEl;
  let recipeSearchEl;
  let scheduleButtonEl;
  let warningAlertEl;
  let recipeCountEl;
  let selectedDateLabelEl;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    calendarContainer = document.getElementById('calendarDays');
    const modalElement = document.getElementById('recipeModal');
    recipeModal = modalElement && bs ? new bs.Modal(modalElement) : null;

    const toastEl = document.querySelector('.toast');
    if (toastEl && bs) {
      toastInstance = new bs.Toast(toastEl, { delay: 2400 });
      toastMessage = toastEl.querySelector('#toastMessage');
    }

    recipeListEl = document.querySelector('.recipe-list');
    categorySelectEl = document.getElementById('categorySelect');
    customCategoryEl = document.getElementById('customCategory');
    recipeSearchEl = document.getElementById('recipeSearch');
    scheduleButtonEl = document.getElementById('scheduleRecipe');
    warningAlertEl = document.getElementById('recentWarning');
    recipeCountEl = document.getElementById('recipeCount');
    selectedDateLabelEl = document.getElementById('selectedDateLabel');

    bindGlobalEvents();

    try {
      await Promise.all([loadRecipes(), refreshCalendar()]);
    } catch (error) {
      console.error(error);
      showToast('Unable to load cooking calendar.', true);
    }
  }

  function bindGlobalEvents() {
    const prevWeekBtn = document.getElementById('prevWeek');
    const nextWeekBtn = document.getElementById('nextWeek');
    const reloadBtn = document.getElementById('reloadCalendar');
    const weekStartInput = document.getElementById('weekStart');

    if (prevWeekBtn) {
      prevWeekBtn.addEventListener('click', () => shiftWeek(-1));
    }
    if (nextWeekBtn) {
      nextWeekBtn.addEventListener('click', () => shiftWeek(1));
    }
    if (reloadBtn) {
      reloadBtn.addEventListener('click', refreshCalendar);
    }
    if (weekStartInput) {
      weekStartInput.value = state.startDate;
      weekStartInput.addEventListener('change', () => {
        if (weekStartInput.value) {
          state.startDate = weekStartInput.value;
          refreshCalendar();
        }
      });
    }

    if (scheduleButtonEl) {
      scheduleButtonEl.addEventListener('click', submitSchedule);
    }
    if (recipeSearchEl) {
      recipeSearchEl.addEventListener('input', applyRecipeFilter);
    }
    if (customCategoryEl) {
      customCategoryEl.addEventListener('input', () => {
        if (customCategoryEl.value.trim().length > 0 && categorySelectEl) {
          categorySelectEl.value = '';
        }
      });
    }
    if (categorySelectEl) {
      categorySelectEl.addEventListener('change', () => {
        if (categorySelectEl.value) {
          customCategoryEl.value = '';
        }
      });
    }

    if (calendarContainer) {
      calendarContainer.addEventListener('click', handleCalendarClick);
    }
  }

  async function loadRecipes() {
    const response = await fetch('/cooking/v2/api/recipes', { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('Failed to load recipes');
    }
    const data = await response.json();
    state.recipes = Array.isArray(data.recipes) ? data.recipes : [];
    state.filteredRecipes = [...state.recipes];
    if (!state.defaultCategories.length && Array.isArray(data.categories)) {
      state.defaultCategories = [...data.categories];
    }
    updateCategorySet();
    renderRecipeList();
  }

  async function refreshCalendar() {
    if (!calendarContainer) {
      return;
    }
    calendarContainer.innerHTML = '<div class="col-12"><div class="text-center text-muted py-5">Loading calendar...</div></div>';

    const url = new URL('/cooking/v2/api/calendar', window.location.origin);
    url.searchParams.set('start', state.startDate);
    url.searchParams.set('days', '6');

    const response = await fetch(url.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error('Failed to load calendar');
    }
    const data = await response.json();
    state.calendar = Array.isArray(data.days) ? data.days : [];
    state.startDate = data?.range?.start || state.startDate;

    const weekStartInput = document.getElementById('weekStart');
    if (weekStartInput) {
      weekStartInput.value = state.startDate;
    }

    updateCategorySet();
    renderCalendar();
  }

  function updateCategorySet() {
    const categorySet = new Set(state.defaultCategories);
    state.calendar.forEach(day => {
      (day.entries || []).forEach(entry => {
        if (entry.category) {
          categorySet.add(entry.category);
        }
      });
    });
    state.categories = Array.from(categorySet);
  }

  function renderCalendar() {
    if (!calendarContainer) {
      return;
    }

    if (!state.calendar.length) {
      calendarContainer.innerHTML = '<div class="col-12"><div class="text-center text-muted py-5">No entries scheduled for this range.</div></div>';
      return;
    }

    const fragments = state.calendar.map(day => renderDayCard(day)).join('');
    calendarContainer.innerHTML = fragments;
  }

  function renderDayCard(day) {
    const dateLabel = formatDisplayDate(day.date, { withWeekday: false });
    const entryGroups = groupEntriesByCategory(day.entries || []);
    const suggestedCategories = state.categories.slice(0, 5);

    let quickActions = '';
    if (suggestedCategories.length > 0) {
      quickActions = `<div class="d-flex flex-wrap gap-2">${suggestedCategories.map(category => `
        <button class="btn btn-sm btn-outline-secondary" data-action="open-modal" data-date="${day.date}" data-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>
      `).join('')}</div>`;
    }

    let entriesMarkup = '';
    entryGroups.forEach((entries, category) => {
      const items = entries.map(entry => renderEntryItem(entry, day.date)).join('');
      entriesMarkup += `
        <div class="category-group">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0">${escapeHtml(category)}</h6>
            <button class="btn btn-sm btn-light" data-action="open-modal" data-date="${day.date}" data-category="${escapeHtml(category)}" type="button">Add more</button>
          </div>
          ${items}
        </div>
      `;
    });

    if (!entriesMarkup) {
      entriesMarkup = '<div class="text-muted small">No recipes scheduled yet.</div>';
    }

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="calendar-card">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <div>
              <h5 class="mb-1">${escapeHtml(day.weekday)}</h5>
              <small>${escapeHtml(day.date)} &middot; ${dateLabel}</small>
            </div>
            <button class="btn btn-primary" data-action="open-modal" data-date="${day.date}" type="button">Schedule recipe</button>
          </div>
          ${quickActions}
          <div>${entriesMarkup}</div>
        </div>
      </div>
    `;
  }

  function renderEntryItem(entry, dayDate) {
    const recipeId = entry.recipe?.id ? entry.recipe.id : '';
    const recipeTitle = entry.recipe?.title ? escapeHtml(entry.recipe.title) : 'Unknown recipe';
    // const badge = entry.usage?.existInLast10Days ? '<span class="badge bg-warning text-dark ms-2">Cooked recently</span>' : '';
    const lastCookedText = entry.usage?.lastCookedDate
      ? `Last cooked ${formatDisplayDate(entry.usage.lastCookedDate)}`
      : 'Not cooked recently';
    const countsText = `90d: ${entry.usage?.countLast90Days ?? 0} | Total: ${entry.usage?.totalCount ?? 0}`;
    const imageMarkup = entry.recipe?.image
      ? `<img src="/img/${encodeURIComponent(entry.recipe.image)}" alt="${recipeTitle}" class="rounded" style="width:48px;height:48px;object-fit:cover;">`
      : '';

    return `
      <div class="entry-item">
        <div class="d-flex align-items-center gap-3 flex-grow-1">
          ${imageMarkup}
          <div>
            <div class="fw-semibold"><a href="/chat4/viewknowledge/${recipeId}" target="_blank">${recipeTitle}</a></div>
            <div class="entry-meta">Category: ${escapeHtml(entry.category)}</div>
            <div class="entry-meta">${lastCookedText} | ${countsText}</div>
          </div>
        </div>
        <div class="entry-actions">
          <button class="btn btn-sm btn-outline-danger" data-action="delete-entry" data-date="${dayDate}" data-entry-id="${entry.entryId}" type="button">Remove</button>
        </div>
      </div>
    `;
  }

  function handleCalendarClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) {
      return;
    }
    const { action, date, entryId, category } = target.dataset;

    if (action === 'open-modal' && date) {
      openRecipeModal(date, category || '');
    }
    if (action === 'delete-entry' && date && entryId) {
      handleDeleteEntry(date, entryId);
    }
  }

  function openRecipeModal(date, categoryHint = '') {
    state.selectedRecipeId = null;
    state.selectedDate = date;
    scheduleButtonEl.disabled = true;
    if (warningAlertEl) {
      warningAlertEl.classList.add('d-none');
      warningAlertEl.textContent = 'Recently cooked warning';
    }
    if (selectedDateLabelEl) {
      selectedDateLabelEl.textContent = `Scheduling for ${formatDisplayDate(date)} (${date})`;
    }
    if (recipeSearchEl) {
      recipeSearchEl.value = '';
    }
    state.filteredRecipes = [...state.recipes];
    renderRecipeList();
    populateCategorySelect(categoryHint);
    if (recipeModal) {
      recipeModal.show();
    }
  }

  function populateCategorySelect(preferredCategory = '') {
    if (!categorySelectEl) {
      return;
    }
    categorySelectEl.innerHTML = '<option value="">Select a category</option>';
    state.categories.forEach(category => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      categorySelectEl.appendChild(option);
    });

    customCategoryEl.value = '';
    if (preferredCategory) {
      if (state.categories.includes(preferredCategory)) {
        categorySelectEl.value = preferredCategory;
      } else {
        categorySelectEl.value = '';
        customCategoryEl.value = preferredCategory;
      }
    } else {
      categorySelectEl.value = state.categories[0] || '';
    }
  }

  function renderRecipeList() {
    if (!recipeListEl) {
      return;
    }
    if (!state.filteredRecipes.length) {
      recipeListEl.innerHTML = '<div class="list-group-item text-muted">No recipes found.</div>';
      recipeCountEl.textContent = '0 recipes';
      return;
    }

    recipeListEl.innerHTML = state.filteredRecipes.map(recipe => {
      const usage = recipe.usage || {};
      const recentBadge = usage.existInLast10Days ? '<span class="badge bg-warning text-dark ms-2">Recent</span>' : '';
      const lastCooked = usage.lastCookedDate ? formatDisplayDate(usage.lastCookedDate) : 'Not cooked recently';
      return `
        <button type="button" class="list-group-item list-group-item-action" data-recipe-id="${recipe.id}">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-semibold">${escapeHtml(recipe.title)}${recentBadge}</div>
              <div class="text-muted small">Last cooked ${lastCooked}</div>
              <div class="text-muted small">90d: ${usage.countLast90Days || 0} | Total: ${usage.totalCount || 0}</div>
            </div>
          </div>
        </button>
      `;
    }).join('');

    recipeCountEl.textContent = `${state.filteredRecipes.length} recipes`;

    recipeListEl.querySelectorAll('.list-group-item').forEach(item => {
      item.addEventListener('click', () => {
        recipeListEl.querySelectorAll('.list-group-item').forEach(node => node.classList.remove('active'));
        item.classList.add('active');
        state.selectedRecipeId = item.dataset.recipeId;
        scheduleButtonEl.disabled = false;
        const recipe = state.recipes.find(r => r.id === state.selectedRecipeId);
        updateWarning(recipe);
      });
    });
  }

  function applyRecipeFilter() {
    const term = recipeSearchEl ? recipeSearchEl.value.trim().toLowerCase() : '';
    if (!term) {
      state.filteredRecipes = [...state.recipes];
    } else {
      state.filteredRecipes = state.recipes.filter(recipe => recipe.title.toLowerCase().includes(term));
    }
    renderRecipeList();
  }

  function updateWarning(recipe) {
    if (!warningAlertEl) {
      return;
    }
    if (!recipe || !recipe.usage || !recipe.usage.lastCookedDate || !state.selectedDate) {
      warningAlertEl.classList.add('d-none');
      return;
    }
    const diff = daysBetween(recipe.usage.lastCookedDate, state.selectedDate);
    if (diff >= 0 && diff < 10) {
      warningAlertEl.classList.remove('d-none');
      warningAlertEl.textContent = `${recipe.title} was cooked ${diff} day${diff === 1 ? '' : 's'} ago on ${formatDisplayDate(recipe.usage.lastCookedDate)}.`;
    } else {
      warningAlertEl.classList.add('d-none');
    }
  }

  async function submitSchedule() {
    if (!state.selectedRecipeId || !state.selectedDate) {
      return;
    }
    const category = resolveCategory();
    if (!category) {
      showToast('Please select or enter a category.', true);
      return;
    }

    try {
      const initial = await sendScheduleRequest({ force: false, category });
      if (initial?.status === 'warning' && initial.warning) {
        const prompt = `${initial.warning.daysSince} day${initial.warning.daysSince === 1 ? '' : 's'} since last cooked. Schedule anyway?`;
        const confirmProceed = window.confirm(prompt);
        if (!confirmProceed) {
          return;
        }
        await sendScheduleRequest({ force: true, category });
      }

      if (recipeModal) {
        recipeModal.hide();
      }
      showToast('Recipe scheduled successfully.');
      await Promise.all([refreshCalendar(), loadRecipes()]);
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Unable to schedule recipe.', true);
    }
  }

  async function sendScheduleRequest({ force, category }) {
    const payload = {
      date: state.selectedDate,
      recipeId: state.selectedRecipeId,
      category,
      force,
    };

    const response = await fetch('/cooking/v2/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin',
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to schedule recipe.');
    }
    return data;
  }

  function resolveCategory() {
    const custom = customCategoryEl ? customCategoryEl.value.trim() : '';
    if (custom) {
      return custom;
    }
    return categorySelectEl ? categorySelectEl.value : '';
  }

  async function handleDeleteEntry(date, entryId) {
    const confirmed = window.confirm('Remove this recipe from the calendar?');
    if (!confirmed) {
      return;
    }
    try {
      const response = await fetch(`/cooking/v2/api/entries/${date}/${entryId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to remove entry.');
      }
      showToast('Entry removed.');
      await Promise.all([refreshCalendar(), loadRecipes()]);
    } catch (error) {
      console.error(error);
      showToast(error.message || 'Unable to remove entry.', true);
    }
  }

  function shiftWeek(offset) {
    const start = parseDate(state.startDate);
    start.setUTCDate(start.getUTCDate() + offset * 7);
    state.startDate = formatIso(start);
    const weekStartInput = document.getElementById('weekStart');
    if (weekStartInput) {
      weekStartInput.value = state.startDate;
    }
    refreshCalendar();
  }

  function groupEntriesByCategory(entries) {
    const map = new Map();
    entries.forEach(entry => {
      const key = entry.category || 'Uncategorised';
      const bucket = map.get(key) || [];
      bucket.push(entry);
      map.set(key, bucket);
    });
    return map;
  }

  function daysBetween(fromDateStr, toDateStr) {
    const from = parseDate(fromDateStr);
    const to = parseDate(toDateStr);
    return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  }

  function parseDate(value) {
    return new Date(`${value}T00:00:00Z`);
  }

  function formatIso(date) {
    return date.toISOString().slice(0, 10);
  }

  function formatDisplayDate(dateStr, options = {}) {
    if (!dateStr) {
      return '';
    }
    const date = parseDate(dateStr);
    const formatOptions = options.withWeekday
      ? { month: 'short', day: 'numeric', weekday: 'short' }
      : { month: 'short', day: 'numeric' };
    return date.toLocaleDateString(undefined, formatOptions);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, isError = false) {
    if (!toastInstance || !toastMessage) {
      if (isError) {
        window.alert(message);
      }
      return;
    }
    const toastEl = toastMessage.closest('.toast');
    toastEl.classList.toggle('bg-success', !isError);
    toastEl.classList.toggle('bg-danger', isError);
    toastMessage.textContent = message;
    toastInstance.show();
  }
})();
