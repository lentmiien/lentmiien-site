'use strict';

(() => {
  const form = document.getElementById('csvDiffForm');
  if (!form) {
    return;
  }

  const textareas = {
    a: document.getElementById('a'),
    b: document.getElementById('b'),
  };
  const fileInputs = {
    a: document.querySelector('[data-file-input="a"]'),
    b: document.querySelector('[data-file-input="b"]'),
  };
  const delimiterInputs = {
    a: document.querySelector('[data-delimiter="a"]'),
    b: document.querySelector('[data-delimiter="b"]'),
  };

  function resetFile(side) {
    const fileInput = fileInputs[side];
    const status = document.querySelector(`[data-file-status="${side}"]`);
    const clearButton = document.querySelector(`[data-clear-file="${side}"]`);
    if (fileInput) {
      fileInput.value = '';
    }
    if (status) {
      status.textContent = 'A selected file takes precedence over pasted text.';
    }
    if (clearButton) {
      clearButton.hidden = true;
    }
  }

  Object.entries(fileInputs).forEach(([side, fileInput]) => {
    if (!fileInput) {
      return;
    }
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      const status = document.querySelector(`[data-file-status="${side}"]`);
      const clearButton = document.querySelector(`[data-clear-file="${side}"]`);
      if (!file) {
        resetFile(side);
        return;
      }

      if (status) {
        status.textContent = `${file.name} will be compared exactly (${file.size.toLocaleString()} bytes).`;
      }
      if (clearButton) {
        clearButton.hidden = false;
      }

      try {
        textareas[side].value = await file.text();
      } catch {
        if (status) {
          status.textContent = `${file.name} is selected; a text preview could not be loaded.`;
        }
      }
    });
  });

  document.querySelectorAll('[data-clear-file]').forEach((button) => {
    button.addEventListener('click', () => resetFile(button.dataset.clearFile));
  });

  document.querySelector('[data-load-example]')?.addEventListener('click', () => {
    textareas.a.value = [
      'record,version,item_1,item_2,item_3,status',
      'A,1,red,green,blue,ready',
      'B,1,one,two,three,done',
    ].join('\n');
    textareas.b.value = [
      'record,version,status',
      'A,2,ready',
      'B,1,done',
    ].join('\n');
    delimiterInputs.a.value = 'auto';
    delimiterInputs.b.value = 'auto';
    resetFile('a');
    resetFile('b');
    textareas.a.focus();
  });

  document.querySelector('[data-swap-inputs]')?.addEventListener('click', () => {
    [textareas.a.value, textareas.b.value] = [textareas.b.value, textareas.a.value];
    [delimiterInputs.a.value, delimiterInputs.b.value] = [delimiterInputs.b.value, delimiterInputs.a.value];
    resetFile('a');
    resetFile('b');
  });

  const filterInputs = Array.from(document.querySelectorAll('[data-filter-kind]'));
  const resultRows = Array.from(document.querySelectorAll('.csv-change'));
  const searchInput = document.querySelector('[data-results-search]');
  const noFilteredResults = document.getElementById('csvNoFilteredResults');

  function applyResultFilters() {
    if (resultRows.length === 0) {
      return;
    }
    const enabledKinds = new Set(
      filterInputs.filter((input) => input.checked).map((input) => input.dataset.filterKind)
    );
    const query = (searchInput?.value || '').trim().toLocaleLowerCase();
    let visibleCount = 0;

    resultRows.forEach((row) => {
      const kindMatches = enabledKinds.has(row.dataset.kind);
      const textMatches = !query || row.textContent.toLocaleLowerCase().includes(query);
      row.hidden = !(kindMatches && textMatches);
      if (!row.hidden) {
        visibleCount += 1;
      }
    });

    if (noFilteredResults) {
      noFilteredResults.hidden = visibleCount > 0;
    }
  }

  filterInputs.forEach((input) => input.addEventListener('change', applyResultFilters));
  searchInput?.addEventListener('input', applyResultFilters);
  applyResultFilters();

  form.addEventListener('submit', () => {
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Comparing…';
    }
  });
})();
