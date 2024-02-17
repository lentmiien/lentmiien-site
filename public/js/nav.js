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
