const quickNotesContainer = document.getElementById('quickNotes');
const deleteOldNotesBtn = document.getElementById('deleteOldNotes');
const sortStatus = document.getElementById('quickNotesSortStatus');
const sortButtons = Array.from(document.querySelectorAll('[data-sort-mode]'));

const SORT_MODES = {
  NEWER: 'newer',
  CLOSER: 'closer'
};

const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  maximumAge: 60 * 1000,
  timeout: 10 * 1000
};

const GEOLOCATION_ERROR_CODES = {
  PERMISSION_DENIED: 1,
  POSITION_UNAVAILABLE: 2,
  TIMEOUT: 3
};

let quickNotes = [];
let sortMode = SORT_MODES.NEWER;
let currentLocation = null;
let currentLocationPromise = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toRadians(angleInDegrees) {
  return angleInDegrees * Math.PI / 180;
}

function computeDistanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadiusMeters = 6371e3;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) {
    return 'Unknown distance';
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }

  return `${meters.toFixed(meters >= 100 ? 0 : 1)} m`;
}

function getCoordinates(note) {
  const coordinates = note?.location?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const longitude = Number(coordinates[0]);
  const latitude = Number(coordinates[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function getTimestampMs(note) {
  const timestamp = new Date(note?.timestamp || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getCurrentDistanceMeters(note) {
  if (!currentLocation) {
    return Number.POSITIVE_INFINITY;
  }

  const coordinates = getCoordinates(note);
  if (!coordinates) {
    return Number.POSITIVE_INFINITY;
  }

  return computeDistanceMeters(
    currentLocation.latitude,
    currentLocation.longitude,
    coordinates.latitude,
    coordinates.longitude
  );
}

function compareByCurrentDistance(left, right) {
  const leftDistance = getCurrentDistanceMeters(left);
  const rightDistance = getCurrentDistanceMeters(right);
  const leftHasDistance = Number.isFinite(leftDistance);
  const rightHasDistance = Number.isFinite(rightDistance);

  if (leftHasDistance && rightHasDistance && leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }

  if (leftHasDistance !== rightHasDistance) {
    return leftHasDistance ? -1 : 1;
  }

  return getTimestampMs(right) - getTimestampMs(left);
}

function getSortedQuickNotes() {
  const notes = quickNotes.slice();

  if (sortMode === SORT_MODES.CLOSER && currentLocation) {
    notes.sort(compareByCurrentDistance);

    return notes;
  }

  notes.sort((left, right) => getTimestampMs(right) - getTimestampMs(left));
  return notes;
}

function updateSortButtons() {
  sortButtons.forEach((button) => {
    const buttonMode = button.dataset.sortMode;
    const isActive = buttonMode === sortMode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function setSortStatus(message) {
  if (sortStatus) {
    sortStatus.textContent = message;
  }
}

function updateSortStatus() {
  if (sortMode === SORT_MODES.CLOSER && currentLocation) {
    setSortStatus('Sorted closer first using your current location.');
    return;
  }

  setSortStatus('Sorted newer first.');
}

function renderQuickNotes() {
  updateSortButtons();
  updateSortStatus();

  const notes = getSortedQuickNotes();
  if (!notes.length) {
    quickNotesContainer.innerHTML = '<p class="text-muted">No quick notes yet.</p>';
    return;
  }

  quickNotesContainer.innerHTML = notes.map((note) => {
    const currentDistanceMeters = getCurrentDistanceMeters(note);
    const currentDistanceMarkup = Number.isFinite(currentDistanceMeters)
      ? `<p class="mb-1"><strong>Current distance:</strong> ${escapeHtml(formatDistance(currentDistanceMeters))}</p>`
      : '';
    const nearestLocationMarkup = note?.nearestLocation?.name && Number.isFinite(Number(note?.nearestLocation?.distance))
      ? `<p class="mb-1"><strong>Near:</strong> ${escapeHtml(note.nearestLocation.name)} (${escapeHtml(formatDistance(Number(note.nearestLocation.distance)))} away)</p>`
      : '';

    return `
      <div class="row quick-note border rounded p-3 mb-3 align-items-start">
        <div class="col-12 col-md-9">
          <p class="mb-2">${escapeHtml(note.content).replace(/\n/g, '<br>')}</p>
          <small class="text-muted d-block mb-2">${escapeHtml(new Date(note.timestamp).toLocaleString())}</small>
          ${currentDistanceMarkup}
          ${nearestLocationMarkup}
        </div>
        <div class="col-12 col-md-3 d-flex justify-content-md-end mt-2 mt-md-0">
          <button class="btn btn-outline-danger btn-sm" type="button" data-delete-note-id="${escapeHtml(note._id)}">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function getGeolocationErrorMessage(error) {
  if (!error || typeof error.code !== 'number') {
    return 'Could not get your current location.';
  }

  if (error.code === GEOLOCATION_ERROR_CODES.PERMISSION_DENIED) {
    return 'Location permission was denied.';
  }

  if (error.code === GEOLOCATION_ERROR_CODES.POSITION_UNAVAILABLE) {
    return 'Your current location is unavailable.';
  }

  if (error.code === GEOLOCATION_ERROR_CODES.TIMEOUT) {
    return 'Getting your current location timed out.';
  }

  return 'Could not get your current location.';
}

function ensureCurrentLocation() {
  if (currentLocation) {
    return Promise.resolve(currentLocation);
  }

  if (!navigator.geolocation) {
    return Promise.reject(new Error('Geolocation is not supported in this browser.'));
  }

  if (!currentLocationPromise) {
    currentLocationPromise = new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          currentLocation = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          resolve(currentLocation);
        },
        (error) => {
          currentLocationPromise = null;
          reject(new Error(getGeolocationErrorMessage(error)));
        },
        GEOLOCATION_OPTIONS
      );
    });
  }

  return currentLocationPromise;
}

async function loadQuickNotes() {
  try {
    const response = await fetch('/quicknote/get_all');
    if (!response.ok) {
      throw new Error(`Failed to load quick notes (${response.status})`);
    }

    quickNotes = await response.json();
    renderQuickNotes();
  } catch (error) {
    console.error(error);
    quickNotes = [];
    quickNotesContainer.innerHTML = '<div class="alert alert-danger">Could not load quick notes.</div>';
    setSortStatus('Could not load quick notes.');
  }
}

async function deleteNote(id) {
  const response = await fetch(`/quicknote/delete/${id}`, { method: 'DELETE' });
  const data = await response.json();
  if (data.success) {
    loadQuickNotes();
  }
}

async function setSortMode(nextSortMode) {
  if (nextSortMode === sortMode) {
    return;
  }

  if (nextSortMode === SORT_MODES.CLOSER) {
    setSortStatus('Getting your current location...');
    try {
      await ensureCurrentLocation();
      sortMode = SORT_MODES.CLOSER;
      renderQuickNotes();
    } catch (error) {
      console.error(error);
      sortMode = SORT_MODES.NEWER;
      renderQuickNotes();
      setSortStatus(`${error.message} Showing newer first instead.`);
    }
    return;
  }

  sortMode = SORT_MODES.NEWER;
  renderQuickNotes();
}

sortButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setSortMode(button.dataset.sortMode);
  });
});

quickNotesContainer.addEventListener('click', (event) => {
  const deleteButton = event.target.closest('[data-delete-note-id]');
  if (!deleteButton) {
    return;
  }

  deleteNote(deleteButton.dataset.deleteNoteId);
});

deleteOldNotesBtn.addEventListener('click', async () => {
  const response = await fetch('/quicknote/delete_old', { method: 'DELETE' });
  const data = await response.json();
  if (data.success) {
    loadQuickNotes();
  }
});

loadQuickNotes();
