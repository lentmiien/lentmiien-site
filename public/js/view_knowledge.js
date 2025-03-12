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
