// Modal logic for displaying/editing slot or task details
window.scheduleTaskModal = {
  openTask(id) {
    // Fetch via API if needed, or look up in memory
    // For demo, use Bootstrap modal with dummy data
    const task = {}; // populate from cached data or AJAX
    // Set modal fields
    const $m = document.getElementById('taskModal');
    $m.querySelector('.modal-title').textContent = task.title;
    $m.querySelector('.modal-body').textContent = task.description;
    // Show modal (Bootstrap)
    new bootstrap.Modal($m).show();
  },
  openSlot(idx) {
    // Use slot index to show details or create form
    // ...fill modal fields
    new bootstrap.Modal(document.getElementById('slotModal')).show();
  }
};
