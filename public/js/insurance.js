'use strict';

(() => {
  const control = document.querySelector('[data-select-all]');
  if (!control) return;
  const toggle = control.querySelector('input');
  const invoices = Array.from(document.querySelectorAll('input[form="submit-claims"][name="ids"]'));
  function update() {
    const count = invoices.filter(input => input.checked).length;
    toggle.checked = count === invoices.length;
    toggle.indeterminate = count > 0 && count < invoices.length;
    document.querySelector('#submit-claims button').disabled = count === 0;
  }
  toggle.addEventListener('change', () => {
    for (const input of invoices) input.checked = toggle.checked;
    update();
  });
  for (const input of invoices) input.addEventListener('change', update);
  control.hidden = false;
  update();
})();
