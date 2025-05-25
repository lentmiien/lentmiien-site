/* globals bootstrap, scheduleTaskState */

(function(){
  const taskModalEl = document.getElementById('taskModal');
  const slotModalEl = document.getElementById('slotModal');
  const taskModal   = new bootstrap.Modal(taskModalEl);
  const slotModal   = new bootstrap.Modal(slotModalEl);

  // Expose API
  window.scheduleTaskModal = { openTask, openSlot };

  /* ----- open task details ----- */
  function openTask(id){
    const task = scheduleTaskState.tasks.find(t=>t._id===id);
    if (!task) return;

    taskModalEl.querySelector('.modal-title').textContent = task.title;
    taskModalEl.querySelector('.modal-body').innerHTML = `
        <p>${task.description||''}</p>
        <p><strong>Type:</strong> ${task.type}</p>
        <p><strong>Start:</strong> ${task.start ? new Date(task.start).toLocaleString():'–'}</p>
        <p><strong>Deadline:</strong> ${task.end ? new Date(task.end).toLocaleString():'–'}</p>`;

    const editBtn = taskModalEl.querySelector('.btn-edit');
    editBtn.onclick = ()=>location.href=`/scheduleTask/edit/${task._id}`;
    taskModal.show();
  }

  /* ----- open slot details ----- */
  function openSlot(iso){
    const slotDate = new Date(iso);
    const slot = scheduleTaskState.slots.find(s=>+s.date === +slotDate);
    if (!slot) return;

    slotModalEl.querySelector('.modal-title').textContent = 
        slotDate.toLocaleString(undefined,{weekday:'long',hour:'2-digit',minute:'2-digit'});
    slotModalEl.querySelector('.modal-body').innerHTML = `
      <p><strong>Location:</strong> ${slot.presence ? slot.presence.location : 'home'}</p>
      <p><strong>Purpose:</strong> ${slot.presence ? slot.presence.purpose || '–' : '–'}</p>`;

    // CREATE buttons pre-fill form via query ?prefill=
    slotModalEl.querySelector('.btn-new-presence').onclick = ()=> 
        location.href=`/scheduleTask/new/presence?prefill=${iso}`;
    slotModalEl.querySelector('.btn-new-task').onclick = ()=>
        location.href=`/scheduleTask/new/task?prefill=${iso}`;

    slotModal.show();
  }
})();
