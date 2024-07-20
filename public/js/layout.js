const quickNoteForm = document.getElementById('quickNoteForm');
quickNoteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = document.getElementById('quickNoteInput').value;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      const response = await fetch('/quicknote/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, latitude, longitude })
      });
      const data = await response.json();
      if (data.success) {
        document.getElementById('quickNoteInput').value = '';
      }
    });
  }
});

const locationForm = document.getElementById('locationForm');
locationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('locationInput').value;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      const response = await fetch('/quicknote/add_location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, latitude, longitude })
      });
      const data = await response.json();
      if (data.success) {
        document.getElementById('locationInput').value = '';
      }
    });
  }
});
