const products = JSON.parse(document.getElementById("products").innerHTML);
const data_list = document.getElementById("data_list");
const content = document.getElementById("content");
const output = document.getElementById("output");

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
    data = await csvToJson(file.binary.toString());

    // Check if any of the entries exist in `products`
    const post_data = [];
    for (let i = 0; i < data.length; i++) {
      let found = false;
      for (let j = 0; j < products.length; j++) {
        if (data[i][0] === products[j].product_code) {
          found = true;
          break;
        }
      }
      if (found) continue;
      else post_data.push(data[i]);
    }
    // For non-existing entries, send to `/product/upload_product_data` as POST request
    if (post_data.length > 0) {
      const response = await fetch("/product/upload_product_data", {
        method: "POST", // *GET, POST, PUT, DELETE, etc.
        mode: "cors", // no-cors, *cors, same-origin
        cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
        credentials: "same-origin", // include, *same-origin, omit
        headers: {
          "Content-Type": "application/json",
          // 'Content-Type': 'application/x-www-form-urlencoded',
        },
        redirect: "follow", // manual, *follow, error
        referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
        body: JSON.stringify({data: post_data}), // body data type must match "Content-Type" header
      });
      const resp = await response.json();
      // When getting response, append to `products`
      console.log(resp);
      resp.forEach(d => {
        products.push(d);
        data_list.innerHTML += `<tr title="${d.ai_description}"><td>${d.product_code}</td><td><button class="btn btn-primary" onclick="Details('${d.product_code}')">Details</button><button class="btn btn-danger" onclick="Delete('${d.product_code}')">Delete</button></td></tr>`;
      });
    }
    // Get the requested data from `products`, and display to user
    output.innerHTML = '';
    for (let i = 0; i < data.length; i++) {
      for (let j = 0; j < products.length; j++) {
        if (data[i][0] === products[j].product_code) {
          output.innerHTML += `<hr><b>${products[j].product_code}</b>${marked.parse(products[j].ai_description)}`;
          break;
        }
      }
    }
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

const csvToJson = async (string) => {
  const result = await csv({
    noheader: true,
    output: "csv",
  })
  .fromString(string);
  return result;
}

let index = -1;
function Details(product_code) {
  for (let j = 0; j < products.length; j++) {
    if (product_code === products[j].product_code) {
      document.getElementById('id').value = products[j]._id.toString();
      document.getElementById('content').value = products[j].ai_description;
      index = j;
      break;
    }
  }
}

async function Update() {
  if (index === -1) return;
  index = -1;

  products[index].ai_description = document.getElementById('content').value;

  await fetch("/product/update_product", {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify({id: document.getElementById('id').value, content: document.getElementById('content').value}), // body data type must match "Content-Type" header
  });

  document.getElementById('id').value = "";
  document.getElementById('content').value = "";
}

async function Delete(product_code) {
  let id = null;
  for (let j = 0; j < products.length; j++) {
    if (product_code === products[j].product_code) {
      id = products[j]._id.toString();
      break;
    }
  }

  if (id) {
    await fetch("/product/delete_product", {
      method: "POST", // *GET, POST, PUT, DELETE, etc.
      mode: "cors", // no-cors, *cors, same-origin
      cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
      credentials: "same-origin", // include, *same-origin, omit
      headers: {
        "Content-Type": "application/json",
        // 'Content-Type': 'application/x-www-form-urlencoded',
      },
      redirect: "follow", // manual, *follow, error
      referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
      body: JSON.stringify({id}), // body data type must match "Content-Type" header
    });
  }
}
