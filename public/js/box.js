function submitPackingRequest() {
  // Parsing items from the textarea; assuming CSV format without header
  const itemsInput = document.getElementById('items').value.trim();
  const items = itemsInput.split("\n").map(line => {
      const [id, count, width, height, depth, weight, flags] = line.split(",");
      return { id, count: parseInt(count, 10), width: parseInt(width), height: parseInt(height), depth: parseInt(depth), weight: parseInt(weight), flags };
  });

  // Gathering selected box types
  const boxes = Array.from(document.querySelectorAll('input[name="box"]:checked')).map(box => ({
      id: box.getAttribute('data-id'),
      width: parseInt(box.getAttribute('data-width')),
      height: parseInt(box.getAttribute('data-height')),
      depth: parseInt(box.getAttribute('data-depth')),
      box_weight: parseInt(box.getAttribute('data-box_weight'))
  }));

  // Getting the margin and approach
  const margin = parseFloat(document.getElementById('margin').value);
  const method = document.getElementById('method').value;

  // Constructing the request body
  const requestBody = {
      items,
      boxes,
      margin,
      method
  };

  console.log(requestBody);

  // Sending the POST request
  fetch('/box/pack', {
      method: 'POST',
      headers: {
          'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
  })
  .then(response => response.json())
  .then(data => {
      console.log('Success:', data);
      if (data.success) {
        let output = '';
        data.packedItemsInBoxes.forEach(d => {
            let total_weight = d.box_weight;
            output += `<u>BOX: <b>${d.id}</b> (${d.box_weight}g)</u><br>`;
            let tbody = '';
            d.items_in_box.forEach(item => {
                total_weight += item.weight;
                tbody += `<tr><td>${item.id}</td><td>${item.x_pos}, ${item.y_pos}, ${item.z_pos}</td><td>${item.x_size} x ${item.y_size} x ${item.z_size}</td><td>${item.weight}</td></tr>`;
            });
            output += `<table class="table table-striped"><thead><tr><th>Item</th><th>Possition</th><th>Size</th><th>Weight</th></tr></thead><tbody>${tbody}</tbody></table><i>Total weight: ${total_weight}g</i>`;
        });
        document.getElementById("output").innerHTML = output;
      } else {
        document.getElementById("output").innerText = data.message;
      }
  })
  .catch((error) => {
      console.error('Error:', error);
      // Handle error conditions here
  });
}

function runTest() {
  // Sending the POST request
  fetch('/box/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  .then(response => response.json())
  .then(data => {
    console.log('Success:', data);
    let output = '';
    data.test_solutions.forEach(d => {
      output += `<hr><u>BOX: <b>${d.solution[0].id}</b></u><br>`;
      let tbody = '';
      d.solution[0].items_in_box.forEach(item => {
        tbody += `<tr><td>${item.id}</td><td>${item.x_pos}, ${item.y_pos}, ${item.z_pos}</td><td>${item.x_size} x ${item.y_size} x ${item.z_size}</td><td>${item.weight}</td></tr>`;
      });
      d.alternative.forEach(item => {
        tbody += `<tr><td></td><td>${item[0].id}</td><td>${item[1].id}</td><td>${item[2].id}</td></tr>`;
      });
      output += `<table class="table table-striped"><thead><tr><th>Item</th><th>Possition</th><th>Size</th><th>Weight</th></tr></thead><tbody>${tbody}</tbody></table>`;
    });
    document.getElementById("output").innerHTML = `<b>Avg.time ${data.average_time}s</b><br><pre>${JSON.stringify(data.orderData, null, 2)}</pre>` + output;
    // document.getElementById("output").innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
  })
  .catch((error) => {
    console.error('Error:', error);
    // Handle error conditions here
  });
}
