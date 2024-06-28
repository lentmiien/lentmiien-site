const tableContainer = document.querySelector('.table-container');
const tableBody = document.querySelector('#calendar-table tbody');

let cache = {};
let loadedRange = { start: 0, end: 0 };

const ROWS_TO_LOAD = 10;

// Simulated API call to fetch data
function simulatedApiCall(startDate, endDate) {
    const data = [];
    let currentDate = new Date(startDate);
    const endDateObj = new Date(endDate);

    while (currentDate <= endDateObj) {
        const dateString = currentDate.toISOString().split('T')[0];
        data.push({
            date: dateString,
            data: Math.random().toFixed(2) // Simulating random data
        });
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return new Promise((resolve) => {
        setTimeout(() => resolve(data), 10); // Simulating network delay
    });
}

function createRow(rowData) {
    const row = document.createElement('tr');
    
    const dateCell = document.createElement('td');
    dateCell.textContent = rowData.date;
    row.appendChild(dateCell);

    const dataCell = document.createElement('td');
    dataCell.textContent = rowData.data;
    row.appendChild(dataCell);

    return row;
}

function cacheData(data) {
    data.forEach(item => {
        cache[item.date] = item;
    });
}

async function loadData(startDate, endDate) {
    const data = await simulatedApiCall(startDate, endDate);
    cacheData(data);
    return data;
}

function renderTable(startIndex) {
    tableBody.innerHTML = '';

    for (let i = startIndex; i < startIndex + ROWS_TO_LOAD; i++) {
        const currentDate = getDateFromIndex(i).toISOString().split('T')[0];
        const data = cache[currentDate];
        
        if (data) {
            tableBody.appendChild(createRow(data));
        } else {
            // Placeholder row until data is loaded
            const row = document.createElement('tr');
            row.innerHTML = `<td>Loading...</td><td>Loading...</td>`;
            tableBody.appendChild(row);
        }
    }
}

async function handleScroll(e) {
  if (e.deltaY < 0 && loadedRange.start > 0) {
    loadedRange.start--;
    loadedRange.end--;
  } else if (e.deltaY > 0) {
    loadedRange.start++;
    loadedRange.end++;
  }
  const startDate = getDateFromIndex(loadedRange.start).toISOString().split('T')[0];
  const endDate = getDateFromIndex(loadedRange.end).toISOString().split('T')[0];
  await loadData(startDate, endDate);
  renderTable(loadedRange.start);
}

function getDateFromIndex(index) {
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() + index);
    return baseDate;
}

async function initialize() {
    const startDate = getDateFromIndex(0).toISOString().split('T')[0];
    const endDate = getDateFromIndex(ROWS_TO_LOAD - 1).toISOString().split('T')[0];
    const initialData = await loadData(startDate, endDate);
    loadedRange.start = 0;
    loadedRange.end = initialData.length;
    renderTable(loadedRange.start);
}

tableContainer.addEventListener('wheel', handleScroll);
initialize();