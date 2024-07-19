const loadingPopup = document.getElementById("loadingPopup");

async function StartBatch() {
  showLoadingPopup();
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
  // Update status
  status.ids.forEach((d) => {
    document.getElementById(d).classList.remove("pending");
    document.getElementById(d).classList.add("processing");
  });
  // Add new request
  status.requests.forEach(request => {
    if ("id" in request) {
      console.log(request);
      const prompt_entry_div = document.createElement("div");
      const id_b = document.createElement("b");
      const content_div = document.createElement("div");
      const start_div = document.createElement("div");
      const end_div = document.createElement("div");
      const time_div = document.createElement("div");
      const count_div = document.createElement("div");
      const refresh_button = document.createElement("button");
      prompt_entry_div.append(id_b, content_div);
      content_div.append(start_div, end_div, time_div, count_div);
      content_div.append(refresh_button);
      prompt_entry_div.classList.add("prompt-entry", "pending");
      prompt_entry_div.id = request.id;
      id_b.innerText = request.id;
      start_div.innerText = `Start: ${(new Date(request.created_at)).toLocaleString()}`;
      end_div.innerText = `End: ${(new Date(request.completed_at)).toLocaleString()}`;
      const t = (new Date(request.completed_at)).getTime() - (new Date(request.created_at)).getTime();
      time_div.innerText = `Time: ${Math.floor(t/(1000*60*60))} h, ${Math.floor(t/(1000*60))%60} m, ${Math.floor(t/(1000))%60} s`;
      count_div.innerText = `0/0/0`;
      refresh_button.classList.add("btn", "btn-primary");
      refresh_button.setAttribute("onclick", `BatchRefresh('${request.id}')`);
      refresh_button.innerText = "Refresh";
      document.getElementById("request_container").prepend(prompt_entry_div);
    }
  });
  hideLoadingPopup();
}

const end_statuses = ['failed', 'completed', 'expired', 'cancelled', 'DONE'];

async function BatchRefresh(batch_id) {
  showLoadingPopup();
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
  hideLoadingPopup();
}

async function ProcessCompleted() {
  showLoadingPopup();
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
  status.requests.forEach(d => {
    document.getElementById(d).classList.remove("processing");
    document.getElementById(d).classList.add("completed");
  });
  status.prompts.forEach(d => {
    document.getElementById(d).classList.remove("processing");
    document.getElementById(d).classList.add("completed");
  });
  hideLoadingPopup();
}

function showLoadingPopup() {
  loadingPopup.style.display = 'block';
}
function hideLoadingPopup() {
  loadingPopup.style.display = 'none';
}

// Set action button
const actionBtn = document.getElementById("actionBtn");
let currentEvent = null;
function setActionButton(text, func) {
  actionBtn.innerText = text;
  actionBtn.style.cursor = "pointer";
  actionBtn.disabled = false;
  if (currentEvent) {
    actionBtn.removeEventListener("click", currentEvent)
  }
  actionBtn.addEventListener("click", func);
  currentEvent = func;
}
setActionButton("Chat", Chat4Top);

function Chat4Top() {
  open("/chat4", "_self");
}
