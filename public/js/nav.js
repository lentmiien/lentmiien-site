function toggleNavbar() {
  var navbar = document.getElementById("navbar");
  var body = document.body;
  
  if (navbar.style.display === "grid") {
    navbar.style.display = "none";
    body.classList.remove("no-scroll");
  } else {
    navbar.style.display = "grid";
    body.classList.add("no-scroll");
  }
}

// Tooltip
let tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
let tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
  return new bootstrap.Tooltip(tooltipTriggerEl)
})

