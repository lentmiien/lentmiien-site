(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const suggestionSelect = document.getElementById('publicRewardSuggestion');
    const titleInput = document.getElementById('rewardTitleEn');
    const pointsInput = document.getElementById('rewardPoints');

    if (!suggestionSelect || !titleInput || !pointsInput) {
      return;
    }

    suggestionSelect.addEventListener('change', () => {
      const option = suggestionSelect.selectedOptions && suggestionSelect.selectedOptions.length
        ? suggestionSelect.selectedOptions[0]
        : null;

      if (!option || !option.value) {
        return;
      }

      titleInput.value = option.dataset.titleEn || '';
      pointsInput.value = option.dataset.points || '1';
    });
  });
})();
