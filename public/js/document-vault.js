'use strict';

(() => {
  const form = document.querySelector('#vault-upload');
  if (form) {
    const input = form.querySelector('#scans');
    const status = form.querySelector('#upload-status');
    const order = form.querySelector('#page-order');
    const submit = form.querySelector('button[type=submit]');
    let files = [];
    function showOrder() {
      order.replaceChildren();
      files.forEach((file, index) => {
        const li = document.createElement('li');
        li.append(document.createTextNode(file.name));
        for (const [label, delta] of [['Up', -1], ['Down', 1]]) {
          const adjacent = index + delta;
          if (adjacent < 0 || adjacent >= files.length) continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'secondary';
          button.textContent = label;
          button.setAttribute('aria-label', 'Move ' + file.name + ' ' + label.toLowerCase());
          button.addEventListener('click', () => {
            [files[index], files[adjacent]] = [files[adjacent], files[index]];
            showOrder();
          });
          li.append(button);
        }
        order.append(li);
      });
    }
    input.addEventListener('change', () => {
      files = Array.from(input.files);
      const invalid = files.length > 12 || files.some(f => f.size > 8 * 1024 * 1024)
        || files.reduce((sum, f) => sum + f.size, 0) > 32 * 1024 * 1024;
      input.setCustomValidity(invalid ? 'Choose up to 12 pages, 8 MiB each and 32 MiB in total.' : '');
      input.reportValidity();
      showOrder();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      status.textContent = 'Uploading pages…';
      try {
        const data = new FormData(form);
        data.delete('scans');
        for (const file of files) data.append('scans', file);
        const res = await fetch(form.action, { method: 'POST', body: data, headers: { 'X-CSRF-Token': form.dataset.csrf, Accept: 'application/json' } });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || 'Upload failed. Check your session and try again.');
        window.location.assign(result.location);
      } catch (error) {
        status.textContent = error.message;
        submit.disabled = false;
      }
    });
  }

  const invoice = document.querySelector('#invoice');
  if (invoice) {
    const total = document.querySelector('#total');
    const warning = document.querySelector('#invoice-warning');
    function displayInvoiceState() {
      total.required = invoice.checked;
      total.placeholder = invoice.checked ? 'Required' : 'Optional';
      warning.hidden = invoice.checked === (invoice.dataset.ocrMatch === 'true');
      if (warning.hidden) invoice.removeAttribute('aria-describedby');
      else invoice.setAttribute('aria-describedby', warning.id);
    }
    invoice.addEventListener('change', displayInvoiceState);
    displayInvoiceState();
  }

  const decision = document.querySelector('#decision');
  if (decision) {
    const location = document.querySelector('#storage-location');
    const date = document.querySelector('#date');
    const year = location.querySelector('#yearLabel');
    const group = location.querySelector('#groupLabel');
    let yearEdited = year.value !== date.value.slice(0, 4);
    const quarter = () => date.value ? 'Q' + Math.ceil(Number(date.value.slice(5, 7)) / 3) : '';
    let groupEdited = group.value !== quarter();
    year.addEventListener('input', () => { yearEdited = true; });
    group.addEventListener('input', () => { groupEdited = true; });
    date.addEventListener('input', () => {
      if (!yearEdited) year.value = date.value.slice(0, 4);
      if (!groupEdited) group.value = quarter();
    });
    document.querySelector('#group-other').addEventListener('click', () => {
      groupEdited = true;
      group.value = 'Other';
    });
    function displayLocation() {
      const keep = decision.value === 'keep';
      location.hidden = !keep;
      for (const input of location.querySelectorAll('input')) {
        input.disabled = !keep;
        input.required = keep;
      }
    }
    decision.addEventListener('change', displayLocation);
    displayLocation();
  }
  // Only idle list views refresh. Never interrupt filing, selecting scans,
  // following a link or confirming a queue resume.
  if (document.querySelector('[data-live-list]')) {
    setInterval(async () => {
      if (document.hidden || document.activeElement !== document.body || window.getSelection()?.toString()) return;
      const current = document.querySelector('[data-live-list]');
      if (!current || current.dataset.loading || current.querySelector('input:checked')) return;
      current.dataset.loading = 'true';
      try {
        const response = await fetch(window.location.href, { cache: 'no-store' });
        if (!response.ok) return;
        const replacement = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector('[data-live-list]');
        if (replacement && document.activeElement === document.body && !current.querySelector('input:checked')) current.replaceWith(replacement);
      } catch { /* The Refresh link remains available when disconnected. */ }
      finally { delete current.dataset.loading; }
    }, 10000);
  }
})();
