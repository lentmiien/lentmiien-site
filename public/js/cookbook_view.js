(function () {
  const ready = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };

  const toFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatAmount = (value) => {
    if (!Number.isFinite(value)) return '-';
    const rounded = Math.round(value * 100) / 100;
    if (Math.abs(rounded) < 0.0000001) return '0';
    return rounded.toFixed(2).replace(/\.?0+$/, '');
  };

  const initRatingLabelToggle = () => {
    const ratingLabel = document.getElementById('rating_label');
    const customWrap = document.getElementById('customRatingLabelWrap');
    const customInput = document.getElementById('rating_label_custom');

    if (!ratingLabel || !customWrap || !customInput) {
      return;
    }

    const updateVisibility = () => {
      const showCustom = ratingLabel.value === '__custom__';
      customWrap.classList.toggle('hidden', !showCustom);
      if (!showCustom) {
        customInput.value = '';
      }
    };

    ratingLabel.addEventListener('change', updateVisibility);
    updateVisibility();
  };

  const initPortionScaling = () => {
    const portionsInput = document.getElementById('recipePortionsInput');
    if (!portionsInput) {
      return;
    }

    const basePortions = toFiniteNumber(portionsInput.dataset.basePortions);
    if (basePortions === null || basePortions <= 0) {
      return;
    }

    const amountCells = Array.from(document.querySelectorAll('.scaled-amount-cell'))
      .map((cell) => ({
        cell,
        baseValue: toFiniteNumber(cell.dataset.baseValue),
      }))
      .filter((item) => item.baseValue !== null);

    if (!amountCells.length) {
      return;
    }

    const applyScale = () => {
      const selectedPortions = toFiniteNumber(portionsInput.value);
      const isValidPortions = selectedPortions !== null && selectedPortions > 0;
      const scale = isValidPortions ? selectedPortions / basePortions : 1;

      portionsInput.classList.toggle('is-invalid', !isValidPortions);
      amountCells.forEach(({ cell, baseValue }) => {
        cell.textContent = formatAmount(baseValue * scale);
      });
    };

    portionsInput.addEventListener('input', applyScale);
    portionsInput.addEventListener('change', applyScale);
    applyScale();
  };

  ready(() => {
    initRatingLabelToggle();
    initPortionScaling();
  });
})();
