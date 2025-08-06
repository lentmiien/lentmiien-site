function Filter(e) {
  const v = e.value;
  const elms = document.getElementsByClassName("entry");
  for (let i = 0; i < elms.length; i++) {
    if (v.length === 0) elms[i].style.display = "block";
    else if (elms[i].dataset.category === v) elms[i].style.display = "block";
    else elms[i].style.display = "none";
  }
}