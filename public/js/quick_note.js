const quickNotesContainer = document.getElementById('quickNotes');
const deleteOldNotesBtn = document.getElementById('deleteOldNotes');

async function loadQuickNotes() {
  const response = await fetch('/quicknote/get_all');
  const notes = await response.json();
  quickNotesContainer.innerHTML = notes.map(note => `
    <div class="row quick-note">
      <div class="col-9">
        <p>${note.content}</p>
        <small>${new Date(note.timestamp).toLocaleString()}</small>
        ${note.nearestLocation ? `
          <p>Near: ${note.nearestLocation.name} (${note.nearestLocation.distance.toFixed(2)} meters away)</p>
        ` : ''}
      </div>
      <div class="col-3">
        <button onclick="deleteNote('${note._id}')">Delete</button>
      </div>
    </div>
  `).join('');
}

async function deleteNote(id) {
  const response = await fetch(`/quicknote/delete/${id}`, { method: 'DELETE' });
  const data = await response.json();
  if (data.success) {
    loadQuickNotes();
  }
}

deleteOldNotesBtn.addEventListener('click', async () => {
  const response = await fetch('/quicknote/delete_old', { method: 'DELETE' });
  const data = await response.json();
  if (data.success) {
    loadQuickNotes();
  }
});

loadQuickNotes();
