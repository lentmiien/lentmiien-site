document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      const message = form.getAttribute('data-confirm') || 'Continue?';
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    });
  });
});
