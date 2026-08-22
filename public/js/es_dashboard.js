'use strict';

document.addEventListener('DOMContentLoaded', () => {
  setupRestockForm();
  setupCategoryPolicyForm();
});

function setupRestockForm() {
  const form = document.getElementById('add-item-form');
  if (!form) return;

  const categorySelect = form.querySelector('#add_category_id');
  const amountInput = form.querySelector('#amount');
  const labelInput = form.querySelector('#label');
  const actionDateInput = form.querySelector('#actionDate');
  const actionDateLabel = form.querySelector('#actionDateLabel');
  const actionDateHint = form.querySelector('#actionDateHint');
  const verifiedCheckbox = form.querySelector('input[name="verified"]');

  const updateDatePolicy = () => {
    const option = categorySelect?.selectedOptions?.[0];
    const mode = option?.dataset?.mode || 'expiry-managed';
    if (actionDateInput) actionDateInput.required = mode === 'expiry-managed';
    if (actionDateLabel) {
      actionDateLabel.textContent = mode === 'durable'
        ? 'Next inspection date (optional)'
        : 'Expiry or rotation date';
    }
    if (actionDateHint) {
      actionDateHint.textContent = mode === 'rolling'
        ? 'Optional metadata for rolling stock. Undated usable stock still counts.'
        : mode === 'durable'
          ? 'If omitted, the category inspection interval is used.'
          : 'Required. The lot remains counted through this date.';
    }
    if (verifiedCheckbox) {
      verifiedCheckbox.closest('label').hidden = mode !== 'durable';
    }
  };
  categorySelect?.addEventListener('change', updateDatePolicy);
  updateDatePolicy();

  const setOptionValue = (select, value) => {
    if (!select) return;
    if (Array.from(select.options).some(option => option.value === value)) select.value = value;
  };
  const flashForm = () => {
    form.classList.add('es-form--primed');
    window.setTimeout(() => form.classList.remove('es-form--primed'), 1200);
  };

  document.querySelectorAll('.fill-add-item').forEach(button => {
    button.addEventListener('click', () => {
      setOptionValue(categorySelect, button.dataset.category || '');
      if (amountInput) amountInput.value = button.dataset.amount || '';
      if (labelInput) labelInput.value = button.dataset.label || '';
      updateDatePolicy();
      flashForm();
      actionDateInput?.focus();
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

function setupCategoryPolicyForm() {
  const form = document.getElementById('category-policy-form');
  const select = document.getElementById('category_id');
  const categories = Array.isArray(window.ES_CATEGORY_DATA) ? window.ES_CATEGORY_DATA : [];
  if (!form || !select) return;

  const byId = new Map(categories.map(category => [String(category.id || category._id), category]));
  const scalarFields = [
    'name',
    'unit',
    'managementMode',
    'preparednessDomain',
    'recommendedStock',
    'rotationPeriodMonths',
    'officialBaseline',
    'personalTarget',
    'emergencyFloor',
    'reorderPoint',
    'restockToAmount',
    'normalConsumptionRate',
    'consumptionPeriodDays',
    'shoppingLeadDays',
    'packageSize',
    'unitsPerPersonDay',
    'dependentCount',
    'inspectionIntervalMonths',
    'purpose',
    'whyItMatters',
    'qualifies',
    'doesNotQualify',
    'calculationRule',
    'householdNote',
  ];
  const contributionFields = [
    'domainUnits',
    'completeMeals',
    'stapleServings',
    'mainDishServings',
    'produceServings',
    'noCookMeals',
    'waterLitresRequired',
    'fuelMealsRequired',
  ];

  const setValue = (id, value) => {
    const input = form.querySelector(`#${id}`);
    if (!input) return;
    input.value = value === undefined || value === null ? '' : String(value);
  };
  const dateValue = value => value ? String(value).slice(0, 10) : '';

  const clearForm = () => {
    form.reset();
    select.value = '';
    setValue('managementMode', 'rolling');
    setValue('preparednessDomain', 'other');
    setValue('consumptionPeriodDays', 30);
    setValue('shoppingLeadDays', 7);
    setValue('inspectionIntervalMonths', 6);
    setValue('recommendedStock', 0);
    setValue('rotationPeriodMonths', 12);
    const applicable = form.querySelector('#applicable');
    if (applicable) applicable.checked = true;
  };

  select.addEventListener('change', () => {
    const category = byId.get(select.value);
    if (!category) {
      clearForm();
      return;
    }
    scalarFields.forEach(field => setValue(field, category[field]));
    contributionFields.forEach(field => setValue(field, category.contributionPerUnit?.[field] || 0));
    setValue('examples', (category.examples || []).join('\n'));
    setValue('sourceLabel', category.source?.label || '');
    setValue('sourceUrl', category.source?.url || '');
    setValue('sourceLastReviewedAt', dateValue(category.source?.lastReviewedAt));
    setValue('sourceDate', dateValue(category.source?.sourceDate));
    setValue('categoryRecommendationReviewedAt', dateValue(category.recommendationReviewedAt));
    setValue('goalDate', dateValue(category.goalDate));
    const applicable = form.querySelector('#applicable');
    const conditional = form.querySelector('#conditional');
    if (applicable) applicable.checked = category.applicable !== false;
    if (conditional) conditional.checked = Boolean(category.conditional);
  });
}
