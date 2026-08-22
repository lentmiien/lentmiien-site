'use strict';

document.addEventListener('DOMContentLoaded', () => {
  setupRestockForm();
  setupCategoryPolicyForm();
  setupUnitConversionForm();
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
  const foodContributionSubform = form.querySelector('#food-contribution-subform');

  const updateDatePolicy = () => {
    const option = categorySelect?.selectedOptions?.[0];
    const mode = option?.dataset?.mode || 'expiry-managed';
    const domain = option?.dataset?.domain || 'other';
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
    if (foodContributionSubform) {
      foodContributionSubform.hidden = domain !== 'food';
      if (domain !== 'food') foodContributionSubform.open = false;
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
    'targetStrategy',
    'applicabilityStatus',
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
  const conditionalInput = form.querySelector('#conditional');
  const applicabilityInput = form.querySelector('#applicabilityStatus');

  const clearForm = () => {
    form.reset();
    select.value = '';
    setValue('managementMode', 'rolling');
    setValue('preparednessDomain', 'other');
    setValue('targetStrategy', 'duration-scaled');
    setValue('applicabilityStatus', 'applicable');
    setValue('consumptionPeriodDays', 30);
    setValue('shoppingLeadDays', 7);
    setValue('inspectionIntervalMonths', 6);
    setValue('recommendedStock', 0);
    setValue('rotationPeriodMonths', 12);
    const unit = form.querySelector('#unit');
    if (unit) unit.readOnly = false;
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
    const conditional = form.querySelector('#conditional');
    if (conditional) conditional.checked = Boolean(category.conditional);
    const unit = form.querySelector('#unit');
    if (unit) unit.readOnly = true;
  });
  conditionalInput?.addEventListener('change', () => {
    if (!select.value && conditionalInput.checked && applicabilityInput?.value === 'applicable') {
      applicabilityInput.value = 'undecided';
    }
  });
}

function setupUnitConversionForm() {
  const form = document.getElementById('unit-conversion-form');
  if (!form) return;
  const category = form.querySelector('#conversionCategoryId');
  const currentUnit = form.querySelector('#currentUnit');
  const newUnit = form.querySelector('#newUnit');
  const factor = form.querySelector('#conversionFactor');
  const preview = form.querySelector('#conversionPreview');
  const units = new Map([
    ['ml', { dimension: 'volume', base: 0.001 }],
    ['milliliter', { dimension: 'volume', base: 0.001 }],
    ['milliliters', { dimension: 'volume', base: 0.001 }],
    ['millilitre', { dimension: 'volume', base: 0.001 }],
    ['millilitres', { dimension: 'volume', base: 0.001 }],
    ['cl', { dimension: 'volume', base: 0.01 }],
    ['dl', { dimension: 'volume', base: 0.1 }],
    ['l', { dimension: 'volume', base: 1 }],
    ['liter', { dimension: 'volume', base: 1 }],
    ['liters', { dimension: 'volume', base: 1 }],
    ['litre', { dimension: 'volume', base: 1 }],
    ['litres', { dimension: 'volume', base: 1 }],
    ['g', { dimension: 'mass', base: 0.001 }],
    ['gram', { dimension: 'mass', base: 0.001 }],
    ['grams', { dimension: 'mass', base: 0.001 }],
    ['kg', { dimension: 'mass', base: 1 }],
    ['kilogram', { dimension: 'mass', base: 1 }],
    ['kilograms', { dimension: 'mass', base: 1 }],
  ]);
  const key = value => String(value || '').trim().toLowerCase().replace(/[.\s_-]+/g, '');

  const updateCurrentUnit = () => {
    const value = category?.selectedOptions?.[0]?.dataset?.unit || '';
    if (currentUnit) currentUnit.value = value;
    updatePreview();
  };
  const updatePreview = () => {
    if (!preview || !currentUnit || !newUnit || !factor) return;
    const from = units.get(key(currentUnit.value));
    const to = units.get(key(newUnit.value));
    if (!newUnit.value.trim()) {
      preview.textContent = 'Known metric conversions such as mL → L and g → kg are calculated and validated automatically.';
      factor.disabled = false;
      return;
    }
    if (key(currentUnit.value) === key(newUnit.value)) {
      preview.textContent = 'Only the unit spelling will change; stored quantities stay the same.';
      factor.value = '';
      factor.disabled = true;
      return;
    }
    if (from && to && from.dimension === to.dimension) {
      const automaticFactor = from.base / to.base;
      preview.textContent = `Every stored quantity will be multiplied by ${automaticFactor}; per-unit contributions will be divided by ${automaticFactor}.`;
      factor.value = '';
      factor.disabled = true;
      return;
    }
    if (from && to && from.dimension !== to.dimension) {
      preview.textContent = 'These known units measure different things and cannot be converted.';
      factor.value = '';
      factor.disabled = true;
      return;
    }
    preview.textContent = 'Unknown conversion: enter the factor where new amount = old amount × factor.';
    factor.disabled = false;
  };

  category?.addEventListener('change', updateCurrentUnit);
  newUnit?.addEventListener('input', updatePreview);
  form.addEventListener('submit', event => {
    const message = `Convert every ${currentUnit.value} quantity in this category to ${newUnit.value.trim()}?`;
    if (!window.confirm(message)) event.preventDefault();
  });
  updateCurrentUnit();
}
