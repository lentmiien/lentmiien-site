(() => {
  const HOLD_MS = 900;
  const MOVE_LIMIT = 10;

  function initTaskHolds(doc = document, win = window) {
    const section = doc.getElementById('mypage-tasks');
    const status = doc.getElementById('mypage-task-status');
    const token = section?.dataset.csrfToken;
    if (!token || !status) return;

    let gesture = null;
    let pending = null;
    let frame = null;
    let suppressClick = false;
    const pointers = new Set();

    function announce(message, error = false) {
      status.classList.toggle('is-error', error);
      status.textContent = message;
    }

    function resetProgress(item) {
      item.classList.remove('is-holding');
      item.style.removeProperty('--hold-progress');
    }

    function cancel(suppress = true) {
      if (!gesture) return;
      win.cancelAnimationFrame(frame);
      if (!gesture.committed) {
        resetProgress(gesture.item);
        announce('');
      }
      suppressClick = suppressClick || suppress || gesture.committed;
      gesture = null;
    }

    async function complete(item) {
      pending = item;
      item.classList.remove('is-holding');
      item.classList.add('is-saving');
      item.setAttribute('aria-busy', 'true');
      announce('Saving task…');
      const controller = new win.AbortController();
      const timeout = win.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await win.fetch(`/mypage/api/tasks/${encodeURIComponent(item.dataset.taskId)}/done`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify({ done: true }),
          signal: controller.signal,
        });
        if (!response.ok || response.redirected) throw new Error('Request failed');
        const result = await response.json();
        if (result.ok !== true || result.done !== true) throw new Error('Completion not confirmed');
        const wrapper = item.closest?.('.account-task-row');
        const hadFocus = doc.activeElement === item || Boolean(wrapper?.contains(doc.activeElement));
        (wrapper || item).remove();
        const nextTask = section.querySelector('[data-task-id]');
        const emptyLink = section.querySelector('.schedule-task-pill--empty');
        emptyLink.hidden = Boolean(nextTask);
        if (hadFocus) (nextTask || emptyLink).focus();
        announce(nextTask ? 'Task completed.' : 'Task completed. No tasks left here.');
      } catch (_) {
        announce('Could not confirm completion. Reload before trying again, or open tasks to check its status.', true);
      } finally {
        win.clearTimeout(timeout);
        item.classList.remove('is-saving');
        item.removeAttribute('aria-busy');
        resetProgress(item);
        pending = null;
      }
    }

    section.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-complete-task]');
      if (!button || pending) return;
      const item = [...section.querySelectorAll('[data-task-id]')].find(el => el.dataset.taskId === button.dataset.completeTask);
      if (item) { cancel(false); void complete(item); }
    });

    function tick(now) {
      if (!gesture || gesture.committed) return;
      const progress = Math.min(1, (now - gesture.started) / HOLD_MS);
      gesture.item.style.setProperty('--hold-progress', String(progress));
      if (progress >= 1) {
        gesture.committed = true;
        suppressClick = true;
        void complete(gesture.item);
      } else {
        frame = win.requestAnimationFrame(tick);
      }
    }

    // Observe the whole gesture even if the item disappears before pointerup.
    // Do not prevent pointerdown or capture touch: native scrolling stays available.
    doc.addEventListener('pointerdown', (event) => {
      pointers.add(event.pointerId);
      if (gesture || pointers.size > 1) {
        cancel();
        return;
      }
      suppressClick = false;
      if (event.target.closest?.('[data-complete-task]')) return;
      const item = event.target.closest?.('[data-task-id]');
      if (!item || !section.contains(item)) return;
      if (pending) {
        suppressClick = true;
        return;
      }
      if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      gesture = {
        item, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        started: win.performance.now(), committed: false,
      };
      item.classList.add('is-holding');
      item.style.setProperty('--hold-progress', '0');
      announce('Keep holding to complete. Release early to open tasks.');
      frame = win.requestAnimationFrame(tick);
    }, true);

    doc.addEventListener('pointermove', (event) => {
      if (!gesture || event.pointerId !== gesture.pointerId || gesture.committed) return;
      const bounds = gesture.item.getBoundingClientRect();
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > MOVE_LIMIT
        || event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel();
    }, true);

    doc.addEventListener('pointerup', (event) => {
      pointers.delete(event.pointerId);
      if (gesture?.pointerId === event.pointerId) cancel(false);
    }, true);
    doc.addEventListener('pointercancel', (event) => {
      pointers.delete(event.pointerId);
      if (gesture?.pointerId === event.pointerId) cancel();
    }, true);
    doc.addEventListener('lostpointercapture', (event) => {
      if (gesture?.pointerId === event.pointerId) cancel();
    }, true);
    doc.addEventListener('pointerout', (event) => {
      if (gesture?.pointerId === event.pointerId && !gesture.item.contains(event.relatedTarget)) cancel();
    }, true);
    doc.addEventListener('scroll', () => cancel(), true);
    win.addEventListener('blur', () => { cancel(); pointers.clear(); });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) { cancel(); pointers.clear(); }
    });
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cancel();
    });
    section.addEventListener('dragstart', (event) => {
      if (event.target.closest('[data-task-id]')) { event.preventDefault(); cancel(); }
    });
    section.addEventListener('contextmenu', (event) => {
      // Keep right-click and keyboard link menus; suppress only an active hold's callout.
      if (gesture || suppressClick) event.preventDefault();
    });
    doc.addEventListener('click', (event) => {
      // Keyboard activation (detail=0) remains a normal link activation.
      if (event.detail !== 0 && (suppressClick || (pending && section.contains(event.target)))) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      }
    }, true);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { initTaskHolds, HOLD_MS };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initTaskHolds());
    else initTaskHolds();
  }
})();
