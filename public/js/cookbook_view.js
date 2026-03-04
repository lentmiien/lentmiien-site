(function () {
  const ready = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };

  ready(() => {
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
  });
})();
