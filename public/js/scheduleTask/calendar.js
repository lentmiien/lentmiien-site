/* globals scheduleTaskApi */

(async () => {
  const SLOT_MIN = 15;
  const SLOT_MS = SLOT_MIN * 60 * 1000;
  const WINDOW_MS = 72 * 60 * 60 * 1000;
  const MAX_TASK_SPAN_SLOTS = 18;

  const state = window.scheduleTaskState = {};

  const palette = await scheduleTaskApi.getPalette();
  const from = roundToSlot(new Date());
  const to = new Date(from.getTime() + WINDOW_MS);
  const now = new Date();
  const currentSlot = roundToSlot(now);

  const { presences, tasks } = await scheduleTaskApi.getTasks(from, to);

  state.presences = presences;
  state.tasks = tasks;
  state.slots = buildSlots(from, to);

  const visibleTasks = tasks
    .filter(t => !t.done && !isOverdue(t, now))
    .sort(sortTasks);

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = renderAgenda();

  const currentEl = grid.querySelector(`.calendar-slot[data-date="${currentSlot.toISOString()}"]`);
  if (currentEl) currentEl.classList.add('current-slot');

  renderOverdueBar();
  addDelegatedEvents();

  function renderAgenda() {
    const days = buildDayRanges(from, to);
    return `
      <div class="schedule-calendar-shell">
        ${days.map(day => renderDay(day)).join('')}
      </div>`;
  }

  function renderDay(day) {
    const taskInstances = getTaskInstances(day.start, day.end);
    const body = renderDayRows(day, taskInstances);
    const taskLabel = `${taskInstances.length} ${taskInstances.length === 1 ? 'task' : 'tasks'}`;

    return `
      <section class="schedule-day" data-day="${day.key}">
        <div class="schedule-day-header">
          <div>
            <div class="schedule-day-kicker">${escapeHtml(formatWeekday(day.start))}</div>
            <h3>${escapeHtml(formatDayTitle(day.start))}</h3>
          </div>
          <div class="schedule-day-meta">
            <span>${escapeHtml(formatRange(day.start, day.end))}</span>
            <span>${taskLabel}</span>
          </div>
        </div>
        <div class="schedule-day-body">
          ${body || renderEmptyDay(day)}
        </div>
      </section>`;
  }

  function renderDayRows(day, taskInstances) {
    const slots = state.slots.filter(slot => slot.date >= day.start && slot.date < day.end);
    if (!slots.length) return '';

    const taskMap = buildTaskStartMap(taskInstances);
    let html = '';
    let i = 0;

    while (i < slots.length) {
      const slot = slots[i];
      const iso = slot.date.toISOString();
      const tasksHere = taskMap.get(iso) || [];
      const isCurrent = +slot.date === +currentSlot;

      if (tasksHere.length || isCurrent) {
        html += renderEventRow(slot.date, tasksHere, slot.presence, isCurrent);
        const coveredUntil = tasksHere.reduce((latest, inst) => {
          return Math.max(latest, +inst.displayEnd);
        }, +slot.date + SLOT_MS);

        i += 1;
        while (
          i < slots.length &&
          +slots[i].date < coveredUntil &&
          !taskMap.has(slots[i].date.toISOString()) &&
          +slots[i].date !== +currentSlot &&
          !presenceChanged(slots, i)
        ) {
          i += 1;
        }
        continue;
      }

      const startIndex = i;
      i += 1;
      while (
        i < slots.length &&
        !taskMap.has(slots[i].date.toISOString()) &&
        +slots[i].date !== +currentSlot &&
        !presenceChanged(slots, i)
      ) {
        i += 1;
      }

      const start = slots[startIndex].date;
      const end = i < slots.length ? slots[i].date : day.end;
      html += renderGapRow(start, end, slots[startIndex].presence);
    }

    return html;
  }

  function renderEventRow(date, taskInstances, presence, isCurrent) {
    const context = getPresenceContext(presence);
    const tasksHtml = taskInstances.length
      ? taskInstances.map(renderTaskCard).join('')
      : '<span class="schedule-now-chip">Now</span>';

    return `
      <div class="calendar-slot schedule-row schedule-row--event${isCurrent ? ' current-slot' : ''}"
           role="button"
           tabindex="0"
           data-date="${date.toISOString()}"
           data-location="${escapeAttr(context.location)}"
           data-purpose="${escapeAttr(context.purpose)}"
           style="--presence-accent:${context.accent};">
        <div class="schedule-row-time">
          <span class="schedule-time-primary">${escapeHtml(formatTime(date))}</span>
        </div>
        <div class="schedule-row-main">
          <div class="schedule-context">
            <span class="presence-dot" aria-hidden="true"></span>
            <span class="presence-location">${escapeHtml(context.location)}</span>
            ${context.purpose ? `<span class="presence-purpose">${escapeHtml(context.purpose)}</span>` : ''}
            ${isCurrent ? '<span class="schedule-current-label">Current</span>' : ''}
          </div>
          <div class="schedule-task-stack">${tasksHtml}</div>
        </div>
      </div>`;
  }

  function renderGapRow(start, end, presence) {
    const context = getPresenceContext(presence);
    const minutes = Math.max(SLOT_MIN, Math.round((end - start) / 60000));
    const slots = Math.max(1, Math.ceil(minutes / SLOT_MIN));

    return `
      <div class="calendar-slot schedule-row schedule-gap"
           role="button"
           tabindex="0"
           data-date="${start.toISOString()}"
           data-location="${escapeAttr(context.location)}"
           data-purpose="${escapeAttr(context.purpose)}"
           style="--presence-accent:${context.accent};--gap-slots:${Math.min(slots, 12)};">
        <div class="schedule-row-time">
          <span class="schedule-time-primary">${escapeHtml(formatTime(start))}</span>
          <span class="schedule-time-secondary">${escapeHtml(formatTime(end))}</span>
        </div>
        <div class="schedule-gap-main">
          <span class="schedule-gap-title">${escapeHtml(context.label)}</span>
          <span class="schedule-gap-duration">${escapeHtml(formatDuration(minutes * 60000))}</span>
        </div>
      </div>`;
  }

  function renderTaskCard(instance) {
    const task = instance.task;
    const spanSlots = Math.max(1, Math.ceil((instance.displayEnd - instance.displayStart) / SLOT_MS));
    const typeClass = task.type === 'tobuy' ? 'schedule-task-card--tobuy' : 'schedule-task-card--todo';
    const clippedClass = instance.continuesBefore || instance.continuesAfter ? ' schedule-task-card--continued' : '';
    const continuation = [
      instance.continuesBefore ? 'started earlier' : '',
      instance.continuesAfter ? 'continues later' : ''
    ].filter(Boolean).join(', ');

    return `
      <article class="schedule-task-pill schedule-task-card ${typeClass}${clippedClass}"
               role="button"
               tabindex="0"
               data-task-id="${escapeAttr(task._id)}"
               title="${escapeAttr(task.title)}"
               style="--task-slots:${Math.min(spanSlots, MAX_TASK_SPAN_SLOTS)};">
        <input type="checkbox" class="form-check-input schedule-task-checkbox" data-task-id="${escapeAttr(task._id)}" aria-label="Mark done">
        <div class="schedule-task-content">
          <div class="schedule-task-meta">
            <span>${escapeHtml(task.type)}</span>
            <span>${escapeHtml(formatTaskRange(task))}</span>
          </div>
          <div class="schedule-task-title">${escapeHtml(task.title)}</div>
          ${task.description ? `<div class="schedule-task-description">${escapeHtml(task.description)}</div>` : ''}
          ${continuation ? `<div class="schedule-task-continuation">${escapeHtml(continuation)}</div>` : ''}
        </div>
      </article>`;
  }

  function renderEmptyDay(day) {
    return `
      <div class="schedule-empty-day calendar-slot"
           role="button"
           tabindex="0"
           data-date="${day.start.toISOString()}"
           data-location="home"
           data-purpose="">
        No scheduled tasks
      </div>`;
  }

  function renderOverdueBar() {
    const overdue = tasks.filter(t => !t.done && isOverdue(t, now)).sort(sortTasks);
    const bar = document.getElementById('overdueBar');

    if (!bar || !overdue.length) {
      if (bar) bar.innerHTML = '';
      return;
    }

    bar.innerHTML = `
      <section class="schedule-overdue-panel" aria-label="Overdue tasks">
        <div class="schedule-overdue-header">
          <span>Overdue</span>
          <span>${overdue.length}</span>
        </div>
        <div class="schedule-overdue-list">
          ${overdue.map(task => `
            <div class="schedule-overdue-item">
              <div>
                <strong>${escapeHtml(task.title)}</strong>
                <span>${escapeHtml(task.end ? new Date(task.end).toLocaleString() : '')}</span>
              </div>
              <input type="checkbox" class="form-check-input" data-task-id="${escapeAttr(task._id)}" aria-label="Mark done">
            </div>
          `).join('')}
        </div>
      </section>`;
  }

  function addDelegatedEvents() {
    document.addEventListener('click', e => {
      const checkbox = e.target.closest('input.form-check-input[data-task-id]');
      if (checkbox) {
        scheduleTaskApi.toggleDone(checkbox.dataset.taskId, checkbox.checked)
          .then(() => location.reload());
        return;
      }

      if (e.target.closest('.schedule-task-checkbox')) return;

      const pill = e.target.closest('.schedule-task-pill');
      if (pill) {
        window.scheduleTaskModal.openTask(pill.dataset.taskId);
        return;
      }

      const slot = e.target.closest('.calendar-slot');
      if (slot) {
        window.scheduleTaskModal.openSlot(slot.dataset.date);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select, button, a')) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;

      const target = e.target.closest('.schedule-task-pill, .calendar-slot');
      if (!target) return;

      e.preventDefault();
      target.click();
    });
  }

  function getTaskInstances(rangeStart, rangeEnd) {
    return visibleTasks.map(task => {
      const taskRange = getTaskVisualRange(task);
      if (!taskRange) return null;

      const startsBeforeRange = taskRange.start < rangeStart;
      const endsAfterRange = taskRange.end > rangeEnd;
      const displayStart = new Date(Math.max(+taskRange.start, +rangeStart, +from));
      const displayEnd = new Date(Math.min(+taskRange.end, +rangeEnd, +to));

      if (displayEnd <= displayStart) return null;

      return {
        task,
        displayStart: roundToSlot(displayStart),
        displayEnd,
        continuesBefore: startsBeforeRange,
        continuesAfter: endsAfterRange
      };
    }).filter(Boolean).sort((a, b) => {
      return a.displayStart - b.displayStart || sortTasks(a.task, b.task);
    });
  }

  function getTaskVisualRange(task) {
    const hasStart = Boolean(task.start);
    const hasEnd = Boolean(task.end);
    let start;
    let end;

    if (hasStart && hasEnd) {
      start = new Date(task.start);
      end = new Date(task.end);
    } else if (hasStart) {
      start = new Date(task.start);
      if (start < from) start = new Date(from);
      end = new Date(start.getTime() + SLOT_MS);
    } else if (hasEnd) {
      start = new Date(task.end);
      end = new Date(start.getTime() + SLOT_MS);
    } else {
      start = new Date(from);
      end = new Date(start.getTime() + SLOT_MS);
    }

    if (end <= start) end = new Date(start.getTime() + SLOT_MS);
    if (end <= from || start >= to) return null;

    return { start, end };
  }

  function buildTaskStartMap(taskInstances) {
    const map = new Map();

    taskInstances.forEach(instance => {
      const key = roundToSlot(instance.displayStart).toISOString();
      const list = map.get(key) || [];
      list.push(instance);
      map.set(key, list);
    });

    return map;
  }

  function buildSlots(start, end) {
    const result = [];
    let date = new Date(start);

    while (date < end) {
      result.push({
        date: new Date(date),
        presence: findPresence(date)
      });
      date = new Date(date.getTime() + SLOT_MS);
    }

    return result;
  }

  function buildDayRanges(start, end) {
    const ranges = [];
    let dayStart = startOfDay(start);

    while (dayStart < end) {
      const nextDay = addDays(dayStart, 1);
      const rangeStart = new Date(Math.max(+start, +dayStart));
      const rangeEnd = new Date(Math.min(+end, +nextDay));

      if (rangeStart < rangeEnd) {
        ranges.push({
          key: dayKey(dayStart),
          start: rangeStart,
          end: rangeEnd
        });
      }

      dayStart = nextDay;
    }

    return ranges;
  }

  function findPresence(date) {
    return presences.find(p => new Date(p.start) <= date && date < new Date(p.end)) || null;
  }

  function presenceChanged(slots, index) {
    if (index <= 0) return true;
    return presenceKey(slots[index].presence) !== presenceKey(slots[index - 1].presence);
  }

  function presenceKey(presence) {
    if (!presence) return 'home|';
    return `${presence.location || 'home'}|${presence.purpose || ''}`;
  }

  function getPresenceContext(presence) {
    const location = presence && presence.location ? presence.location : 'home';
    const purpose = presence && presence.purpose ? presence.purpose : '';
    const locationColor = palette[`location.${location}`]?.border || palette[`location.${location}`]?.bgColor;
    const purposeColor = purpose ? palette[`purpose.${purpose}`]?.border || palette[`purpose.${purpose}`]?.bgColor : null;
    const accent = safeHex(purposeColor || locationColor, location === 'home' ? '#17C696' : '#19E3E3');
    const label = purpose ? `${location} - ${purpose}` : location;

    return { location, purpose, accent, label };
  }

  function isOverdue(task, referenceDate) {
    return task.end && new Date(task.end) < referenceDate;
  }

  function sortTasks(a, b) {
    const aDate = a.end || a.start || from;
    const bDate = b.end || b.start || from;
    return new Date(aDate) - new Date(bDate) || String(a.title).localeCompare(String(b.title));
  }

  function roundToSlot(date) {
    const result = new Date(date);
    result.setSeconds(0, 0);
    result.setMinutes(Math.floor(result.getMinutes() / SLOT_MIN) * SLOT_MIN);
    return result;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function dayKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function formatWeekday(date) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  function formatDayTitle(date) {
    const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    if (dayKey(date) === dayKey(now)) return `Today, ${dateLabel}`;

    const tomorrow = addDays(startOfDay(now), 1);
    if (dayKey(date) === dayKey(tomorrow)) return `Tomorrow, ${dateLabel}`;

    return dateLabel;
  }

  function formatRange(start, end) {
    return `${formatTime(start)}-${formatTime(end)}`;
  }

  function formatTime(date) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function formatTaskRange(task) {
    const start = task.start ? new Date(task.start) : null;
    const end = task.end ? new Date(task.end) : null;

    if (start && end) {
      return `${formatCompactDateTime(start)}-${formatCompactDateTime(end)} | ${formatDuration(end - start)}`;
    }

    if (start) return `Starts ${formatCompactDateTime(start)}`;
    if (end) return `Due ${formatCompactDateTime(end)}`;
    return 'Anytime';
  }

  function formatCompactDateTime(date) {
    if (dayKey(date) === dayKey(now)) return formatTime(date);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + formatTime(date);
  }

  function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];

    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || !parts.length) parts.push(`${minutes}m`);

    return parts.join(' ');
  }

  function safeHex(value, fallback) {
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value || '') ? value : fallback;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }
})();
