let health_log_array = []; 

async function fetchHealthLogs(startDate, endDate) {
  try {
    const res = await fetch(`/health/health-entries?start=${startDate}&end=${endDate}`);
    if (!res.ok) throw new Error('Error fetching health logs');
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch health logs:', error);
    return [];
  }
}

function UpdateHealthLog(entries_array, start_date, end_date) {
  // Clear previous content
  let healthLogTable = document.querySelector('#health_log');
  healthLogTable.innerHTML = '';

  for (let date = new Date(start_date); date <= new Date(end_date); date.setDate(date.getDate() + 1)) {
    let formattedDate = date.toISOString().split('T')[0];
    let entry = entries_array.find(e => e.dateOfEntry === formattedDate);
    
    let row = document.createElement('tr');
    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${entry ? (Object.keys(entry.basicData)).length : 'N/A'}</td>
      <td>${entry ? (Object.keys(entry.medicalRecord)).length : 'N/A'}</td>
      <td>${entry ? entry.diary.length : 'N/A'}</td>
      <td>
        ${entry ? `<button class="btn btn-info" onclick="ViewHealthLogEntry('${formattedDate}')">View</button>` : ''}
        <a href="/health/edit/${formattedDate}" class="btn btn-primary">Edit</a>
      </td>
    `;
    healthLogTable.appendChild(row);
  }
}

async function UpdateHealthLogDisplay() {
  let startDate = document.querySelector('#start_date').value;
  let endDate = document.querySelector('#end_date').value;
  
  // Fetch relevant data from API endpoint
  let data = await fetchHealthLogs(startDate, endDate);
  health_log_array = data.data || [];
  
  UpdateHealthLog(health_log_array, startDate, endDate);
}

async function ViewHealthLogEntry(date) {
  let entry = health_log_array.find(e => e.dateOfEntry === date);

  // Fetch Chat3 messages
  let message_lookup = {};
  if (entry.diary.length > 0) {
    const response = await fetch('/chat3/fetch_messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ids: entry.diary})
    });
    const result = await response.json();
    message_lookup = result;
    console.log(result);
  }
  
  // Populate and display popup
  let detailsContent = document.querySelector('#detailsContent');
  detailsContent.innerHTML = `
    <strong>Basic Data:</strong> ${JSON.stringify(entry.basicData)}<br>
    <strong>Medical Record:</strong> ${JSON.stringify(entry.medicalRecord)}<br>
    <strong>Diary:</strong>
  `;
  entry.diary.forEach(d => {
    detailsContent.innerHTML += `<hr>${message_lookup[d]}`;
  });

  let detailsPopup = new bootstrap.Modal(document.getElementById('detailsPopup'));
  detailsPopup.show();
}

function HidePopup() {
  let detailsPopup = bootstrap.Modal.getInstance(document.getElementById('detailsPopup'));
  detailsPopup.hide();
}

function OpenEditDate() {
  let date = document.querySelector('#edit_date').value;
  window.location.href = `/health/edit/${date}`;
}

document.addEventListener('DOMContentLoaded', () => {
  let today = new Date();
  let lastMonth = new Date();
  lastMonth.setDate(today.getDate() - 30);

  document.querySelector('#start_date').value = lastMonth.toISOString().split('T')[0];
  document.querySelector('#end_date').value = today.toISOString().split('T')[0];

  UpdateHealthLogDisplay();
});