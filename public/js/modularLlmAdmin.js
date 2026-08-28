(() => {
  const root = document.querySelector('.modular-admin[data-state-url]');
  if (!root) return;

  const form = document.getElementById('modularPipelineForm');
  const input = document.getElementById('modularTestInput');
  const inputCount = document.getElementById('modularInputCount');
  const runButton = document.getElementById('modularRunButton');
  const runFeedback = document.getElementById('modularRunFeedback');
  const stateUrl = root.dataset.stateUrl;

  const updateInputCount = () => {
    if (!input || !inputCount) return;
    inputCount.textContent = `${input.value.length.toLocaleString()} / ${input.maxLength.toLocaleString()}`;
  };

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element && value !== undefined && value !== null && value !== '') {
      element.textContent = value;
    }
  };

  const setServiceStatus = (state) => {
    const element = document.getElementById('modularServiceStatus');
    if (!element) return;
    element.textContent = state.serviceStatusDisplay || 'Unknown';
    element.classList.remove(
      'modular-status--success',
      'modular-status--failed',
      'modular-status--neutral',
    );
    element.classList.add(state.health && state.health.ok === true
      ? 'modular-status--success'
      : 'modular-status--neutral');
  };

  const refreshRuntimeState = async () => {
    if (!stateUrl || document.hidden) return;
    try {
      const response = await fetch(stateUrl, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const state = await response.json();
      if (!response.ok && !state.service && !state.health) return;
      setText('modularServiceName', state.serviceName);
      setText('modularContainerState', state.containerStateDisplay);
      setText('modularBundleId', state.bundleId);
      setText('modularRuntimeMode', state.runtimeModeDisplay);
      setText('modularStateFetched', `Updated ${state.fetchedAtDisplay || 'just now'}`);
      setServiceStatus(state);
    } catch (error) {
      // Keep the last known state; the server-rendered endpoint warnings remain authoritative.
    }
  };

  if (input) {
    input.addEventListener('input', updateInputCount);
    updateInputCount();
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      runButton.disabled = true;
      runButton.textContent = 'Running pipeline…';
      runFeedback.textContent = 'Waiting for GPU admission and sequential stage workers. Keep this page open.';

      const body = new URLSearchParams();
      new FormData(form).forEach((value, key) => body.append(key, value));

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          },
          body,
        });
        const payload = await response.json();
        if (payload.detailUrl) {
          window.location.assign(payload.detailUrl);
          return;
        }
        throw new Error(payload.error || `Pipeline request failed with ${response.status}.`);
      } catch (error) {
        runButton.disabled = false;
        runButton.textContent = 'Run pipeline test';
        runFeedback.textContent = error.message || 'Unable to start the pipeline test.';
      }
    });
  }

  window.setInterval(refreshRuntimeState, 10000);
})();
