/* Private content adapter; no payload enters the renderer, snapshots or NPC context. */
(function () {
  'use strict';
  window.CommonsPanels = function ({ request, toast }) {
    const root = document.getElementById('private-panel');
    let generation = 0, kind = null, owner = null, draftOwner = null, data, index = 0;
    const drafts = new Map(), recoveryDrafts = new Map();
    const artImage = new Image(); artImage.src = '/commons/furnishings.v1.2.webp';
    const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
    const button = (text, action) => { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
    const messages = { FORBIDDEN: 'Your account does not have access to this display.', UNAUTHORIZED: 'Reconnect to open this display.',
      TOO_FAR: 'Approach the display to read it.', BUSY: 'Please wait, then try again.',
      TASK_GONE: 'This task was removed or is no longer available. Refresh the board.',
      DIARY_INDEX_UNAVAILABLE: 'Diary saving is awaiting database setup. Your draft is retained; please retry after setup is complete.',
      DAY_CHANGED: 'Tokyo’s date changed. Your draft is retained below. Load today to continue; yesterday cannot be saved.',
      REVISION_CONFLICT: 'Another tab saved this date. Your draft is retained. Reload the saved entry before deciding what to keep.' };
    function reset(clearDrafts = false) {
      generation++; root.replaceChildren(); root.hidden = true; kind = null; data = null;
      if (clearDrafts) { drafts.clear(); recoveryDrafts.clear(); owner = null; draftOwner = null; }
    }
    function identify(id) {
      if (!id || draftOwner !== null && draftOwner !== id) reset(true);
      owner = id; draftOwner = id;
    }
    async function call(path, body) {
      const epoch = generation;
      const result = await request(path, body);
      if (epoch !== generation) throw new Error('STALE');
      if (result.error) throw new Error(result.error);
      return result;
    }
    function error(node, failure) { if (failure.message !== 'STALE') node.textContent = messages[failure.message] || 'Unable to load or save. Your draft is retained; please retry.'; }
    function heading(title, asset) {
      root.replaceChildren(); root.hidden = false;
      const art = el('canvas', null, 'panel-art'); art.width = 320; art.height = 320; art.setAttribute('aria-hidden', 'true');
      const draw = () => {
        const [sx, sy, sw, sh] = window.CommonsWorld.art.furnishings[{ board: 'noticeboard', books: 'bookshelf', diary: 'desk', stock: 'equipment' }[asset]].source;
        const scale = Math.min(320 / sw, 320 / sh); art.getContext('2d').drawImage(artImage, sx, sy, sw, sh, (320 - sw * scale) / 2, (320 - sh * scale) / 2, sw * scale, sh * scale);
      };
      if (artImage.complete) draw(); else artImage.addEventListener('load', draw, { once: true });
      root.append(art, el('h3', title));
    }
    function footer(payload) {
      if (payload.note) root.append(el('p', payload.note, 'panel-note'));
      if (payload.fetchedAt) root.append(el('small', `Read at ${new Date(payload.fetchedAt).toLocaleString('en-GB', { timeZone: 'Asia/Tokyo' })} Tokyo. Refresh for current data.`));
    }
    function quests() {
      heading('Your quests', 'board');
      const rows = data.rows;
      index = Math.max(0, Math.min(index, rows.length - 1));
      const status = el('p', '', 'panel-status'); status.setAttribute('role', 'status');
      if (!rows.length) root.append(el('p', 'No entries on your dashboard right now.'));
      else {
        const row = rows[index];
        root.append(el('small', `${index + 1} of ${rows.length} · ${row.group}`), el('h4', row.title), el('p', row.detail));
        if (row.start || row.end) root.append(el('p', `Start: ${row.start ? new Date(row.start).toLocaleString('en-GB', { timeZone: 'Asia/Tokyo' }) : 'Any time'} · Due: ${row.end ? new Date(row.end).toLocaleString('en-GB', { timeZone: 'Asia/Tokyo' }) : 'No deadline'} (Tokyo)`));
        const nav = el('div', null, 'panel-actions');
        const previous = button('Previous', () => { index--; quests(); }); previous.disabled = index === 0;
        const next = button('Next', () => { index++; quests(); }); next.disabled = index >= rows.length - 1;
        nav.append(previous, next); root.append(nav);
        if (row.canComplete && row.taskId) {
          const done = button('Report as done', async () => {
            done.disabled = true; status.textContent = 'Confirming completion…';
            try {
              const result = await call('quests/done', { taskId: row.taskId });
              if (!result.ok || !result.done) throw new Error('UNAVAILABLE');
              data = { ...data, rows: data.rows.filter(item => item.taskId !== row.taskId) }; quests();
              toast('Task completed. Your dashboard will reflect it on refresh.');
              try { data = await call('quests'); quests(); }
              catch (failure) { if (failure.message !== 'STALE') toast('Task completed. The board refresh failed; use Refresh board to reconcile the remaining entries.'); }
            } catch (failure) { if (failure.message !== 'STALE') status.textContent = messages[failure.message] || 'Completion could not be confirmed. Refresh the board before retrying.'; done.disabled = false; }
          }); done.className = 'primary'; root.append(done);
        } else if (/^\/(accounting|budget)\/close-month\/#account-[a-f\d]{24}$/i.test(row.href)) {
          const link = el('a', 'Review and confirm in Accounting'); link.href = row.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; root.append(link);
        }
      }
      root.append(status, button('Refresh board', () => open('quests'))); footer(data);
    }
    function aggregates() {
      heading(kind === 'stock' ? 'Household reserves' : kind === 'statistics' ? 'Site almanac' : 'Village chronicle', kind === 'stock' ? 'stock' : 'books');
      if (kind === 'diagnostics') {
        root.append(el('p', `${data.online} connected · ${data.roomOwned ? 'Room lease held' : 'No active room'} · ${data.persistenceFailed ? 'Saving needs attention' : 'Saving healthy'}`),
          el('p', `Revision ${data.revision ?? '—'} · Last save: ${data.lastSuccessfulSave ? new Date(data.lastSuccessfulSave).toISOString() : 'Unavailable'}`));
      } else for (const row of data.rows) {
        const article = el('article', null, 'metric'); article.append(el('h4', row.title));
        if (kind === 'stock') {
          article.append(el('p', `${row.current ?? 'Unknown'} / ${row.target ?? 'No target'} ${row.unit} · ${row.percent === null ? '— (unknown or no positive target)' : `${row.percent}%`}`), el('small', row.status));
          const meter = el('progress'); meter.max = 100; meter.value = Math.min(100, Math.max(0, row.percent || 0)); meter.setAttribute('aria-label', row.title); article.append(meter);
        } else article.append(el('p', row.state === 'ready' ? `${row.value} ${row.unit}` : 'Unavailable · try refreshing'));
        root.append(article);
      }
      if (data.attention) root.append(el('p', `Attention: ${data.attention.expired} expired · ${data.attention.dueSoon} expiring soon · ${data.attention.inspectionDue} inspections due · ${data.attention.reviewDue} reviews due.`));
      footer(data);
      if (['/es/es_dashboard', '/admin/database_usage'].includes(data.source)) {
        const link = el('a', 'Open the normal Site page'); link.href = data.source; link.target = '_blank'; link.rel = 'noopener noreferrer'; root.append(link);
      }
      root.append(button('Refresh display', () => open(kind)));
    }
    function diary() {
      heading('A page of your own', 'diary');
      const entry = data.entry, today = data.today;
      const date = el('input'); date.type = 'date'; date.value = entry.date; date.max = today; date.setAttribute('aria-label', 'Diary date');
      root.append(el('p', `Today is ${today} in Tokyo. Only today can be saved. Past pages are read-only.`), date);
      const status = el('p', '', 'panel-status'); status.setAttribute('role', 'status');
      const editor = el('textarea'); editor.rows = 8; editor.maxLength = 10000; editor.setAttribute('aria-label', 'Diary text');
      const draft = drafts.get(entry.date);
      editor.value = draft?.text ?? entry.text; editor.readOnly = entry.date !== today;
      let revision = draft?.revision ?? entry.revision;
      if (draft) status.textContent = 'Unsaved draft restored in this owner session.';
      editor.addEventListener('input', () => { drafts.set(entry.date, { text: editor.value, revision }); status.textContent = 'Unsaved changes.'; });
      date.addEventListener('change', () => loadDiary(date.value));
      const save = button('Save today’s page', async () => {
        save.disabled = true; editor.disabled = true; status.textContent = 'Saving…';
        drafts.set(entry.date, { text: editor.value, revision });
        try {
          const result = await call('diary', { date: entry.date, text: editor.value, revision });
          revision = result.entry.revision; drafts.delete(entry.date); data = result;
          status.textContent = `Saved · revision ${revision}.`; save.disabled = result.today !== entry.date;
        } catch (failure) { error(status, failure); save.disabled = failure.message === 'DAY_CHANGED'; }
        finally { editor.disabled = false; }
      }); save.disabled = editor.readOnly; save.className = 'primary';
      root.append(editor, status, save, button('Load today', () => loadDiary()), button('Reload saved entry', async () => {
        // Preserve conflicting draft in a separate read-only recovery area, never silently overwrite it.
        const retained = drafts.get(entry.date);
        try {
          const result = await call(`diary?date=${encodeURIComponent(entry.date)}`);
          data = result; drafts.delete(entry.date); if (retained) recoveryDrafts.set(entry.date, retained); diary();

        } catch (failure) { error(status, failure); }
      }));
      for (const [day, retained] of recoveryDrafts) {
        const recovery = el('textarea'); recovery.readOnly = true; recovery.rows = 5; recovery.value = retained.text; recovery.setAttribute('aria-label', 'Retained draft');
        root.append(el('p', `Retained draft from ${day} — copy any text you want into the current page before saving.`), recovery);
      }
      // Midnight drafts remain visible even after loading today's blank page.
      for (const [day, retained] of drafts) if (day !== entry.date) {
        const recovery = el('textarea'); recovery.readOnly = true; recovery.rows = 3; recovery.value = retained.text; recovery.setAttribute('aria-label', `Retained draft ${day}`);
        root.append(el('p', `Unsaved draft from ${day} (cannot be backdated):`), recovery);
      }
      let before = '9999-12-31';
      const history = el('div', null, 'diary-history');
      const more = button('Browse saved dates', async () => {
        more.disabled = true;
        try {
          const result = await call(`diary?before=${before}`);
          for (const item of result.dates) history.append(button(item.date, () => loadDiary(item.date)));
          before = result.next; more.textContent = before ? 'Older dates' : 'All dates shown'; more.disabled = !before;
        } catch (failure) { error(status, failure); more.disabled = false; }
      }); root.append(more, history);
    }
    async function loadDiary(date) {
      const epoch = generation;
      try { const result = await call(`diary${date ? `?date=${encodeURIComponent(date)}` : ''}`); if (epoch === generation) { data = result; diary(); } }
      catch (failure) { if (failure.message !== 'STALE') toast(messages[failure.message] || 'Diary unavailable. Draft retained.'); }
    }
    async function open(panel) {
      reset(); kind = panel; root.hidden = false;
      const status = el('p', 'Opening…'); root.append(status);
      try { data = await call(panel); if (panel === 'quests') quests(); else if (panel === 'diary') diary(); else aggregates(); }
      catch (failure) { error(status, failure); }
    }
    window.addEventListener('beforeunload', event => { if ((drafts.size || recoveryDrafts.size) && owner) { event.preventDefault(); event.returnValue = ''; } });
    return { open, reset, identify };
  };
}());
