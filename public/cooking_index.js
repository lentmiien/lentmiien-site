async function AddUpdateCookingCalendar(date, type) {
  // Get data from input fields
  const s = document.getElementById(`${date}${type}_select`);

  const select_value = s.value;
  const food_name = s.options[s.selectedIndex].text;

  // Send POST request to server '/cooking/update_cooking_calendar'
  const post_data = {
    date,
    [type]: select_value,
  };
  const response = await fetch("/cooking/update_cooking_calendar", {
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
    body: JSON.stringify(post_data), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);

  // When get "OK" response, update entry text
  document.getElementById(`${date}${type}`).innerText = food_name;

  // If not "OK", then display error message
}

function EditDate() {
  const date = document.getElementById("edate").value;
  open(`/cooking/edit_date?date=${date}`, '_self');
}