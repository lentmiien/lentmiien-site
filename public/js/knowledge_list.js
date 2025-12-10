(function () {
  const ready = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };

  const parseImages = (datasetValue) => {
    if (!datasetValue) return [];
    return datasetValue.split('|').map((item) => item.trim()).filter(Boolean);
  };

  const resetPreviewState = (card) => {
    const container = card.querySelector('.knowledge-preview');
    const button = card.querySelector('.knowledge-preview-btn');

    if (container && !container.hasAttribute('hidden')) {
      container.setAttribute('hidden', '');
    }

    if (button) {
      button.textContent = 'Preview';
      button.setAttribute('aria-expanded', 'false');
    }
  };

  const togglePreview = (button) => {
    const card = button.closest('.knowledge-card');
    const container = card ? card.querySelector('.knowledge-preview') : null;
    if (!container) return;

    const isVisible = !container.hasAttribute('hidden');
    if (isVisible) {
      resetPreviewState(card);
      return;
    }

    if (container.dataset.loaded === 'false') {
      const images = parseImages(button.dataset.images);
      const titleElement = card.querySelector('.knowledge-card__title');
      const titleText = titleElement ? titleElement.textContent.trim() : 'Knowledge preview';

      container.textContent = '';
      images.forEach((name) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-image-wrapper';

        const image = document.createElement('img');
        image.loading = 'lazy';
        image.src = `/img/${name}`;
        image.alt = `${titleText} preview`;

        wrapper.appendChild(image);
        container.appendChild(wrapper);
      });

      if (images.length === 0) {
        const fallback = document.createElement('span');
        fallback.className = 'preview-placeholder';
        fallback.textContent = 'No preview images available.';
        container.appendChild(fallback);
      }

      container.dataset.loaded = 'true';
    }

    container.removeAttribute('hidden');
    button.textContent = 'Hide preview';
    button.setAttribute('aria-expanded', 'true');
  };

  const applyFilters = (state) => {
    const { categoryValue, tagValue, sections, noResultsMessage } = state;
    let visibleCards = 0;

    sections.forEach((section) => {
      const categoryMatches = !categoryValue || section.dataset.category === categoryValue;
      let visibleInSection = 0;

      const cards = section.querySelectorAll('.knowledge-card');
      cards.forEach((card) => {
        const tags = card.dataset.tags || '';
        const tagMatches = !tagValue || tags.indexOf(`|${tagValue}|`) !== -1;
        const shouldShow = categoryMatches && tagMatches;

        card.classList.toggle('is-hidden', !shouldShow);
        card.hidden = !shouldShow;
        card.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');

        if (!shouldShow) {
          resetPreviewState(card);
        }

        if (shouldShow) {
          visibleCards += 1;
          visibleInSection += 1;
        }
      });

      const hideSection = visibleInSection === 0;
      section.classList.toggle('is-hidden', hideSection);
      section.hidden = hideSection;
      section.setAttribute('aria-hidden', hideSection ? 'true' : 'false');
    });

    if (noResultsMessage) {
      if (visibleCards === 0) {
        noResultsMessage.classList.remove('hidden');
      } else {
        noResultsMessage.classList.add('hidden');
      }
    }
  };

  ready(() => {
    const categorySelect = document.getElementById('category_filter');
    const tagSelect = document.getElementById('tag_filter');
    const sections = Array.from(document.querySelectorAll('.knowledge-section'));
    const noResultsMessage = document.querySelector('.knowledge-no-results');

    const state = {
      categoryValue: categorySelect ? categorySelect.value : '',
      tagValue: tagSelect ? tagSelect.value : '',
      sections,
      noResultsMessage,
    };

    if (categorySelect) {
      categorySelect.addEventListener('change', (event) => {
        state.categoryValue = event.target.value;
        applyFilters(state);
      });
    }

    if (tagSelect) {
      tagSelect.addEventListener('change', (event) => {
        state.tagValue = event.target.value;
        applyFilters(state);
      });
    }

    document.querySelectorAll('.knowledge-preview-btn').forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => togglePreview(button));
    });

    applyFilters(state);
  });

  const updateEmbedStatus = (element, message, variant) => {
    if (!element) return;

    element.textContent = message || '';
    element.classList.remove('is-success', 'is-error', 'is-warning');
    if (variant) {
      element.classList.add(variant);
    }
  };

  ready(() => {
    const embedButton = document.getElementById('embed_all_button');
    const embedStatus = document.getElementById('embed_status');

    if (!embedButton) return;

    embedButton.addEventListener('click', async () => {
      if (embedButton.disabled) return;

      embedButton.disabled = true;
      embedButton.textContent = 'Embedding...';
      updateEmbedStatus(embedStatus, 'Embedding all knowledge entries...', null);

      try {
        const response = await fetch('/chat4/knowledge/embed-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          const message = result && result.error ? result.error : 'Embedding request failed.';
          throw new Error(message);
        }

        const total = result.totalCount ?? 0;
        const embedded = result.embeddedCount ?? 0;
        const failed = result.failedCount ?? 0;
        const failureNote = failed ? ` (${failed} failed)` : '';
        updateEmbedStatus(embedStatus, `Embedded ${embedded}/${total} entries${failureNote}.`, failed ? 'is-warning' : 'is-success');
      } catch (error) {
        updateEmbedStatus(embedStatus, error.message || 'Failed to embed knowledge entries.', 'is-error');
      } finally {
        embedButton.disabled = false;
        embedButton.textContent = 'Re-embed all knowledge';
      }
    });
  });
})();
