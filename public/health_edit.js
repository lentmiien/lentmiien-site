function DeleteRow(button) {
  button.closest('tr').remove();
}

function AddRow(tableID) {
  const table = document.querySelector(`#${tableID}`);
  const row = table.insertRow(-1); // Insert at the end of the table
  const cell1 = row.insertCell(0);
  const cell2 = tableID === 'diary' ? null : row.insertCell(1);
  const cell3 = row.insertCell(tableID === 'diary' ? 1 : 2);
  
  cell1.innerHTML = '<input class="form-control" type="text">';
  if (cell2) cell2.innerHTML = '<input class="form-control" type="text">';
  cell3.innerHTML = '<button class="btn btn-danger" onclick="DeleteRow(this)">Delete</button>';
}

async function SaveToDatabase() {
  const date = document.querySelector('#date').innerText;
  const isNewEntry = document.querySelector('#new_entry').checked;
  const url = `/health/health-entries${isNewEntry ? '' : '/' + date}`;
  const method = isNewEntry ? 'POST' : 'PUT';

  const basicData = {};
  document.querySelector('#basicData').querySelectorAll('tr').forEach((row, idx) => {
    if (idx === 0) return; // Skip header row
    const [metric, value] = row.querySelectorAll('input');
    basicData[metric.value] = value.value;
  });

  const medicalRecord = {};
  document.querySelector('#medicalRecord').querySelectorAll('tr').forEach((row, idx) => {
    if (idx === 0) return; // Skip header row
    const [metric, value] = row.querySelectorAll('input');
    medicalRecord[metric.value] = value.value;
  });

  const diary = Array.from(document.querySelector('#diary').querySelectorAll('input')).map(input => input.value);

  const data = {dateOfEntry: date, basicData, medicalRecord, diary};

  try {
    const response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    console.log('Success:', result);
    alert('Entry updated successfully!');
    if(isNewEntry) window.location.href = `/health/edit/${date}`; // Redirect to edit existing entry after creating a new one
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to update entry.');
  }
}