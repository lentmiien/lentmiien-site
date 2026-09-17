(() => {
  'use strict';
  document.querySelectorAll('[data-chat5-export]').forEach(form => {
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('.chat5-export-status');
    const download = form.querySelector('.chat5-export-download');
    const review = form.querySelector('.chat5-export-review');
    let objectUrl;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (button.disabled) return;
      const types = Array.from(form.querySelectorAll('input[name="type"]:checked')).map(input => input.value);
      status.dataset.error = 'false';
      if (!types.length) {
        status.textContent = 'Choose at least one message type.';
        status.dataset.error = 'true';
        return;
      }
      button.disabled = true;
      download.hidden = true;
      review.replaceChildren();
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      status.textContent = 'Preparing the full conversation export…';
      const format = form.querySelector('[name="format"]').value;
      const query = new URLSearchParams({ format, types: types.join(','),
        hidden: form.querySelector('[name="hidden"]').checked ? '1' : '0',
        raw: form.querySelector('[name="raw"]').checked ? '1' : '0' });
      try {
        const response = await fetch(`${form.action}?${query}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
        if (!response.ok) {
          const fallback = response.status === 403 ? 'You do not have permission to export this conversation.'
            : response.status === 401 ? 'Sign in again, then retry the export.' : 'Export failed. Please retry.';
          let message = fallback;
          if ((response.headers.get('Content-Type') || '').includes('application/json')) {
            const failure = await response.json();
            if (typeof failure.error === 'string') message = failure.error;
          }
          throw new Error(message);
        }
        const body = await response.text();
        const data = format === 'json' ? JSON.parse(body) : null;
        const lines = data ? null : body.trimEnd().split('\n').map(line => JSON.parse(line));
        const manifest = data || lines[0];
        if (manifest.schema_version !== 'chat5-source-export/1') throw new Error('Unexpected export response. Reload and try again.');
        const groups = data ? data.groups : lines.slice(1);
        const counts = manifest.summary;
        status.textContent = `${counts.reference_count} source references; ${counts.selected_records} selected records; ${counts.excluded_records} excluded; ${counts.missing_references} missing; ${counts.duplicate_positions} duplicate positions. ${counts.pair_candidates} positional pair candidates; ${counts.ambiguous_groups} ambiguous groups; ${counts.review_groups} other review groups. All context sufficiency is unreviewed.`;
        groups.filter(group => group.record_type !== 'pair_candidate').forEach(group => {
          const item = document.createElement('li');
          item.textContent = `${group.record_type}: positions ${group.position_start}–${group.position_end} (zero-based), ${group.prompt_refs.length} prompts / ${group.response_refs.length} text responses. ${group.reasons.join(', ')}.`;
          review.appendChild(item);
        });
        objectUrl = URL.createObjectURL(new Blob([body], { type: format === 'json' ? 'application/json;charset=utf-8' : 'application/x-ndjson;charset=utf-8' }));
        download.href = objectUrl;
        download.download = `chat5-${manifest.conversation.id}-source-v1.${format}`;
        download.hidden = false;
        download.click();
      } catch (error) {
        status.dataset.error = 'true';
        status.textContent = error instanceof TypeError ? 'Export could not be downloaded. Check your connection and sign-in, then retry.' : error.message;
      } finally {
        button.disabled = false;
      }
    });
    window.addEventListener('pagehide', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
  });
})();
