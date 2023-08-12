const content = document.getElementsByClassName("openai_conversation");

function filter(input_element) {
  const query = input_element.value;
  for (let i = 0; i < content.length; i++) {
    if (content[i].innerHTML.indexOf(query) >= 0) {
      content[i].classList.remove('hidden');
    } else {
      content[i].classList.add('hidden');
    }
  }
}