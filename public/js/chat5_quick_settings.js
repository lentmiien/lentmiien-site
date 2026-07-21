(function exposeChat5QuickSettings(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Chat5QuickSettings = api;
    if (root.document) {
      root.document.addEventListener('DOMContentLoaded', () => api.initialize(root.document, root));
    }
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createChat5QuickSettings() {
  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
  }

  function normalizeList(value) {
    const values = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(',') : []);
    return [...new Set(values
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean))];
  }

  function setInputValue(doc, id, value) {
    const input = doc.getElementById(id);
    if (!input) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function addSelectOption(select, value) {
    if (!select || !select.ownerDocument || typeof select.ownerDocument.createElement !== 'function') return null;
    const option = select.ownerDocument.createElement('option');
    option.value = value;
    option.textContent = `${value} (saved quick setting)`;
    option.dataset.quickSettingFallback = 'true';
    select.appendChild(option);
    return option;
  }

  function setSingleSelectValue(doc, id, value) {
    const select = doc.getElementById(id);
    if (!select) return false;
    const normalized = value === undefined || value === null ? '' : String(value);
    let option = Array.from(select.options || []).find((entry) => entry.value === normalized);
    if (!option && normalized) {
      option = addSelectOption(select, normalized);
    }
    if (!option && normalized) return false;
    select.value = normalized;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function setMultiSelectValue(doc, id, value) {
    const select = doc.getElementById(id);
    if (!select) return false;
    const selectedValues = normalizeList(value);
    const selected = new Set(selectedValues);
    const options = Array.from(select.options || []);
    selectedValues.forEach((entry) => {
      if (!options.some((option) => option.value === entry)) {
        const option = addSelectOption(select, entry);
        if (option) options.push(option);
      }
    });
    options.forEach((option) => {
      option.selected = selected.has(option.value);
    });
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function applyOverrides(overrides, { document: doc, currentUser = '' } = {}) {
    if (!doc || !overrides || typeof overrides !== 'object') return [];
    const applied = [];

    if (hasOwn(overrides, 'category') && setInputValue(doc, 'category', String(overrides.category || ''))) {
      applied.push('category');
    }
    if (hasOwn(overrides, 'tags') && setInputValue(doc, 'tags', normalizeList(overrides.tags).join(', '))) {
      applied.push('tags');
    }
    if (hasOwn(overrides, 'context') && setInputValue(doc, 'context', typeof overrides.context === 'string' ? overrides.context : '')) {
      applied.push('context');
    }
    if (hasOwn(overrides, 'tools') && setMultiSelectValue(doc, 'tools', overrides.tools)) {
      applied.push('tools');
    }
    if (hasOwn(overrides, 'model') && setSingleSelectValue(doc, 'model', overrides.model)) {
      applied.push('model');
    }
    if (hasOwn(overrides, 'maxMessages') && setInputValue(doc, 'maxMessages', String(overrides.maxMessages))) {
      applied.push('max messages');
    }
    if (hasOwn(overrides, 'reasoning') && setSingleSelectValue(doc, 'reasoning', overrides.reasoning)) {
      applied.push('reasoning effort');
    }
    if (hasOwn(overrides, 'mode') && setSingleSelectValue(doc, 'mode', overrides.mode)) {
      applied.push('reasoning mode');
    }
    if (hasOwn(overrides, 'verbosity') && setSingleSelectValue(doc, 'verbosity', overrides.verbosity)) {
      applied.push('verbosity');
    }
    if (hasOwn(overrides, 'members')) {
      const members = normalizeList(overrides.members);
      const normalizedCurrentUser = typeof currentUser === 'string' ? currentUser.trim() : '';
      if (normalizedCurrentUser && !members.includes(normalizedCurrentUser)) {
        members.push(normalizedCurrentUser);
      }
      if (setInputValue(doc, 'members', members.join(', '))) {
        applied.push('members');
      }
    }

    syncQuickConversationInputs(doc);
    return applied;
  }

  function syncPairedInputs(primary, secondary) {
    if (!primary || !secondary) return;
    const updateSecondary = () => {
      secondary.value = primary.value;
    };
    const updatePrimary = () => {
      primary.value = secondary.value;
      primary.dispatchEvent(new Event('change', { bubbles: true }));
    };
    primary.addEventListener('input', updateSecondary);
    secondary.addEventListener('input', updatePrimary);
    updateSecondary();
  }

  function syncQuickConversationInputs(doc) {
    const category = doc.getElementById('category');
    const quickCategory = doc.getElementById('quickCategory');
    const tags = doc.getElementById('tags');
    const quickTags = doc.getElementById('quickTags');
    if (category && quickCategory) quickCategory.value = category.value;
    if (tags && quickTags) quickTags.value = tags.value;
  }

  function initializeConversationInputSync(doc) {
    syncPairedInputs(doc.getElementById('category'), doc.getElementById('quickCategory'));
    syncPairedInputs(doc.getElementById('tags'), doc.getElementById('quickTags'));
  }

  function updateConversationState(doc) {
    const idElement = doc.getElementById('id');
    const isNew = idElement && idElement.textContent.trim() === 'NEW';
    doc.querySelectorAll('[data-quick-new-only]').forEach((element) => {
      element.classList.toggle('d-none', !isNew);
    });
  }

  function setStatus(status, message, state) {
    if (!status) return;
    status.textContent = message;
    status.classList.remove('text-muted', 'text-success', 'text-danger', 'text-warning');
    status.classList.add(state === 'success'
      ? 'text-success'
      : (state === 'error' ? 'text-danger' : (state === 'warning' ? 'text-warning' : 'text-muted')));
  }

  function initializeChatSelector(doc, root) {
    const select = doc.getElementById('quickSettingsSelect');
    if (!select || select.dataset.quickSettingsBound === 'true') return;
    select.dataset.quickSettingsBound = 'true';
    const status = doc.getElementById('quickSettingsStatus');
    const idElement = doc.getElementById('id');

    select.addEventListener('change', () => {
      const option = select.selectedOptions && select.selectedOptions[0];
      if (!option || !option.value) {
        setStatus(status, 'Ignored fields remain unchanged.', 'muted');
        return;
      }

      let overrides;
      try {
        overrides = JSON.parse(option.dataset.overrides || '{}');
      } catch (error) {
        setStatus(status, 'This quick setting could not be read.', 'error');
        return;
      }

      const applied = applyOverrides(overrides, {
        document: doc,
        currentUser: select.dataset.currentUser || '',
      });
      const name = option.textContent.trim();
      const fieldSummary = applied.length > 0 ? applied.join(', ') : 'no fields';
      const conversationId = idElement ? idElement.textContent.trim() : '';
      const isNew = conversationId === 'NEW';
      const isSavedChat5 = !isNew && idElement && idElement.dataset.source === 'conversation5';

      if (isSavedChat5) {
        if (!root || typeof root.UpdateConversation !== 'function') {
          setStatus(status, `Applied ${name} in the UI, but the server update action is unavailable.`, 'error');
          return;
        }
        select.disabled = true;
        setStatus(status, `Applying ${name} and updating the conversation...`, 'muted');
        root.UpdateConversation({
          onComplete(ok, response) {
            select.disabled = false;
            if (ok) {
              setStatus(status, `Applied ${name}: ${fieldSummary}. Conversation updated.`, 'success');
              select.value = '';
            } else {
              const message = response && response.message ? response.message : 'Conversation update failed.';
              setStatus(status, `Applied in the UI, but ${message}`, 'error');
            }
          },
        });
        return;
      }

      if (!isNew) {
        setStatus(status, `Applied ${name} in the UI. This legacy conversation cannot be updated from Chat5 settings yet.`, 'warning');
        return;
      }

      setStatus(status, `Applied ${name}: ${fieldSummary}. These values will be sent with the first message.`, 'success');
      select.value = '';
    });
  }

  function syncOverrideMode(select, doc) {
    const form = select.closest('[data-quick-setting-form]');
    if (!form) return;
    const field = form.querySelector(`[data-field-id="${select.dataset.target}"]`);
    if (!field) return;
    field.disabled = select.value !== 'override';
  }

  function syncContextMode(select, doc) {
    const text = doc.getElementById(select.dataset.textTarget);
    const template = doc.getElementById(select.dataset.templateTarget);
    if (text) {
      text.disabled = select.value !== 'text';
      text.classList.toggle('d-none', select.value !== 'text');
    }
    if (template) {
      template.disabled = select.value !== 'template';
      template.classList.toggle('d-none', select.value !== 'template');
    }
  }

  function initializeManagementForms(doc) {
    doc.querySelectorAll('[data-quick-setting-mode]').forEach((select) => {
      if (select.dataset.quickSettingsBound === 'true') return;
      select.dataset.quickSettingsBound = 'true';
      select.addEventListener('change', () => syncOverrideMode(select, doc));
      syncOverrideMode(select, doc);
    });
    doc.querySelectorAll('[data-quick-context-mode]').forEach((select) => {
      if (select.dataset.quickSettingsBound === 'true') return;
      select.dataset.quickSettingsBound = 'true';
      select.addEventListener('change', () => syncContextMode(select, doc));
      syncContextMode(select, doc);
    });
  }

  function initialize(doc, root) {
    initializeManagementForms(doc);
    initializeConversationInputSync(doc);
    updateConversationState(doc);
    initializeChatSelector(doc, root);
  }

  return {
    applyOverrides,
    initialize,
    normalizeList,
    syncQuickConversationInputs,
    updateConversationState,
  };
}));
