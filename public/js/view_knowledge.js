// Set action button
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
setActionButton("Know top", KnowledgeTop);

function KnowledgeTop() {
  open("/chat4/knowledgelist", "_self");
}

function CopyKnowledge(e) {
  navigator.clipboard.writeText(`# ${e.dataset.title}\n\n${e.dataset.content}`);
}

async function AutoTagRecipe(e) {
  // POST: /chat4/generateTagsForRecipe
  // BODY: title, content
  const response = await fetch("/chat4/generateTagsForRecipe", {
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
    body: JSON.stringify({title: e.dataset.title, content: e.dataset.content}), // body data type must match "Content-Type" header
  });
  const data = await response.json();
  document.getElementById("k_tags").value = data.response.split('\n').join('').split('```').join('');
}
