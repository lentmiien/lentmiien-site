async function DeleteCategory(db_id) {
  // Send delete request to API
  const rawResponse = await fetch('/accounting/api/categories', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({request:"DELETE",id:db_id})
  });
  const content = await rawResponse.json();

  console.log(content);

  // Delete entry from account list (on current page)
  document.getElementById(db_id).remove();
}

async function AddCategory() {
  // Gather up data
  const title = document.getElementById("title").value;
  const type = document.getElementById("type").value;
  if (title.length === 0) {
    alert("Please fill in all details!");
    return;
  }

  // Send add request to API
  const rawResponse = await fetch('/accounting/api/categories', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({request:"ADD",data:{title, type}})
  });
  const content = await rawResponse.json();

  // Add entry to account list (on current page)
  const div = document.createElement('div');
  div.id = content.category._id;
  div.classList.add("card", content.category.type);
  div.innerHTML = `<h2>${content.category.title}</h2>`;
  div.innerHTML += `<hr>`;
  div.innerHTML += `<button class="btn btn-danger" onclick="DeleteCategory('${content.category.id}')">Delete account</button>`;
  document.getElementById("categories").append(div);
  
  // Clear input fields
  document.getElementById("title").value = "";
  document.getElementById("type").value = "income";
}