const current_templates = JSON.parse(document.getElementById("current_templates").innerText);
const backward_templates = JSON.parse(document.getElementById("backward_templates").innerText);
const knowledges = JSON.parse(document.getElementById("knowledges").innerText);

const version = document.getElementById("version");

function UpdateVersion(element) {
  const title = element.value;
  version.value = 1;
  current_templates.forEach(t => {
    if (t.title === title) {
      version.value = t.version + 1;
    }
  });
}