'use strict';

(function initializeRunpodAdmin() {
  function initializeGpuPicker(picker) {
    const cloudSelect = picker.querySelector('[data-gpu-cloud]');
    const gpuSelect = picker.querySelector('[data-gpu-select]');
    const countInput = picker.querySelector('[data-gpu-count]');
    const costLimitInput = picker.querySelector('[data-gpu-cost-limit]');
    const minVramInput = picker.querySelector('[data-gpu-min-vram]');
    const maxPriceInput = picker.querySelector('[data-gpu-max-price]');
    const availabilitySelect = picker.querySelector('[data-gpu-min-availability]');
    const dataCenterSelect = picker.querySelector('[data-gpu-datacenter]');
    const estimate = picker.querySelector('[data-gpu-estimate]');
    const result = picker.querySelector('[data-gpu-filter-result]');
    const createForm = picker.querySelector('[data-runpod-create-form]');
    const createButton = picker.querySelector('[data-runpod-create-button]');
    const gpuOptions = Array.from(gpuSelect?.options || []);
    const dataCenterOptions = Array.from(dataCenterSelect?.options || []);
    const rank = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

    function number(value, fallback = Number.NaN) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function cloudKey() {
      return cloudSelect?.value === 'COMMUNITY' ? 'community' : 'secure';
    }

    function optionValues(option) {
      const cloud = cloudKey();
      return {
        price: number(option.dataset[`${cloud}Price`]),
        availability: option.dataset[`${cloud}Availability`] || 'NONE',
        maxCount: number(option.dataset[`${cloud}MaxCount`], 0),
        dataCenters: new Set(
          (option.dataset[`${cloud}Datacenters`] || '').split('|').filter(Boolean)
        ),
        memory: number(option.dataset.memory, 0),
      };
    }

    function currentGpuOption() {
      return gpuOptions.find((option) => option.value === gpuSelect?.value) || null;
    }

    function updateDataCenters(option) {
      const allowed = option ? optionValues(option).dataCenters : new Set();
      dataCenterOptions.forEach((dataCenter, index) => {
        const visible = index === 0 || allowed.has(dataCenter.value);
        dataCenter.hidden = !visible;
        dataCenter.disabled = !visible;
      });
      if (dataCenterSelect?.selectedOptions[0]?.disabled) {
        dataCenterSelect.value = '';
      }
    }

    function updateEstimate() {
      const option = currentGpuOption();
      if (!option) {
        if (estimate) estimate.textContent = 'No matching GPU';
        if (createButton) createButton.disabled = true;
        updateDataCenters(null);
        return;
      }
      const values = optionValues(option);
      const count = Math.max(1, Math.floor(number(countInput?.value, 1)));
      const limit = number(costLimitInput?.value, 0);
      if (countInput) {
        countInput.max = String(Math.max(1, values.maxCount));
        if (count > values.maxCount) countInput.value = String(Math.max(1, values.maxCount));
      }
      const adjustedCount = Math.max(1, Math.floor(number(countInput?.value, 1)));
      const adjustedTotal = values.price * adjustedCount;
      if (estimate) {
        estimate.textContent = Number.isFinite(adjustedTotal)
          ? `$${adjustedTotal.toFixed(4)} / hr for ${adjustedCount} GPU${adjustedCount === 1 ? '' : 's'} · ${values.availability} stock`
          : 'Price unavailable';
      }
      if (createButton) {
        createButton.disabled = !Number.isFinite(adjustedTotal)
          || values.maxCount < 1
          || adjustedTotal > limit;
      }
      updateDataCenters(option);
    }

    function applyFilters() {
      const minimumMemory = Math.max(0, number(minVramInput?.value, 0));
      const maximumPrice = Math.max(0, number(maxPriceInput?.value, Infinity));
      const minimumAvailability = rank[availabilitySelect?.value] || rank.LOW;
      let visibleCount = 0;
      gpuOptions.forEach((option) => {
        const values = optionValues(option);
        const visible = values.memory >= minimumMemory
          && Number.isFinite(values.price)
          && values.price <= maximumPrice
          && (rank[values.availability] || 0) >= minimumAvailability
          && values.maxCount >= 1;
        option.hidden = !visible;
        option.disabled = !visible;
        if (visible) visibleCount += 1;
      });
      if (gpuSelect?.selectedOptions[0]?.disabled) {
        const firstVisible = gpuOptions.find((option) => !option.disabled);
        gpuSelect.value = firstVisible?.value || '';
      }
      if (result) {
        result.textContent = `${visibleCount} GPU system${visibleCount === 1 ? '' : 's'} match`;
      }
      updateEstimate();
    }

    [cloudSelect, minVramInput, maxPriceInput, availabilitySelect]
      .filter(Boolean)
      .forEach((element) => element.addEventListener('input', applyFilters));
    [gpuSelect, countInput, costLimitInput]
      .filter(Boolean)
      .forEach((element) => element.addEventListener('input', updateEstimate));

    createForm?.addEventListener('submit', () => {
      if (createButton) {
        createButton.disabled = true;
        createButton.textContent = 'Creating Pod…';
      }
    });

    applyFilters();
  }

  function initializeDeleteForms() {
    document.querySelectorAll('[data-runpod-delete-form]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        const input = form.querySelector('input[name="confirmation"]');
        const label = form.querySelector('.runpod-field span')?.textContent || '';
        const expected = label.replace(/^Type the exact Pod name:\s*/u, '');
        if (!input || input.value !== expected) {
          event.preventDefault();
          input?.setCustomValidity('Enter the exact Pod name shown above.');
          input?.reportValidity();
        }
      });
    });
  }

  function formatRemaining(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (days) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    if (hours) return `${hours}h ${minutes}m ${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }

  function initializeCountdowns() {
    const countdowns = Array.from(document.querySelectorAll('[data-runpod-countdown]'))
      .map((element) => ({
        element,
        deadline: Date.parse(element.dataset.deadline || ''),
        value: element.querySelector('[data-runpod-countdown-value]'),
        warning: element.querySelector('[data-runpod-countdown-warning]'),
      }))
      .filter((countdown) => Number.isFinite(countdown.deadline) && countdown.value);
    if (!countdowns.length) return;

    function updateCountdowns() {
      const now = Date.now();
      countdowns.forEach((countdown) => {
        const remaining = countdown.deadline - now;
        countdown.value.textContent = remaining <= 0 ? 'Shutdown due now' : formatRemaining(remaining);
        countdown.element.classList.toggle(
          'runpod-countdown--warning',
          remaining > 60_000 && remaining <= 10 * 60_000
        );
        countdown.element.classList.toggle('runpod-countdown--danger', remaining <= 60_000);
        if (!countdown.warning) return;
        if (remaining <= 0) {
          countdown.warning.textContent = 'The deadline has passed and an automatic stop is due. Refresh provider state shortly.';
        } else if (remaining <= 60_000) {
          countdown.warning.textContent = 'Shutdown is imminent. Extend the deadline now to keep working.';
        } else if (remaining <= 10 * 60_000) {
          countdown.warning.textContent = 'Automatic shutdown is approaching. Extend the deadline if work is still in progress.';
        } else {
          countdown.warning.textContent = 'The Pod will stop automatically when this reaches zero. Extend it before the deadline if work is still in progress.';
        }
      });
    }

    updateCountdowns();
    window.setInterval(updateCountdowns, 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateCountdowns();
    });
  }

  const picker = document.querySelector('[data-runpod-picker]');
  if (picker) initializeGpuPicker(picker);
  initializeDeleteForms();
  initializeCountdowns();
}());
