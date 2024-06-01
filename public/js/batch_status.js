async function StartBatch() {
  // /chat4/batch_start
  const response = await fetch("/chat4/batch_start", {
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
    body: '{}', // body data type must match "Content-Type" header
  });
  const status = await response.json();
  status.forEach((d) => {
    document.getElementById(d).classList.remove("pending");
    document.getElementById(d).classList.add("processing");
  });
}

const end_statuses = ['failed', 'completed', 'expired', 'cancelled', 'DONE'];

async function BatchRefresh(batch_id) {
  if (document.getElementById(batch_id).classList.contains('completed')) return;

  // /chat4/batch_update/:batch_id
  const response = await fetch(`/chat4/batch_update/${batch_id}`, {
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
    body: '{}', // body data type must match "Content-Type" header
  });
  const status = await response.json();
  if (end_statuses.indexOf(status.status) >= 0) {
    document.getElementById(status.id).classList.remove("pending");
    document.getElementById(status.id).classList.add("processing");
  }
}

async function ProcessCompleted() {
  // /chat4/batch_import
  const response = await fetch(`/chat4/batch_import`, {
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
    body: '{}', // body data type must match "Content-Type" header
  });
  const status = await response.json();
  status.forEach(d => {
    document.getElementById(d).classList.remove("processing");
    document.getElementById(d).classList.add("completed");
  });
}
