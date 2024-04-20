function FilterCategory(element) {
  const category_containers = document.getElementsByClassName("category_container");
  for (let i = 0; i < category_containers.length; i++) {
    category_containers[i].style.display = element.value === "" ? "block" : "none";
  }
  if (element.value.length > 0) {
    document.getElementById(`${element.value}_container`).style.display = "block";
  }
}

function FilterTag(element) {
  //.tag_container(data-tags=`|${c.tags.join('|')}|`)
  const tag_containers = document.getElementsByClassName("tag_container");
  for (let i = 0; i < tag_containers.length; i++) {
    tag_containers[i].style.display = element.value === "" || tag_containers[i].dataset.tags.indexOf(`|${element.value}|`) >= 0 ? "inline" : "none";
  }
}
