(function () {
  const configEl = document.getElementById('qwenUserConfig');
  let config = {};
  try {
    config = configEl ? JSON.parse(configEl.textContent || '{}') : {};
  } catch {
    config = {};
  }

  const endpoints = {
    state: '/qwen3-lora/state',
    generate: '/qwen3-lora/generate',
  };

  const $ = (id) => document.getElementById(id);
  let toolState = null;
  let busy = false;

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

  function toJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value || '');
    }
  }

  function formatDate(value) {
    if (!value) return 'Not loaded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return `Fetched ${date.toLocaleString()}`;
  }

  function formatNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString('en-US') : 'N/A';
  }

  function setAlert(message, type = 'info') {
    const alert = $('qwenAlert');
    if (!alert) return;
    alert.hidden = !message;
    alert.className = `qwen-user__alert qwen-user__alert--${type}`;
    alert.textContent = message || '';
  }

  function setBadge(text, type = 'warn') {
    const badge = $('qwenServiceBadge');
    if (!badge) return;
    badge.textContent = text;
    badge.className = `qwen-user__badge qwen-user__badge--${type}`;
  }

  async function requestJson(url, options = {}) {
    const fetchOptions = {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
      },
    };

    if (options.body !== undefined) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
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

  function adapterName(adapter) {
    return adapter?.adapter_name || adapter?.name || adapter?.metadata?.adapter_name || '';
  }

  function renderTargetOptions() {
    const select = $('qwenTarget');
    if (!select) return;
    const previous = select.value;
    const adapters = Array.isArray(toolState?.adapters) ? toolState.adapters : [];
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

  function setFieldsetEnabled(enabled) {
    const fieldset = $('qwenGenerationFields');
    if (fieldset) {
      fieldset.disabled = !enabled || busy;
    }
  }

  function renderState() {
    renderTargetOptions();
    const availability = toolState?.availability || {};
    const enabled = availability.enabled === true;
    const fetched = $('qwenFetched');
    if (fetched) fetched.textContent = formatDate(toolState?.fetchedAt);

    if (enabled) {
      setBadge('Service enabled', 'ok');
      setFieldsetEnabled(true);
      setAlert('', 'success');
      return;
    }

    const reason = availability.reason || 'Qwen3 LoRA service is not available.';
    setBadge('Service disabled', 'error');
    setFieldsetEnabled(false);
    setAlert(reason, 'warn');
  }

  async function loadState({ silent = false } = {}) {
    if (!silent) {
      setBadge('Checking service', 'warn');
      setAlert('Checking Qwen3 LoRA service...', 'info');
    }
    toolState = await requestJson(endpoints.state);
    renderState();
  }

  function parseOptionalJson(textareaId, label) {
    const value = $(textareaId)?.value.trim();
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error(`${label} must be valid JSON.`);
    }
  }

  function numberValue(id) {
    const raw = $(id)?.value;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  }

  function requireRange(value, label, min, max) {
    if (value === undefined) return undefined;
    if (value < min || value > max) {
      throw new Error(`${label} must be between ${min} and ${max}.`);
    }
    return value;
  }

  function collectGenerationPayload() {
    const prompt = $('qwenPrompt')?.value.trim() || '';
    if (!prompt) {
      throw new Error('Enter a user prompt before generating.');
    }

    const maxNewTokens = Math.floor(requireRange(
      numberValue('qwenMaxTokens') ?? Number(config.defaultMaxNewTokens || 160),
      'Max tokens',
      1,
      Number(config.maxNewTokens || 1024),
    ));

    const payload = {
      prompt,
      system: $('qwenSystem')?.value.trim() || undefined,
      adapter_name: $('qwenTarget')?.value || undefined,
      max_new_tokens: maxNewTokens,
      temperature: requireRange(numberValue('qwenTemperature') ?? 0, 'Temperature', 0, 2),
      top_p: requireRange(numberValue('qwenTopP'), 'top_p', 0, 1),
      top_k: requireRange(numberValue('qwenTopK'), 'top_k', 0, 1000),
      repetition_penalty: requireRange(numberValue('qwenRepetitionPenalty'), 'repetition_penalty', 0.1, 3),
    };

    const tools = parseOptionalJson('qwenTools', 'tools');
    if (tools !== undefined) payload.tools = tools;
    const responseFormat = parseOptionalJson('qwenResponseFormat', 'response_format');
    if (responseFormat !== undefined) payload.response_format = responseFormat;

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === '') {
        delete payload[key];
      }
    });
    return payload;
  }

  function firstPresent(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
  }

  function renderUsage(usage) {
    const container = $('qwenUsage');
    if (!container) return;
    if (!usage) {
      container.replaceChildren();
      return;
    }
    container.className = 'qwen-user__usage-list';
    container.replaceChildren(
      create('span', { className: 'qwen-user__usage-item', text: `Prompt ${formatNumber(usage.prompt_tokens)}` }),
      create('span', { className: 'qwen-user__usage-item', text: `Completion ${formatNumber(usage.completion_tokens)}` }),
      create('span', { className: 'qwen-user__usage-item', text: `Total ${formatNumber(usage.total_tokens)}` }),
    );
  }

  function renderResponse(result) {
    const container = $('qwenResponse');
    if (!container) return;
    const content = firstPresent(result?.content, result?.raw_content, '');
    const nodes = [
      create('div', {
        className: 'qwen-user__response-content',
        text: content || '(empty response)',
      }),
    ];
    if (Array.isArray(result?.tool_calls) && result.tool_calls.length) {
      nodes.push(create('pre', {
        className: 'qwen-user__pre qwen-user__tool-calls',
        text: toJson(result.tool_calls),
      }));
    }
    container.replaceChildren(...nodes);
    renderUsage(result?.usage);

    const rawDetails = $('qwenRawDetails');
    const raw = $('qwenRaw');
    if (rawDetails && raw) {
      rawDetails.hidden = false;
      raw.textContent = toJson(result);
    }
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    setFieldsetEnabled(toolState?.availability?.enabled === true);
    const button = $('qwenGenerateBtn');
    const busyText = $('qwenBusyText');
    if (button) {
      button.disabled = busy;
      button.textContent = busy ? 'Generating...' : 'Generate';
    }
    if (busyText) {
      busyText.textContent = busy ? 'Waiting for model response' : '';
    }
  }

  async function handleGenerate(event) {
    event.preventDefault();
    if (busy) return;
    if (toolState?.availability?.enabled !== true) {
      setAlert(toolState?.availability?.reason || 'Qwen3 LoRA service is not available.', 'warn');
      return;
    }

    let payload;
    try {
      payload = collectGenerationPayload();
    } catch (error) {
      setAlert(error.message || 'Check the generation inputs.', 'error');
      return;
    }

    setBusy(true);
    setAlert('Generating response...', 'info');
    renderUsage(null);
    try {
      const result = await requestJson(endpoints.generate, {
        method: 'POST',
        body: payload,
      });
      renderResponse(result);
      setAlert('Generation completed.', 'success');
    } catch (error) {
      setAlert(error.message || 'Generation failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    $('qwenRefreshBtn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await loadState();
      } catch (error) {
        setBadge('Service unavailable', 'error');
        setFieldsetEnabled(false);
        setAlert(error.message || 'Unable to check Qwen3 LoRA service.', 'error');
      } finally {
        button.disabled = false;
      }
    });

    $('qwenGenerateForm')?.addEventListener('submit', handleGenerate);
  }

  bindEvents();
  loadState().catch((error) => {
    setBadge('Service unavailable', 'error');
    setFieldsetEnabled(false);
    setAlert(error.message || 'Unable to check Qwen3 LoRA service.', 'error');
  });
})();
