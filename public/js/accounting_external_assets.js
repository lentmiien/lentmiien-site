(() => {
  const state = window.externalAssetsState || {};
  const routes = state.routes || {};

  document.addEventListener('DOMContentLoaded', () => {
    bindCreateForm();
    bindAssetRows();
    setDefaultBalanceDate();
  });

  function bindCreateForm() {
    const form = document.getElementById('externalAssetForm');
    const feedback = document.getElementById('externalAssetFeedback');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setFeedback(feedback, 'Saving...');
      try {
        const payload = formPayload(form);
        const response = await fetch(routes.assets, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Unable to save external asset');
        }
        setFeedback(feedback, 'Saved.');
        window.location.reload();
      } catch (error) {
        setFeedback(feedback, error.message);
      }
    });
  }

  function bindAssetRows() {
    document.querySelectorAll('tr[data-asset-id]').forEach((row) => {
      const id = row.dataset.assetId;
      const save = row.querySelector('.external-asset-save');
      const payment = row.querySelector('.external-asset-payment');
      const remove = row.querySelector('.external-asset-delete');
      if (save) {
        save.addEventListener('click', () => saveRow(row, id));
      }
      if (payment) {
        payment.addEventListener('click', () => applyMonthlyPayment(id));
      }
      if (remove) {
        remove.addEventListener('click', () => deleteAsset(id));
      }
    });
  }

  async function saveRow(row, id) {
    if (!id) return;
    const payload = rowPayload(row);
    await requestAndReload(`${routes.assets}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async function applyMonthlyPayment(id) {
    if (!id) return;
    await requestAndReload(`${routes.assets}/${id}/apply-monthly-payment`, {
      method: 'POST',
    });
  }

  async function deleteAsset(id) {
    if (!id) return;
    await requestAndReload(`${routes.assets}/${id}`, {
      method: 'DELETE',
    });
  }

  async function requestAndReload(url, options) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Unable to update external asset');
    }
    window.location.reload();
  }

  function formPayload(form) {
    const data = new FormData(form);
    const payload = {};
    data.forEach((value, key) => {
      payload[key] = normalizeValue(key, value);
    });
    return payload;
  }

  function rowPayload(row) {
    const payload = {};
    row.querySelectorAll('.external-asset-input').forEach((input) => {
      const field = input.dataset.field;
      if (!field) return;
      payload[field] = normalizeValue(field, input.value);
    });
    return payload;
  }

  function normalizeValue(field, value) {
    if (field === 'currency') {
      return String(value || '').trim().toUpperCase();
    }
    if (['currentBalance', 'monthlyPayment', 'annualInterestRate'].includes(field)) {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    }
    return String(value || '').trim();
  }

  function setDefaultBalanceDate() {
    const input = document.getElementById('assetBalanceDate');
    if (!input || input.value) return;
    input.value = new Date().toISOString().slice(0, 10);
  }

  function setFeedback(element, text) {
    if (!element) return;
    element.textContent = text;
  }
})();
