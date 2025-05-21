const api = {
  async getTasks(from, to) {
    const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    return fetch(`/scheduleTask/api/tasks?${q}`).then(r => r.json());
  },
  async getPalette() {
    let pal = localStorage.getItem('schedulePalette');
    if (pal) return JSON.parse(pal);
    const p = await fetch('/scheduleTask/api/palette').then(r => r.json());
    localStorage.setItem('schedulePalette', JSON.stringify(p));
    return p;
  },
  async toggleDone(id, done) {
    console.log(id, done);
    return fetch(`/scheduleTask/api/tasks/${id}/done`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ done })
    }).then(r => r.json());
  },
  // Add POST/PATCH for create/update if making AJAX forms
};
window.scheduleTaskApi = api;
