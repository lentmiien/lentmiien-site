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
      width: box.getAttribute('data-width'),
      height: box.getAttribute('data-height'),
      depth: box.getAttribute('data-depth'),
      box_weight: box.getAttribute('data-box_weight')
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
      // Handle successful response here (e.g., update the UI)
  })
  .catch((error) => {
      console.error('Error:', error);
      // Handle error conditions here
  });
}
