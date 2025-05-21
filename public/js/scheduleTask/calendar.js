// Calendar rendering for 3 days of 96 slots per day
/* Expects:
    - window.scheduleTaskApi
    - Bootstrap loaded
    - A container with id 'calendarGrid'
 */
(async function() {
  const SLOT_MINUTES = 15, SLOTS_PER_DAY = 96, DAY_COUNT = 3;
  const $grid = document.getElementById('calendarGrid');
  const palette = await scheduleTaskApi.getPalette();
  // Use today's 00:00
  const today = (d => new Date(d.getFullYear(), d.getMonth(), d.getDate()))(new Date());
  const from = today,
        to = new Date(today.getTime() + DAY_COUNT*24*60*60*1000);
  const { presences, tasks } = await scheduleTaskApi.getTasks(from, to);
  // Compose presence slots (fallback 'home')
  const slotArr = [];
  console.log(palette);
  for (let d = new Date(from), idx = 0; d < to; d = new Date(d.getTime() + SLOT_MINUTES*60000), idx++) {
    // Find explicit presence covering slot
    let inPresence = presences.find(p =>
      new Date(p.start) <= d && new Date(p.end) > d
    );
    let bg = null, border = null, info = {};
    if (inPresence) {
      bg = palette[`location.${inPresence.location}`]?.bgColor || '#EEE';
      border = palette[`purpose.${inPresence.purpose}`]?.border;
      info = {...inPresence};
    } else {
      bg = palette['location.home']?.bgColor;
      border = palette['location.home']?.border;
      info = { location: 'home', purpose: null };
    }
    slotArr.push({ idx, date: new Date(d), bg, border, info, tasks: [] });
  }
  // Place tasks into slots (active ones)
  for (let t of tasks) {
    if (t.done) continue;
    // "Active" tasks show up when (no start or start <= now) && (!end or now <= end)
    let now = new Date();
    let show = (!t.start || new Date(t.start) <= now)
      && (!t.end || new Date(t.end) >= now);
    // Overdue: end in past and !done, separate (see below)
    if (!show && t.end && new Date(t.end) < now) continue;
    // Pick the anchor slot: max(start, now), floored to 15 min
    let anchor = new Date(Math.max((t.start ? +new Date(t.start) : +now), +now));
    anchor.setMinutes(Math.floor(anchor.getMinutes()/SLOT_MINUTES)*SLOT_MINUTES, 0, 0);
    // Find slot
    let slot = slotArr.find(s => Math.abs(s.date - anchor) < 1e5); // within 100ms
    if (slot) slot.tasks.push(t);
  }
  // Render grid: day cols, slot rows
  let days = [];
  for (let d = 0; d < DAY_COUNT; d++) {
    let dayStart = new Date(from.getTime() + d*24*60*60*1000);
    let slots = slotArr.slice(d*SLOTS_PER_DAY, (d+1)*SLOTS_PER_DAY);
    days.push({ date: dayStart, slots });
  }
  let html = `<div class="row">`;
  for (let day of days) {
    html += `<div class="col calendar-day" data-day="${day.date.toISOString()}">
      <div class="calendar-day-label text-center sticky-top bg-white">${day.date.toDateString()}</div>
      <div class="slots">`;
    for (let slot of day.slots) {
      html += `<div class="calendar-slot" style="background:${slot.bg};border-left:5px solid ${slot.border||'transparent'}"
                  data-idx="${slot.idx}" data-location="${slot.info.location}" data-purpose="${slot.info.purpose}">
        <div class="slot-time">${slot.date.getHours().toString().padStart(2,'0')}:${slot.date.getMinutes().toString().padStart(2,'0')}</div>
        <div class="slot-tasks">`;
      for (let task of slot.tasks) {
        html += `
          <span class="badge bg-primary me-1 schedule-task-pill" data-task-id="${task._id}" title="${task.title}">
            <input type="checkbox" class="form-check-input" data-task-id="${task._id}" ${task.done?'checked':''}>
            ${task.title}
          </span>
        `;
      }
      html += `</div></div>`;
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  $grid.innerHTML = html;

  // (a) Overdue bar
  let overdue = tasks.filter(t => !t.done && t.end && new Date(t.end) < new Date());
  if (overdue.length) {
    let overdueBar = document.getElementById("overdueBar");
    if (!overdueBar) {
      overdueBar = document.createElement('div');
      overdueBar.id = "overdueBar";
      $grid.parentElement.insertBefore(overdueBar, $grid);
    }
    overdueBar.innerHTML = overdue.map(t =>
      `<div class="alert alert-danger d-flex align-items-center justify-content-between">
        <span class="fw-bold">${t.title}</span>
        <span><small>Missed: ${new Date(t.end).toLocaleString()}</small></span>
        <input type="checkbox" data-task-id="${t._id}" class="form-check-input ms-2" onclick="OverdueDone('${t._id}',true)">
      </div>`
    ).join('');
  }
  // [Enhance for "See all..." if too many tasks per slot, or expandable]

  // (b) Event delegation for modals & checkboxes
  $grid.addEventListener('click', function(ev) {
    // Checkbox for marking as done
    if (ev.target.classList.contains('form-check-input') && ev.target.dataset.taskId) {
      scheduleTaskApi.toggleDone(ev.target.dataset.taskId, ev.target.checked)
        .then(()=>window.location.reload());
    }

    let pill = ev.target.closest('.schedule-task-pill');
    if (pill) {
      // Open modal for this task (details)
      window.scheduleTaskModal.openTask(pill.dataset.taskId);
      return;
    }
    let slot = ev.target.closest('.calendar-slot');
    if (slot) {
      window.scheduleTaskModal.openSlot(slot.dataset.idx);
      return;
    }
  });

  // Touch for mobile (simply wire tap/click for now)

  // ... Optionally setup responsive heights, sticky labels, expand slots
})();

function OverdueDone(id, done) {
  scheduleTaskApi.toggleDone(id, done).then(()=>window.location.reload());
}
