function CopyCode(element) {
  let temp_textarea = document.createElement("textarea");
  temp_textarea.value = element.innerHTML;
  document.body.appendChild(temp_textarea);
  temp_textarea.select();
  document.execCommand("copy");
  document.body.removeChild(temp_textarea);

  alert("Copied the text!");
}
