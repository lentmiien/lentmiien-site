function SelectTemplate(e) {
  const element = document.getElementById(e.value);
  document.getElementById("title").value = element.dataset.title;
  document.getElementById("type").value = element.dataset.type;
  document.getElementById("category").value = element.dataset.category;
  document.getElementById("text").value = element.dataset.templatetext;
}