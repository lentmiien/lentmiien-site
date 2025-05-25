/* globals bootstrap, scheduleTaskApi */

// Immediately-invoked async function
(async () => {
  const SLOT_MIN = 15;
  const DAY_COLS  = ['col-12', 'col-md-6', 'col-lg-4'];   // responsive

  // Keep state globally so interactions.js can read
  const state = window.scheduleTaskState = {};

  const palette   = await scheduleTaskApi.getPalette();
  const todayFloor = roundToSlot(new Date());
  const from = todayFloor;
  const to   = new Date(from.getTime() + 3*24*60*60*1000);

  const { presences, tasks } = await scheduleTaskApi.getTasks(from, to);

  state.presences = presences;
  state.tasks     = tasks;

  // ---------- build slots ----------
  const slotArr = [];
  let dt = new Date(from);
  while (dt < to) {
    slotArr.push({
      date: new Date(dt),
      tasks: [],
      presence: findPresence(dt)        // explicit presence or null
    });
    dt = new Date(dt.getTime() + SLOT_MIN*60000);
  }
  state.slots = slotArr;

  // ---------- attach tasks to slots ----------
  const now = new Date();
  for (const t of tasks) {
    if (t.done) continue;

    const overdue = t.end && new Date(t.end) < now;
    if (overdue) continue; // will be handled in overdue bar

    const anchor   = new Date(Math.max(t.start ? +new Date(t.start) : +now, +now));
    const anchorRounded = roundToSlot(anchor);
    const slot = slotArr.find(s => +s.date === +anchorRounded);
    if (slot) slot.tasks.push(t);
  }

  // ---------- render ----------
  const $grid = document.getElementById('calendarGrid');
  $grid.innerHTML = renderGrid();

  // Mark current slot
  const cur = roundToSlot(now);
  const curEl = $grid.querySelector(`.calendar-slot[data-date="${cur.toISOString()}"]`);
  if (curEl) curEl.classList.add('current-slot');

  // Overdue bar
  renderOverdueBar();

  // Delegated events
  addDelegatedEvents();

  /* ---------------- local helpers --------------- */
  function roundToSlot(d){
    const r = new Date(d);
    r.setSeconds(0,0);
    r.setMinutes(Math.floor(r.getMinutes()/SLOT_MIN)*SLOT_MIN);
    return r;
  }

  function findPresence(date){
    return presences.find(p => new Date(p.start) <= date && date < new Date(p.end)) || null;
  }

  function renderGrid(){
    let html = '<div class="row g-0">';
    for (let day=0; day<3; day++){
      const daySlots = slotArr.slice(day*96, (day+1)*96);
      const label = daySlots[0].date.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
      html += `
        <div class="${DAY_COLS.join(' ')} calendar-day">
          <div class="calendar-day-label sticky-top bg-white text-center fw-bold py-1">${label}</div>
          ${daySlots.map(s=>renderSlot(s)).join('')}
        </div>`;
    }
    html += '</div>';
    return html;
  }

  function renderSlot(s){
    const pres   = s.presence;
    const bg     = pres ? palette[`location.${pres.location}`]?.bgColor || '#EEE'
                        : palette['location.home']?.bgColor;
    const border = pres ? palette[`purpose.${pres.purpose}`]?.border
                        : palette['location.home']?.border;

    const taskHtml = s.tasks.map(t => `
      <span class="badge ${t.type==='todo'?'bg-primary':'bg-warning text-dark'} me-1 schedule-task-pill"
            data-task-id="${t._id}" title="${t.title}" role="button">
        <input type="checkbox" class="form-check-input me-1" data-task-id="${t._id}">
        ${t.title}
      </span>
    `).join('');

    return `
      <div class="calendar-slot" 
           data-date="${s.date.toISOString()}"
           data-location="${pres ? pres.location : 'home'}"
           data-purpose="${pres ? pres.purpose : ''}"
           style="background:${bg};border-left:5px solid ${border||'transparent'}">
        <div class="slot-time">${s.date.getHours().toString().padStart(2,'0')}:${s.date.getMinutes().toString().padStart(2,'0')}</div>
        <div class="slot-tasks flex-wrap">${taskHtml}</div>
      </div>`;
  }

  function renderOverdueBar(){
    const overdue = tasks.filter(t => !t.done && t.end && new Date(t.end) < now);
    if (!overdue.length) return;

    let bar = document.getElementById('overdueBar');
    if (!bar){
      bar = document.createElement('div');
      bar.id='overdueBar';
      bar.className='mb-2';
      $grid.parentElement.insertBefore(bar,$grid);
    }
    bar.innerHTML = overdue.map(t=>`
      <div class="alert alert-danger py-1 d-flex justify-content-between align-items-center">
        <span class="fw-bold">${t.title}</span>
        <small class="me-2">${new Date(t.end).toLocaleString()}</small>
        <input type="checkbox" class="form-check-input" data-task-id="${t._id}">
      </div>`).join('');
  }

  function addDelegatedEvents(){
    document.addEventListener('click', e=>{
      // Checkbox (done)
      if (e.target.matches('input.form-check-input[data-task-id]')){
        const id = e.target.dataset.taskId;
        scheduleTaskApi.toggleDone(id, e.target.checked)
          .then(()=>location.reload());
        return;
      }
      // Task pill
      const pill = e.target.closest('.schedule-task-pill');
      if (pill){
        window.scheduleTaskModal.openTask(pill.dataset.taskId);
        return;
      }
      // Slot
      const slot = e.target.closest('.calendar-slot');
      if (slot){
        window.scheduleTaskModal.openSlot(slot.dataset.date);
      }
    });
  }
})();
