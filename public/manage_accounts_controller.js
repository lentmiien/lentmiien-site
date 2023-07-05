async function DeleteAccount(db_id) {
  // Send delete request to API
  const rawResponse = await fetch('/accounting/api/accounts', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({request:"DELETE",id:db_id})
  });
  const content = await rawResponse.json();

  // Delete entry from account list (on current page)
  document.getElementById(db_id).remove();
}

async function AddAccount() {
  // Gather up data
  const name = document.getElementById("name").value;
  const balance = document.getElementById("balance").value;
  const balance_date = document.getElementById("balance_date").value;
  const currency = document.getElementById("currency").value;
  if (name.length === 0 ||
      balance.length === 0 ||
      balance_date.length === 0) {
        alert("Please fill in all details!");
        return;
  }

  // Send add request to API
  const rawResponse = await fetch('/accounting/api/accounts', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({request:"ADD",data:{name, balance, balance_date, currency}})
  });
  const content = await rawResponse.json();

  // Add entry to account list (on current page)
  const div = document.createElement('div');
  div.id = content.account._id;
  div.classList.add("card", content.account.balance >= 0 ? "income" : "expense");
  div.innerHTML = `<h2>${content.account.name}</h2>`;
  div.innerHTML += `<i>Balance at ${content.account.balance_date} is <b>${content.account.balance} ${content.account.currency}</b></i>`;
  div.innerHTML += `<hr>`;
  div.innerHTML += `<button class="btn btn-danger" onclick="DeleteAccount('${content.account._id}')">Delete account</button>`;
  document.getElementById("accounts").append(div);
  
  // Clear input fields
  document.getElementById("name").value = "";
  document.getElementById("balance").value = "";
  document.getElementById("balance_date").value = "";
  document.getElementById("currency").value = "JPY";
}