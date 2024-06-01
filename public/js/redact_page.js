document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.redact-item').forEach(item => {
    item.addEventListener('click', () => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      const isSelected = checkbox.checked;

      checkbox.checked = !isSelected;
      item.classList.toggle('selected', !isSelected);
    });
  });
});
