'use strict';

// Populate the add-item form when a restock shortcut is clicked.
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('add-item-form');
  if (!form) {
    return;
  }

  const categorySelect = form.querySelector('#add_category_id');
  const amountInput = form.querySelector('#amount');
  const labelInput = form.querySelector('#label');
  const rotateInput = form.querySelector('#rotateDate');
  const buttons = document.querySelectorAll('.fill-add-item');

  if (!buttons.length) {
    return;
  }

  const setOptionValue = (select, value) => {
    if (!select) {
      return;
    }

    const optionExists = Array.from(select.options).some(option => option.value === value);
    if (optionExists) {
      select.value = value;
    }
  };

  const flashForm = () => {
    form.classList.add('es-form--primed');
    window.setTimeout(() => {
      form.classList.remove('es-form--primed');
    }, 1200);
  };

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const categoryId = button.dataset.category || '';
      const amount = button.dataset.amount || '';
      const label = button.dataset.label || '';

      setOptionValue(categorySelect, categoryId);

      if (amountInput) {
        amountInput.value = amount;
      }

      if (labelInput) {
        labelInput.value = label;
      }

      flashForm();
      button.classList.add('is-active');

      window.setTimeout(() => {
        button.classList.remove('is-active');
      }, 800);

      if (rotateInput) {
        rotateInput.focus();
      }
    });
  });
});