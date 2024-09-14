const products = JSON.parse(document.getElementById("products").innerHTML);

const content = document.getElementById("content");

// Detect input file and generate HS editor
window.addEventListener('load', function () {
  // These variables are used to store the input data
  const file = {
    dom: document.getElementById('process_file'),
    binary: null,
  };

  // Use the FileReader API to access file content
  const reader = new FileReader();

  // Because FileReader is asynchronous, store its
  // result when it finishes to read the file
  reader.addEventListener('load', async function () {
    file.binary = reader.result;

    // Convert input data (csv) to JSON data
    data = csvToJson(file.binary.toString());

    console.log(data);
  });

  // At page load, if a file is already selected, read it.
  if (file.dom.files[0]) {
    reader.readAsText(file.dom.files[0]);
  }

  // If not, read the file once the user selects it.
  file.dom.addEventListener('change', function () {
    if (reader.readyState === FileReader.LOADING) {
      reader.abort();
    }
    reader.readAsText(file.dom.files[0]);
  });
});

const csvToJson = (string) => {
  const output = [];
  const rows = string.split(`***`);
  rows.forEach(row => {
    if (row.length > 0) {
      output.push(row.split('|'));
    }
  });
  return output;
}


function Details(product_code) {}