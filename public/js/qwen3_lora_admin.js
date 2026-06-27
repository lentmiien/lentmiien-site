(function () {
  const configEl = document.getElementById('qwen3LoraConfig');
  let config = {};
  try {
    config = configEl ? JSON.parse(configEl.textContent || '{}') : {};
  } catch (error) {
    config = {};
  }

  const endpoints = {
    state: '/admin/qwen3-lora/state',
    upload: '/admin/qwen3-lora/datasets/upload',
    train: '/admin/qwen3-lora/train/jobs',
    generate: '/admin/qwen3-lora/generate',
    compare: '/admin/qwen3-lora/compare',
    modelDownload: '/admin/qwen3-lora/model/download',
    modelUnload: '/admin/qwen3-lora/model/unload',
    container: (action) => `/admin/qwen3-lora/container/${action}`,
    dataset: (datasetId) => `/admin/qwen3-lora/datasets/${encodeURIComponent(datasetId)}`,
    trainingGroupExport: (groupId) => `/admin/qwen3-lora/training-groups/${encodeURIComponent(groupId)}/export.csv`,
    trainingGroupUpload: (groupId) => `/admin/qwen3-lora/training-groups/${encodeURIComponent(groupId)}/upload-dataset`,
  };

  const $ = (id) => document.getElementById(id);
  const selectedCompareTargets = new Set(['__base__']);
  let dashboardState = null;
  let pollTimer = null;

  function create(tag, attrs = {}, children = []) {
    const element = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (key === 'className') {
        element.className = value;
      } else if (key === 'text') {
        element.textContent = String(value);
      } else if (key === 'hidden') {
        element.hidden = Boolean(value);
      } else if (key === 'checked') {
        element.checked = Boolean(value);
      } else if (key === 'disabled') {
        element.disabled = Boolean(value);
      } else if (key === 'value') {
        element.value = String(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        element.setAttribute(key, String(value));
      }
    });

    const childList = Array.isArray(children) ? children : [children];
    childList.forEach((child) => {
      if (child === undefined || child === null) return;
      element.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return element;
  }

  function setText(element, value) {
    if (element) {
      element.textContent = value === undefined || value === null || value === '' ? 'N/A' : String(value);
    }
  }

  function formatDate(value) {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function formatNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString('en-US') : 'N/A';
  }

  function formatDuration(ms) {
    const num = Number(ms);
    if (!Number.isFinite(num)) return 'N/A';
    if (num < 1000) return `${Math.round(num)} ms`;
    return `${(num / 1000).toFixed(num > 10000 ? 1 : 2)} s`;
  }

  function toJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value || '');
    }
  }

  function setAlert(message, type = 'info') {
    const alert = $('qwenLoraAlert');
    if (!alert) return;
    alert.hidden = !message;
    alert.className = `qwen-lora__alert qwen-lora__alert--${type}`;
    alert.textContent = message || '';
  }

  async function requestJson(url, options = {}) {
    const fetchOptions = {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
      },
    };

    if (options.formData) {
      fetchOptions.body = options.formData;
    } else if (options.body !== undefined) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = { error: text };
      }
    }

    if (!response.ok) {
      const error = new Error(data?.error || `Request failed with ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function withButton(button, message, action) {
    if (button) button.disabled = true;
    setAlert(message, 'info');
    try {
      const result = await action();
      return result;
    } catch (error) {
      setAlert(error.message || 'Request failed.', 'error');
      throw error;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function getDatasets() {
    const raw = dashboardState?.datasets;
    if (Array.isArray(raw?.datasets)) return raw.datasets;
    if (Array.isArray(raw)) return raw;
    return [];
  }

  function getJobs() {
    const raw = dashboardState?.jobs;
    if (Array.isArray(raw?.jobs)) return raw.jobs;
    if (Array.isArray(raw)) return raw;
    return [];
  }

  function getAdapters() {
    const raw = dashboardState?.adapters;
    if (Array.isArray(raw?.adapters)) return raw.adapters;
    if (Array.isArray(raw)) return raw;
    return [];
  }

  function adapterName(adapter) {
    return adapter?.adapter_name || adapter?.name || adapter?.metadata?.adapter_name || '';
  }

  function datasetById(datasetId) {
    return getDatasets().find((dataset) => dataset?.dataset_id === datasetId) || null;
  }

  function selectedTrainingGroupId() {
    return $('trainingGroupExportSelect')?.value || '';
  }

  function updateTrainingGroupControls() {
    const groupId = selectedTrainingGroupId();
    const link = $('trainingGroupCsvLink');
    const input = $('trainingGroupDatasetName');
    const button = $('trainingGroupUploadBtn');
    if (link) {
      link.href = groupId ? endpoints.trainingGroupExport(groupId) : '#';
      link.classList.toggle('disabled', !groupId);
      link.setAttribute('aria-disabled', groupId ? 'false' : 'true');
    }
    if (input) {
      input.placeholder = groupId || 'Defaults to group id';
      input.disabled = !groupId;
    }
    if (button) {
      button.disabled = !groupId;
    }
  }

  function statusBadge(status) {
    const normalized = String(status || 'unknown').toLowerCase();
    let className = 'qwen-lora__badge';
    if (['ok', 'succeeded', 'running', 'ready', 'healthy'].includes(normalized)) {
      className += ' qwen-lora__badge--ok';
    } else if (['queued', 'starting', 'stopping', 'interrupted'].includes(normalized)) {
      className += ' qwen-lora__badge--warn';
    } else if (['failed', 'error', 'unhealthy', 'exited'].includes(normalized)) {
      className += ' qwen-lora__badge--error';
    }
    return create('span', { className, text: status || 'unknown' });
  }

  function firstPresent(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
  }

  function inferContainerState(container) {
    if (!container) return 'Unknown';
    const nested = container.container || {};
    return firstPresent(
      container.state,
      container.status,
      container.container_state,
      nested.state,
      nested.status,
      container.running === true ? 'running' : null,
      container.running === false ? 'stopped' : null,
    ) || 'Unknown';
  }

  function renderRuntime() {
    const container = dashboardState?.container || null;
    const health = dashboardState?.health || null;
    const model = dashboardState?.model || null;
    const download = model?.download || health?.download || null;
    const healthLabel = health?.ok === true ? 'OK' : (health?.ok === false ? 'Issue' : 'Unknown');
    const loadedAdapter = firstPresent(model?.loaded_adapter_name, health?.loaded_adapter_name, 'None');

    setText($('containerState'), inferContainerState(container));
    setText($('serviceHealth'), healthLabel);
    setText($('modelDownloadStatus'), download?.status || 'Unknown');
    setText($('loadedAdapter'), loadedAdapter || 'None');
    setText($('runtimeFetched'), dashboardState?.fetchedAt ? `Fetched ${formatDate(dashboardState.fetchedAt)}` : 'Not loaded');
    setText($('runtimeRaw'), toJson({
      container,
      health,
      model,
      limits: dashboardState?.limits || null,
      errors: dashboardState?.errors || {},
    }));

    const errors = Object.entries(dashboardState?.errors || {}).filter((entry) => entry[1]);
    if (errors.length) {
      setAlert(errors.map(([key, value]) => `${key}: ${value}`).join(' | '), 'error');
    }
  }

  function renderDatasetSelect() {
    const select = $('trainDataset');
    if (!select) return;
    const previous = select.value;
    const datasets = getDatasets();
    select.replaceChildren(create('option', {
      value: '',
      text: datasets.length ? 'Select dataset' : 'No datasets found',
    }));
    datasets.forEach((dataset) => {
      const label = `${dataset.name || dataset.dataset_id || 'dataset'} (${formatNumber(dataset.row_count)} rows)`;
      select.appendChild(create('option', {
        value: dataset.dataset_id || '',
        text: label,
      }));
    });
    if (previous && datasets.some((dataset) => dataset.dataset_id === previous)) {
      select.value = previous;
    }
  }

  function makeJsonToggle(label, payload) {
    const wrapper = create('div');
    const pre = create('pre', { className: 'qwen-lora__pre', hidden: true, text: toJson(payload) });
    const button = create('button', {
      type: 'button',
      className: 'btn btn-outline-secondary btn-sm',
      text: label,
      onclick: () => {
        pre.hidden = !pre.hidden;
      },
    });
    wrapper.append(button, pre);
    return wrapper;
  }

  function renderDatasets() {
    const container = $('datasetList');
    const datasets = getDatasets();
    setText($('datasetCount'), `${datasets.length} dataset${datasets.length === 1 ? '' : 's'}`);
    renderDatasetSelect();
    if (!container) return;

    if (!datasets.length) {
      container.replaceChildren(create('p', { className: 'text-muted mb-0', text: 'No uploaded datasets returned.' }));
      return;
    }

    const nodes = datasets.map((dataset) => {
      const datasetId = dataset.dataset_id || '';
      const columns = Array.isArray(dataset.columns) ? dataset.columns.join(', ') : 'N/A';
      const item = create('article', { className: 'qwen-lora__item' });
      const title = create('div', { className: 'qwen-lora__item-title', text: dataset.name || datasetId || 'Dataset' });
      const meta = create('div', {
        className: 'qwen-lora__item-meta',
        text: `${formatNumber(dataset.row_count)} rows | ${columns}`,
      });
      const left = create('div', {}, [
        title,
        meta,
        create('div', { className: 'qwen-lora__item-meta', text: datasetId }),
      ]);
      const actions = create('div', { className: 'qwen-lora__item-actions' }, [
        statusBadge(dataset.format_ready ? 'ready' : 'needs columns'),
        create('button', {
          type: 'button',
          className: 'btn btn-outline-primary btn-sm',
          text: 'Train',
          onclick: () => {
            const select = $('trainDataset');
            if (select) select.value = datasetId;
            const adapterInput = $('adapterName');
            if (adapterInput && !adapterInput.value && dataset.name) {
              adapterInput.value = `${dataset.name}-v1`;
            }
            $('trainingForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        }),
        create('button', {
          type: 'button',
          className: 'btn btn-outline-danger btn-sm',
          text: 'Delete',
          onclick: () => deleteDataset(datasetId),
        }),
      ]);
      item.appendChild(create('div', { className: 'qwen-lora__item-head' }, [left, actions]));
      item.appendChild(makeJsonToggle('Details', dataset));
      return item;
    });

    container.replaceChildren(...nodes);
  }

  function renderJobs() {
    const container = $('jobList');
    const jobs = getJobs();
    setText($('jobCount'), `${jobs.length} job${jobs.length === 1 ? '' : 's'}`);
    if (!container) return;

    if (!jobs.length) {
      container.replaceChildren(create('p', { className: 'text-muted mb-0', text: 'No training jobs returned.' }));
      return;
    }

    const nodes = jobs.map((job) => {
      const jobId = job.job_id || '';
      const progress = job.progress
        ? `${formatNumber(job.progress.global_step)} / ${formatNumber(job.progress.max_steps)} steps`
        : '';
      const item = create('article', { className: 'qwen-lora__item' });
      const left = create('div', {}, [
        create('div', { className: 'qwen-lora__item-title', text: job.adapter_name || job.request?.adapter_name || jobId || 'Training job' }),
        create('div', { className: 'qwen-lora__item-meta', text: jobId }),
        create('div', {
          className: 'qwen-lora__item-meta',
          text: [
            progress,
            job.rows_used !== undefined ? `${formatNumber(job.rows_used)} rows used` : null,
            job.updated_at ? `updated ${formatDate(job.updated_at)}` : null,
          ].filter(Boolean).join(' | ') || 'No progress yet',
        }),
      ]);
      const actions = create('div', { className: 'qwen-lora__item-actions' }, [statusBadge(job.status)]);
      item.appendChild(create('div', { className: 'qwen-lora__item-head' }, [left, actions]));
      if (job.error) {
        item.appendChild(create('div', { className: 'qwen-lora__item-meta text-danger', text: job.error }));
      }
      item.appendChild(makeJsonToggle('Details', job));
      return item;
    });

    container.replaceChildren(...nodes);
  }

  function renderAdapterSelect() {
    const select = $('generateAdapter');
    if (!select) return;
    const previous = select.value;
    const adapters = getAdapters();
    select.replaceChildren(create('option', { value: '', text: 'Base model' }));
    adapters.forEach((adapter) => {
      const name = adapterName(adapter);
      if (!name) return;
      select.appendChild(create('option', { value: name, text: name }));
    });
    if ([...select.options].some((option) => option.value === previous)) {
      select.value = previous;
    }
  }

  function renderCompareTargets() {
    const container = $('compareTargets');
    if (!container) return;
    const adapters = getAdapters();
    const targets = [
      { value: '__base__', label: 'Base model' },
      ...adapters
        .map((adapter) => adapterName(adapter))
        .filter(Boolean)
        .map((name) => ({ value: name, label: name })),
    ];

    const validValues = new Set(targets.map((target) => target.value));
    Array.from(selectedCompareTargets).forEach((value) => {
      if (!validValues.has(value)) {
        selectedCompareTargets.delete(value);
      }
    });

    const nodes = targets.map((target) => {
      const id = `compare-target-${target.value.replace(/[^a-z0-9_-]/gi, '-')}`;
      const checkbox = create('input', {
        id,
        type: 'checkbox',
        className: 'form-check-input compare-target',
        value: target.value,
        checked: selectedCompareTargets.has(target.value),
        onchange: (event) => {
          if (event.target.checked) {
            selectedCompareTargets.add(target.value);
          } else {
            selectedCompareTargets.delete(target.value);
          }
        },
      });
      return create('div', { className: 'qwen-lora__target' }, [
        checkbox,
        create('label', { for: id, text: target.label }),
      ]);
    });

    container.replaceChildren(...nodes);
  }

  function renderAdapters() {
    const container = $('adapterList');
    const adapters = getAdapters();
    setText($('adapterCount'), `${adapters.length} adapter${adapters.length === 1 ? '' : 's'}`);
    renderAdapterSelect();
    renderCompareTargets();
    if (!container) return;

    if (!adapters.length) {
      container.replaceChildren(create('p', { className: 'text-muted mb-0', text: 'No trained adapters returned.' }));
      return;
    }

    const nodes = adapters.map((adapter) => {
      const name = adapterName(adapter);
      const metadata = adapter.metadata || {};
      const item = create('article', { className: 'qwen-lora__item' });
      const left = create('div', {}, [
        create('div', { className: 'qwen-lora__item-title', text: name || 'Adapter' }),
        create('div', {
          className: 'qwen-lora__item-meta',
          text: [
            metadata.dataset_id ? `dataset ${metadata.dataset_id}` : null,
            metadata.rows_used !== undefined ? `${formatNumber(metadata.rows_used)} rows` : null,
            metadata.created_at ? `created ${formatDate(metadata.created_at)}` : null,
          ].filter(Boolean).join(' | ') || adapter.path || 'No metadata',
        }),
      ]);
      const actions = create('div', { className: 'qwen-lora__item-actions' }, [
        create('button', {
          type: 'button',
          className: 'btn btn-outline-primary btn-sm',
          text: 'Use',
          onclick: () => {
            const select = $('generateAdapter');
            if (select) select.value = name;
            $('generateForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          },
        }),
        create('button', {
          type: 'button',
          className: 'btn btn-outline-secondary btn-sm',
          text: selectedCompareTargets.has(name) ? 'Selected' : 'Compare',
          onclick: () => {
            selectedCompareTargets.add(name);
            renderCompareTargets();
            renderAdapters();
          },
        }),
      ]);
      item.appendChild(create('div', { className: 'qwen-lora__item-head' }, [left, actions]));
      item.appendChild(makeJsonToggle('Details', adapter));
      return item;
    });

    container.replaceChildren(...nodes);
  }

  function renderAll() {
    renderRuntime();
    renderDatasets();
    renderJobs();
    renderAdapters();
    scheduleJobPolling();
  }

  async function loadState({ silent = false } = {}) {
    if (!silent) setAlert('Loading Qwen3 LoRA state...', 'info');
    dashboardState = await requestJson(endpoints.state);
    renderAll();
    if (!silent && !Object.keys(dashboardState.errors || {}).length) {
      setAlert('State refreshed.', 'success');
    }
  }

  function scheduleJobPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    const active = getJobs().some((job) => ['queued', 'running'].includes(String(job.status || '').toLowerCase()));
    if (!active) return;
    pollTimer = setTimeout(() => {
      loadState({ silent: true }).catch(() => {
        pollTimer = setTimeout(scheduleJobPolling, 5000);
      });
    }, 5000);
  }

  async function deleteDataset(datasetId) {
    if (!datasetId) return;
    const ok = window.confirm(`Delete dataset ${datasetId}?`);
    if (!ok) return;
    await withButton(null, 'Deleting dataset...', async () => {
      await requestJson(endpoints.dataset(datasetId), { method: 'DELETE' });
      setAlert('Dataset deleted.', 'success');
      await loadState({ silent: true });
    });
  }

  function parseOptionalJson(textareaId, label) {
    const value = $(textareaId)?.value.trim();
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`${label} must be valid JSON.`);
    }
  }

  function numberValue(id) {
    const raw = $(id)?.value;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }

  function selectedDatasetColumns() {
    const dataset = datasetById($('trainDataset')?.value);
    return Array.isArray(dataset?.columns) ? dataset.columns : [];
  }

  function collectTrainingPayload() {
    const datasetId = $('trainDataset')?.value || '';
    const payload = {
      dataset_id: datasetId,
      adapter_name: $('adapterName')?.value.trim() || undefined,
      overwrite_adapter: $('overwriteAdapter')?.checked === true,
      params: {
        num_train_epochs: numberValue('trainEpochs'),
        learning_rate: numberValue('trainLearningRate'),
        per_device_train_batch_size: numberValue('trainBatchSize'),
        gradient_accumulation_steps: numberValue('trainGradAccum'),
        max_seq_length: numberValue('trainMaxSeq'),
        lora_r: numberValue('trainLoraR'),
        lora_alpha: numberValue('trainLoraAlpha'),
        lora_dropout: numberValue('trainLoraDropout'),
        seed: numberValue('trainSeed'),
      },
    };

    const preset = $('columnPreset')?.value || 'auto';
    const columnsAvailable = selectedDatasetColumns();
    if (preset === 'prompt_response') {
      payload.columns = { prompt: 'prompt', response: 'response' };
      if (columnsAvailable.includes('system')) payload.columns.system = 'system';
    } else if (preset === 'instruction_output') {
      payload.columns = { instruction: 'instruction', output: 'output' };
      if (columnsAvailable.includes('input')) payload.columns.input = 'input';
      if (columnsAvailable.includes('system')) payload.columns.system = 'system';
    } else if (preset === 'messages') {
      payload.columns = { messages: 'messages' };
    } else if (preset === 'custom') {
      payload.columns = parseOptionalJson('columnJson', 'columns');
    }

    Object.keys(payload.params).forEach((key) => {
      if (payload.params[key] === undefined) delete payload.params[key];
    });
    if (!Object.keys(payload.params).length) delete payload.params;
    if (!payload.adapter_name) delete payload.adapter_name;
    if (!payload.columns) delete payload.columns;
    return payload;
  }

  function collectGenerationPayload(prefix, includeAdapter) {
    const prompt = $(`${prefix}Prompt`)?.value.trim() || '';
    if (!prompt) {
      throw new Error('Enter a prompt first.');
    }
    const payload = {
      prompt,
      system: $(`${prefix}System`)?.value.trim() || undefined,
      max_new_tokens: numberValue(`${prefix}MaxTokens`),
      temperature: numberValue(`${prefix}Temperature`),
    };

    if (includeAdapter) {
      const adapter = $('generateAdapter')?.value || '';
      if (adapter) payload.adapter_name = adapter;
    }

    if (prefix === 'generate') {
      payload.top_p = numberValue('generateTopP');
      payload.top_k = numberValue('generateTopK');
      payload.repetition_penalty = numberValue('generateRepetitionPenalty');
      const tools = parseOptionalJson('generateTools', 'tools');
      if (tools !== undefined) payload.tools = tools;
      const responseFormat = parseOptionalJson('generateResponseFormat', 'response_format');
      if (responseFormat !== undefined) payload.response_format = responseFormat;
    }

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === '') delete payload[key];
    });
    return payload;
  }

  function renderGenerateResult(result) {
    const container = $('generateResult');
    if (!container) return;
    const content = firstPresent(result?.content, result?.raw_content, '');
    const usage = result?.usage
      ? `prompt ${formatNumber(result.usage.prompt_tokens)} | completion ${formatNumber(result.usage.completion_tokens)} | total ${formatNumber(result.usage.total_tokens)}`
      : '';
    const card = create('div', { className: 'qwen-lora__response-card' }, [
      create('div', { className: 'qwen-lora__response-head' }, [
        create('strong', { text: result?.adapter_name || 'Base model' }),
        usage ? create('span', { className: 'qwen-lora__badge', text: usage }) : null,
      ]),
      create('div', { className: 'qwen-lora__response-content', text: content || '(empty response)' }),
    ]);
    if (Array.isArray(result?.tool_calls) && result.tool_calls.length) {
      card.appendChild(create('pre', { className: 'qwen-lora__pre', text: toJson(result.tool_calls) }));
    }
    card.appendChild(makeJsonToggle('Raw response', result));
    container.replaceChildren(card);
  }

  function renderCompareResults(result) {
    const container = $('compareResult');
    if (!container) return;
    const nodes = (result?.results || []).map((entry) => {
      const content = entry.ok
        ? firstPresent(entry.data?.content, entry.data?.raw_content, '(empty response)')
        : entry.error || 'Generation failed.';
      const card = create('article', { className: 'qwen-lora__response-card' }, [
        create('div', { className: 'qwen-lora__response-head' }, [
          create('strong', { text: entry.label || entry.adapter_name || 'Base model' }),
          statusBadge(entry.ok ? formatDuration(entry.duration_ms) : 'failed'),
        ]),
        create('div', {
          className: `qwen-lora__response-content${entry.ok ? '' : ' text-danger'}`,
          text: content,
        }),
      ]);
      if (entry.ok && Array.isArray(entry.data?.tool_calls) && entry.data.tool_calls.length) {
        card.appendChild(create('pre', { className: 'qwen-lora__pre', text: toJson(entry.data.tool_calls) }));
      }
      card.appendChild(makeJsonToggle('Raw response', entry));
      return card;
    });
    container.replaceChildren(...(nodes.length ? nodes : [create('p', { className: 'text-muted mb-0', text: 'No comparison results returned.' })]));
  }

  function bindEvents() {
    $('refreshStateBtn')?.addEventListener('click', (event) => {
      withButton(event.currentTarget, 'Refreshing state...', () => loadState());
    });

    ['start', 'restart', 'stop'].forEach((action) => {
      const button = $(`container${action[0].toUpperCase()}${action.slice(1)}Btn`);
      button?.addEventListener('click', (event) => {
        withButton(event.currentTarget, `${action} container...`, async () => {
          await requestJson(endpoints.container(action), {
            method: 'POST',
            body: { wait: $('containerWaitToggle')?.checked === true },
          });
          setAlert(`Container ${action} request completed.`, 'success');
          await loadState({ silent: true });
        });
      });
    });

    $('modelDownloadBtn')?.addEventListener('click', (event) => {
      withButton(event.currentTarget, 'Verifying model cache...', async () => {
        const result = await requestJson(endpoints.modelDownload, { method: 'POST', body: {} });
        setAlert(`Model cache status: ${result?.status || 'updated'}.`, 'success');
        await loadState({ silent: true });
      });
    });

    $('modelUnloadBtn')?.addEventListener('click', (event) => {
      withButton(event.currentTarget, 'Unloading model...', async () => {
        await requestJson(endpoints.modelUnload, { method: 'POST', body: {} });
        setAlert('Model unloaded.', 'success');
        await loadState({ silent: true });
      });
    });

    $('datasetUploadForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      withButton(button, 'Uploading dataset...', async () => {
        const formData = new FormData(form);
        const result = await requestJson(endpoints.upload, { method: 'POST', formData });
        $('uploadResult')?.replaceChildren(makeJsonToggle('Upload response', result));
        setAlert(`Uploaded ${result?.name || result?.dataset_id || 'dataset'}.`, 'success');
        form.reset();
        await loadState({ silent: true });
      });
    });

    $('trainingGroupExportSelect')?.addEventListener('change', updateTrainingGroupControls);

    $('trainingGroupUploadBtn')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      withButton(button, 'Uploading training group dataset...', async () => {
        const groupId = selectedTrainingGroupId();
        if (!groupId) {
          throw new Error('Select a training group first.');
        }
        const name = $('trainingGroupDatasetName')?.value.trim() || groupId;
        const result = await requestJson(endpoints.trainingGroupUpload(groupId), {
          method: 'POST',
          body: { name },
        });
        $('trainingGroupExportResult')?.replaceChildren(makeJsonToggle('Upload response', result));
        setAlert(`Uploaded ${result?.name || result?.dataset_id || groupId}.`, 'success');
        await loadState({ silent: true });
      });
    });

    $('columnPreset')?.addEventListener('change', () => {
      const textarea = $('columnJson');
      if (textarea) textarea.hidden = $('columnPreset')?.value !== 'custom';
    });

    $('trainingForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      withButton(button, 'Starting training job...', async () => {
        const payload = collectTrainingPayload();
        const result = await requestJson(endpoints.train, { method: 'POST', body: payload });
        $('trainResult')?.replaceChildren(makeJsonToggle('Training response', result));
        setAlert(`Training job ${result?.job_id || ''} queued.`.trim(), 'success');
        await loadState({ silent: true });
      });
    });

    $('generateForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      withButton(button, 'Generating...', async () => {
        const payload = collectGenerationPayload('generate', true);
        const result = await requestJson(endpoints.generate, { method: 'POST', body: payload });
        renderGenerateResult(result);
        setAlert('Generation completed.', 'success');
        await loadState({ silent: true });
      });
    });

    $('compareForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      withButton(button, 'Running comparison...', async () => {
        const targets = Array.from(selectedCompareTargets).map((value) => ({
          adapter_name: value === '__base__' ? null : value,
          label: value === '__base__' ? 'Base model' : value,
        }));
        if (!targets.length) {
          throw new Error('Select at least one target.');
        }
        if (targets.length > Number(config.maxCompareTargets || 8)) {
          throw new Error(`Select ${config.maxCompareTargets || 8} targets or fewer.`);
        }
        const payload = {
          ...collectGenerationPayload('compare', false),
          targets,
        };
        const result = await requestJson(endpoints.compare, { method: 'POST', body: payload });
        renderCompareResults(result);
        setAlert('Comparison completed.', 'success');
        await loadState({ silent: true });
      });
    });
  }

  bindEvents();
  updateTrainingGroupControls();
  loadState().catch((error) => {
    setAlert(error.message || 'Unable to load Qwen3 LoRA state.', 'error');
  });
})();
