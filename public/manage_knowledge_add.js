function ChangeForm(element) {
  const selected_index = parseInt(element.value);
  const all_forms = document.getElementsByClassName("kform-container");

  for (let i = 0; i < all_forms.length; i++) {
    if (i === selected_index) {
      all_forms[i].classList.remove("hidden");
    } else {
      all_forms[i].classList.add("hidden");
    }
  }
}