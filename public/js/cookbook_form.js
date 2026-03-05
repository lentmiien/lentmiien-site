(function () {
  const ready = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };

  const setDraftStatus = (statusElement, message, type = 'info') => {
    if (!statusElement) return;
    statusElement.textContent = message || '';
    statusElement.classList.remove('text-muted', 'text-success', 'text-danger');
    if (!message) {
      statusElement.classList.add('text-muted');
      return;
    }
    if (type === 'error') {
      statusElement.classList.add('text-danger');
      return;
    }
    if (type === 'success') {
      statusElement.classList.add('text-success');
      return;
    }
    statusElement.classList.add('text-muted');
  };

  const setFieldValue = (fieldId, value) => {
    const field = document.getElementById(fieldId);
    if (!field) return;
    field.value = value === null || value === undefined ? '' : String(value);
  };

  const setJsonFieldValue = (fieldId, value) => {
    const field = document.getElementById(fieldId);
    if (!field) return;
    const safeArray = Array.isArray(value) ? value : [];
    field.value = JSON.stringify(safeArray, null, 2);
  };

  const applyDraftToForm = (draft) => {
    setFieldValue('food_category', draft.food_category || '');
    setFieldValue('cooking_category', draft.cooking_category || '');
    setFieldValue('cooking_time', draft.cooking_time);
    setFieldValue('portions', draft.portions);
    setFieldValue('calories', draft.calories);

    setJsonFieldValue('ingredientsJson', draft.ingredients);
    setJsonFieldValue('nutritionJson', draft.nutrition);
    setJsonFieldValue('instructionsJson', draft.instructions);
    setJsonFieldValue('suggestionsJson', draft.suggestions);
  };

  ready(() => {
    const copyButton = document.getElementById('copyLegacyKnowledge');
    const markdownSource = document.getElementById('legacyMarkdownSource');
    const draftButton = document.getElementById('draftLegacyKnowledge');
    const draftStatus = document.getElementById('legacyDraftStatus');

    if (draftButton) {
      draftButton.addEventListener('click', async () => {
        const originKnowledgeId = (draftButton.dataset.originKnowledgeId || '').trim();
        const draftEndpoint = draftButton.dataset.draftEndpoint || '/cooking/cookbook/ai-draft';

        if (!originKnowledgeId) {
          setDraftStatus(draftStatus, 'Missing source knowledge ID.', 'error');
          return;
        }

        const originalText = draftButton.textContent;
        draftButton.disabled = true;
        draftButton.textContent = 'Drafting...';
        setDraftStatus(draftStatus, 'Generating structured draft from legacy markdown...');

        try {
          const response = await fetch(draftEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ originKnowledgeId }),
          });

          const contentType = response.headers.get('content-type') || '';
          const payload = contentType.includes('application/json') ? await response.json() : null;

          if (!response.ok || !payload || payload.ok !== true || !payload.draft) {
            const message = payload && payload.error ? payload.error : 'Unable to generate AI draft.';
            throw new Error(message);
          }

          applyDraftToForm(payload.draft);
          setDraftStatus(draftStatus, 'AI draft applied. Review fields and save when ready.', 'success');
        } catch (error) {
          const message = error && error.message ? error.message : 'Unable to generate AI draft.';
          setDraftStatus(draftStatus, message, 'error');
        } finally {
          draftButton.disabled = false;
          draftButton.textContent = originalText;
        }
      });
    }

    if (!copyButton) {
      return;
    }

    copyButton.addEventListener('click', async () => {
      const markdown = markdownSource ? markdownSource.value : '';
      if (!markdown) return;

      try {
        await navigator.clipboard.writeText(markdown);
        const originalText = copyButton.textContent;
        copyButton.textContent = 'Copied';
        setTimeout(() => {
          copyButton.textContent = originalText;
        }, 1200);
      } catch (error) {
        copyButton.textContent = 'Copy failed';
      }
    });
  });
})();
