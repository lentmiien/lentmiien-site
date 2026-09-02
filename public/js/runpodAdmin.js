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
    const networkVolumeSelect = picker.querySelector('[data-network-volume-select]');
    const persistentDiskInput = picker.querySelector('[data-persistent-disk]');
    const storageHelp = picker.querySelector('[data-storage-help]');
    const modelInput = picker.querySelector('[data-ollama-model-input]');
    const cachedModelList = picker.querySelector('[data-cached-model-list]');
    const estimate = picker.querySelector('[data-gpu-estimate]');
    const result = picker.querySelector('[data-gpu-filter-result]');
    const createForm = picker.querySelector('[data-runpod-create-form]');
    const createButton = picker.querySelector('[data-runpod-create-button]');
    const templateSelect = picker.querySelector('[data-runpod-template-select]');
    const publicAccessAcknowledgement = picker.querySelector('[data-runpod-public-ack]');
    const publicAccessCheckbox = publicAccessAcknowledgement?.querySelector(
      'input[name="publicAccessAcknowledged"]'
    );
    const accessSummary = picker.querySelector('[data-runpod-access-summary]');
    const gpuOptions = Array.from(gpuSelect?.options || []);
    const dataCenterOptions = Array.from(dataCenterSelect?.options || []);
    const communityOption = Array.from(cloudSelect?.options || [])
      .find((option) => option.value === 'COMMUNITY');
    const rank = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
    let cachedModelVolumeId = null;

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

    function currentNetworkVolume() {
      const option = networkVolumeSelect?.selectedOptions?.[0];
      return option?.value ? {
        id: option.value,
        dataCenter: option.dataset.datacenter || '',
        type: option.dataset.volumeType || 'UNKNOWN',
        size: number(option.dataset.size, 0),
        models: (option.dataset.models || '').split('|').filter(Boolean),
      } : null;
    }

    function applyAccessMode() {
      const selected = templateSelect?.selectedOptions?.[0];
      const accessMode = selected?.dataset.accessMode || 'runpod_proxy';
      const gatewayUrl = selected?.dataset.gatewayUrl || '';
      const usesCloudflare = accessMode === 'cloudflare_access';
      if (publicAccessAcknowledgement) publicAccessAcknowledgement.hidden = usesCloudflare;
      if (publicAccessCheckbox) {
        publicAccessCheckbox.disabled = usesCloudflare;
        publicAccessCheckbox.required = !usesCloudflare;
        if (usesCloudflare) publicAccessCheckbox.checked = false;
      }
      if (accessSummary) {
        accessSummary.textContent = usesCloudflare
          ? `Stable authenticated URL: ${gatewayUrl}. Open WebUI and API clients must send the Cloudflare Access service-token headers.`
          : 'Diagnostic public Runpod proxy selected. Its hostname changes with every replacement Pod.';
      }
    }

    function updateCachedModels(volume) {
      if (cachedModelList) {
        cachedModelList.replaceChildren(...(volume?.models || []).map((model) => {
          const option = document.createElement('option');
          option.value = model;
          return option;
        }));
      }
      const nextVolumeId = volume?.id || '';
      if (
        nextVolumeId !== cachedModelVolumeId
        && volume?.models?.length
        && modelInput
      ) {
        modelInput.value = volume.models[0];
      }
      cachedModelVolumeId = nextVolumeId;
    }

    function applyStorageMode() {
      const volume = currentNetworkVolume();
      if (volume) {
        updateCachedModels(volume);
        if (cloudSelect) cloudSelect.value = 'SECURE';
        if (communityOption) communityOption.disabled = true;
        if (persistentDiskInput) {
          persistentDiskInput.disabled = true;
          persistentDiskInput.required = false;
        }
        if (storageHelp) {
          storageHelp.textContent = `${volume.size} GB ${volume.type.replaceAll('_', ' ')} network volume selected. Secure Cloud and ${volume.dataCenter} are required; Ollama models will use /workspace/ollama/models.`;
        }
      } else {
        updateCachedModels(null);
        if (communityOption) communityOption.disabled = false;
        if (persistentDiskInput) {
          persistentDiskInput.disabled = false;
          persistentDiskInput.required = true;
        }
        if (storageHelp) {
          storageHelp.textContent = 'Large models need storage beyond their published download size. Allow at least 10 GB of headroom; qwen3.8:27b is about 18 GB, so use 30 GB or more. A selected network volume replaces the Pod-local persistent disk and fixes the cloud and data center.';
        }
      }
      return volume;
    }

    function updateDataCenters(option) {
      const allowed = option ? optionValues(option).dataCenters : new Set();
      const volume = currentNetworkVolume();
      dataCenterOptions.forEach((dataCenter, index) => {
        const visible = volume
          ? dataCenter.value === volume.dataCenter && allowed.has(dataCenter.value)
          : index === 0 || allowed.has(dataCenter.value);
        dataCenter.hidden = !visible;
        dataCenter.disabled = !visible;
      });
      if (volume && dataCenterSelect) {
        dataCenterSelect.value = volume.dataCenter;
      } else if (dataCenterSelect?.selectedOptions[0]?.disabled) {
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
      const volume = applyStorageMode();
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
          && values.maxCount >= 1
          && (!volume || values.dataCenters.has(volume.dataCenter));
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
    networkVolumeSelect?.addEventListener('input', applyFilters);
    templateSelect?.addEventListener('input', applyAccessMode);

    createForm?.addEventListener('submit', () => {
      if (createButton) {
        createButton.disabled = true;
        createButton.textContent = 'Creating Pod…';
      }
    });

    applyAccessMode();
    applyFilters();
  }

  function initializeModelDownloader() {
    const form = document.querySelector('[data-runpod-model-download-form]');
    if (!form) return;
    const volumeSelect = form.querySelector('[data-download-volume-select]');
    const gpuSelect = form.querySelector('[data-download-gpu-select]');
    const costLimitInput = form.querySelector('[data-download-cost-limit]');
    const location = form.querySelector('[data-download-location]');
    const summary = form.querySelector('[data-download-gpu-summary]');
    const submit = form.querySelector('[data-runpod-download-button]');
    const gpuOptions = Array.from(gpuSelect?.options || []).filter((option) => option.value);
    const stockRank = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };

    function update() {
      const volume = volumeSelect?.selectedOptions?.[0];
      const dataCenter = volume?.dataset.datacenter || '';
      const limit = Number(costLimitInput?.value);
      const candidates = gpuOptions.filter((option) => {
        const price = Number(option.dataset.price);
        const available = (option.dataset.datacenters || '').split('|').includes(dataCenter)
          && ['LOW', 'MEDIUM', 'HIGH'].includes(option.dataset.availability || 'NONE')
          && Number.isFinite(price)
          && Number.isFinite(limit)
          && price <= limit;
        option.hidden = !available;
        option.disabled = !available;
        return available;
      }).sort((left, right) => (
        Number(left.dataset.price) - Number(right.dataset.price)
        || (stockRank[left.dataset.availability] ?? 3)
          - (stockRank[right.dataset.availability] ?? 3)
      ));
      if (gpuSelect?.value && gpuSelect.selectedOptions[0]?.disabled) gpuSelect.value = '';
      if (location) {
        location.textContent = dataCenter ? `Secure Cloud · ${dataCenter}` : 'Choose a volume';
      }
      if (summary) {
        if (!candidates.length) {
          summary.textContent = 'No compatible Secure Cloud GPU is currently below this cost limit.';
        } else if (gpuSelect?.value) {
          const selected = gpuSelect.selectedOptions[0];
          summary.textContent = `${selected.textContent.trim()} will be requested. Fresh stock is checked again on submit.`;
        } else {
          const cheapest = candidates[0];
          summary.textContent = `Automatic choice currently favors ${cheapest.textContent.trim()}. Fresh stock is checked again on submit.`;
        }
      }
      if (submit) submit.disabled = !dataCenter || !candidates.length;
    }

    [volumeSelect, gpuSelect, costLimitInput]
      .filter(Boolean)
      .forEach((element) => element.addEventListener('input', update));
    form.addEventListener('submit', () => {
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Starting download…';
      }
    });
    update();
  }

  function initializeModelArtifactPreparer() {
    const form = document.querySelector('[data-runpod-artifact-preparer-form]');
    if (!form) return;
    const volumeSelect = form.querySelector('[data-artifact-volume-select]');
    const gpuSelect = form.querySelector('[data-artifact-gpu-select]');
    const costLimitInput = form.querySelector('[data-artifact-cost-limit]');
    const location = form.querySelector('[data-artifact-location]');
    const summary = form.querySelector('[data-artifact-gpu-summary]');
    const submit = form.querySelector('[data-runpod-artifact-button]');
    const gpuOptions = Array.from(gpuSelect?.options || []).filter((option) => option.value);
    const stockRank = { HIGH: 0, MEDIUM: 1, LOW: 2, NONE: 3 };

    function update() {
      const volume = volumeSelect?.selectedOptions?.[0];
      const dataCenter = volume?.dataset.datacenter || '';
      const artifactStatus = volume?.dataset.artifactStatus || 'not_prepared';
      const limit = Number(costLimitInput?.value);
      const candidates = gpuOptions.filter((option) => {
        const price = Number(option.dataset.price);
        const available = (option.dataset.datacenters || '').split('|').includes(dataCenter)
          && ['LOW', 'MEDIUM', 'HIGH'].includes(option.dataset.availability || 'NONE')
          && Number.isFinite(price)
          && Number.isFinite(limit)
          && price <= limit
          && price <= 1;
        option.hidden = !available;
        option.disabled = !available;
        return available;
      }).sort((left, right) => (
        Number(left.dataset.price) - Number(right.dataset.price)
        || (stockRank[left.dataset.availability] ?? 3)
          - (stockRank[right.dataset.availability] ?? 3)
      ));
      if (gpuSelect?.value && gpuSelect.selectedOptions[0]?.disabled) gpuSelect.value = '';
      if (location) {
        location.textContent = dataCenter ? `Secure Cloud · ${dataCenter}` : 'Choose a volume';
      }
      if (summary) {
        if (artifactStatus === 'ready') {
          summary.textContent = 'This exact artifact is already verified on the selected volume.';
        } else if (artifactStatus === 'preparing') {
          summary.textContent = 'This exact artifact is already being prepared on the selected volume.';
        } else if (!candidates.length) {
          summary.textContent = 'No compatible Secure Cloud preparation GPU is currently below this cost limit.';
        } else if (gpuSelect?.value) {
          summary.textContent = `${gpuSelect.selectedOptions[0].textContent.trim()} will be requested. Fresh stock is checked again on submit.`;
        } else {
          summary.textContent = `Automatic choice currently favors ${candidates[0].textContent.trim()}. Fresh stock is checked again on submit.`;
        }
      }
      if (submit) {
        submit.disabled = !dataCenter
          || ['ready', 'preparing'].includes(artifactStatus);
      }
    }

    [volumeSelect, gpuSelect, costLimitInput]
      .filter(Boolean)
      .forEach((element) => element.addEventListener('input', update));
    form.addEventListener('submit', () => {
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Starting verification…';
      }
    });
    update();
  }

  function initializeNetworkVolumeCreator() {
    const form = document.querySelector('[data-runpod-volume-create-form]');
    if (!form) return;
    const sizeInput = form.querySelector('[data-volume-size]');
    const typeSelect = form.querySelector('[data-volume-type]');
    const dataCenterSelect = form.querySelector('[data-volume-datacenter]');
    const costLimitInput = form.querySelector('[data-volume-cost-limit]');
    const estimate = form.querySelector('[data-volume-estimate]');
    const submit = form.querySelector('[data-volume-create-button]');
    const dataCenterOptions = Array.from(dataCenterSelect?.options || []);
    const standardRate = Number(form.dataset.standardRate);
    const highPerformanceRate = Number(form.dataset.highPerformanceRate);

    function monthlyCost(size, type) {
      if (type === 'STANDARD' && Number.isFinite(standardRate)) {
        return Math.min(size, 1024) * standardRate + Math.max(0, size - 1024) * 0.05;
      }
      if (type === 'HIGH_PERFORMANCE' && Number.isFinite(highPerformanceRate)) {
        return size * highPerformanceRate;
      }
      return Number.NaN;
    }

    function updateDataCenters() {
      const type = typeSelect?.value || 'STANDARD';
      dataCenterOptions.forEach((option, index) => {
        const supported = index === 0 || (option.dataset.volumeTypes || '').split('|').includes(type);
        option.hidden = !supported;
        option.disabled = !supported || index === 0;
      });
      if (dataCenterSelect?.selectedOptions[0]?.disabled) dataCenterSelect.value = '';
    }

    function updateEstimate() {
      updateDataCenters();
      const size = Number(sizeInput?.value);
      const limit = Number(costLimitInput?.value);
      const cost = monthlyCost(size, typeSelect?.value || 'STANDARD');
      if (estimate) {
        estimate.textContent = Number.isFinite(cost)
          ? `$${cost.toFixed(2)} / month estimated`
          : 'Current storage rate is not configured';
      }
      if (submit) {
        submit.disabled = !Number.isFinite(cost)
          || !Number.isFinite(limit)
          || cost > limit
          || !dataCenterSelect?.value;
      }
    }

    [sizeInput, typeSelect, dataCenterSelect, costLimitInput]
      .filter(Boolean)
      .forEach((element) => element.addEventListener('input', updateEstimate));
    form.addEventListener('submit', () => {
      if (submit) {
        submit.disabled = true;
        submit.textContent = 'Creating volume…';
      }
    });
    updateEstimate();
  }

  function initializeDeleteForms() {
    document.querySelectorAll('[data-runpod-delete-form]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        const input = form.querySelector('input[name="confirmation"]');
        const expected = form.dataset.runpodConfirmName || '';
        if (!input || input.value !== expected) {
          event.preventDefault();
          input?.setCustomValidity('Enter the exact resource name shown above.');
          input?.reportValidity();
        } else {
          input.setCustomValidity('');
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
  initializeModelDownloader();
  initializeModelArtifactPreparer();
  initializeNetworkVolumeCreator();
  initializeDeleteForms();
  initializeCountdowns();
}());
