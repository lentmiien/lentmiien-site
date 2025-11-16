function DeleteRow(button) {
  button.closest('tr').remove();
}

function AddRow(tableID) {
  const table = document.querySelector(`#${tableID}`);
  const row = table.insertRow(-1);

  if (tableID === 'diary') {
    row.innerHTML = `
      <td><input class="form-control" type="text" placeholder="entry id"></td>
      <td><button class="btn btn-danger" onclick="DeleteRow(this)">Delete</button></td>
    `;
    return;
  }

  if (tableID === 'thresholds') {
    row.innerHTML = `
      <td><input class="form-control" type="text" placeholder="metric"></td>
      <td><input class="form-control" type="number" step="any" placeholder="min"></td>
      <td><input class="form-control" type="number" step="any" placeholder="max"></td>
      <td><button class="btn btn-danger" onclick="DeleteRow(this)">Delete</button></td>
    `;
    return;
  }

  row.innerHTML = `
    <td><input class="form-control" type="text" placeholder="metric"></td>
    <td><input class="form-control" type="text" placeholder="value"></td>
    <td><button class="btn btn-danger" onclick="DeleteRow(this)">Delete</button></td>
  `;
}

const extractKeyValuePairs = (selector) => {
  const dataset = {};
  document.querySelector(selector).querySelectorAll('tr').forEach((row, idx) => {
    if (idx === 0) return;
    const inputs = row.querySelectorAll('input');
    if (inputs.length < 2) return;
    const key = inputs[0].value.trim();
    const value = inputs[1].value.trim();
    if (!key) return;
    dataset[key] = value;
  });
  return dataset;
};

const extractThresholds = () => {
  const thresholds = {};
  document.querySelector('#thresholds').querySelectorAll('tr').forEach((row, idx) => {
    if (idx === 0) return;
    const inputs = row.querySelectorAll('input');
    if (inputs.length < 3) return;
    const metric = inputs[0].value.trim();
    if (!metric) return;
    const min = inputs[1].value.trim();
    const max = inputs[2].value.trim();
    thresholds[metric] = {};
    if (min !== '') thresholds[metric].min = Number(min);
    if (max !== '') thresholds[metric].max = Number(max);
    if (!Object.keys(thresholds[metric]).length) {
      delete thresholds[metric];
    }
  });
  return thresholds;
};

async function SaveToDatabase() {
  const date = document.querySelector('#date').innerText;
  const isNewEntry = document.querySelector('#new_entry').checked;
  const url = `/health/health-entries${isNewEntry ? '' : '/' + date}`;
  const method = isNewEntry ? 'POST' : 'PUT';

  const basicData = extractKeyValuePairs('#basicData');
  const medicalRecord = extractKeyValuePairs('#medicalRecord');
  const diary = Array.from(document.querySelector('#diary').querySelectorAll('tr'))
    .slice(1)
    .map((row) => {
      const input = row.querySelector('input');
      return input ? input.value.trim() : '';
    })
    .filter((value) => value.length);

  const data = {
    dateOfEntry: date,
    basicData,
    medicalRecord,
    diary,
    measurementType: document.querySelector('#measurementType').value.trim(),
    measurementContext: document.querySelector('#measurementContext').value.trim(),
    tags: document.querySelector('#tags').value,
    notes: document.querySelector('#notes').value,
    personalizedThresholds: extractThresholds(),
  };

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.message || 'Failed to update entry');
    }
    alert('Entry saved successfully!');
    if (isNewEntry) window.location.href = `/health/edit/${date}`;
  } catch (error) {
    console.error('Error:', error);
    alert(`Failed to update entry: ${error.message}`);
  }
}
