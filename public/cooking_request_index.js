const knows = JSON.parse(document.getElementById("knows").innerText);
const content = document.getElementById("content");
const index = document.getElementById("index");
const user_id = document.getElementById("user_id");

function DisplayPage(num) {
  // Clear before drawing new content
  content.innerHTML = "";

  const name = document.createElement("h2");
  const br = document.createElement("br");
  const textcontent = document.createElement("div");

  name.innerText = knows[num].title;
  textcontent.innerHTML = marked.parse(knows[num].contentMarkdown);

  content.append(name, br);

  knows[num].images.forEach(img_src => {
    const image = document.createElement("img");
    image.src = '/img/' + img_src;
    image.classList.add("image-large");
    content.append(image);
  });

  content.append(textcontent);
}

function DisplayIndex() {
  knows.forEach((d, i) => {
    const button = document.createElement("button");
    button.classList.add("btn", "btn-link", "index-button");
    button.dataset.title = d.title;
    if (d.images.length > 0) {
      const img = document.createElement("img");
      img.src = '/img/' + d.images[0];
      img.classList.add("button-thumbnail");
      button.append(img);
    }
    const span = document.createElement("span");
    span.innerText = d.title;
    button.append(span);

    button.addEventListener("click", () => DisplayPage(i));

    index.append(button);
  });

  SortIndex();
}

function SortIndex() {
  const index_buttons = document.getElementsByClassName("index-button");
  const buttonsArray = Array.from(index_buttons);

  buttonsArray.sort((a, b) => {
    // Retrieve the title attributes
    const titleA = a.getAttribute('data-title').toLowerCase();
    const titleB = b.getAttribute('data-title').toLowerCase();

    // Compare for sorting
    if (titleA < titleB) return -1;
    if (titleA > titleB) return 1;
    return 0;
  });

  while (index.firstChild) {
    index.removeChild(index.firstChild);
  }

  buttonsArray.forEach(button => {
    index.appendChild(button);
  });
}

DisplayIndex();

async function SubmitCookingRequest(date, type) {
  // Get data from input fields
  const s = document.getElementById(`${date}${type}_select`);

  const select_value = s.value;
  const input_value = document.getElementById(`${date}${type}_input`).value;
  const food_name = input_value.length > 0 ? input_value : s.options[s.selectedIndex].text;

  // Send POST request to server '/cookingp/api_send_cooking_request'
  const post_data = {
    date,
    [type]: input_value.length > 0 ? input_value : select_value,
  };
  const response = await fetch(`/cookingp/api_send_cooking_request?uid=${user_id.innerHTML}`, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    mode: "cors", // no-cors, *cors, same-origin
    cache: "no-cache", // *default, no-cache, reload, force-cache, only-if-cached
    credentials: "same-origin", // include, *same-origin, omit
    headers: {
      "Content-Type": "application/json",
      // 'Content-Type': 'application/x-www-form-urlencoded',
    },
    redirect: "follow", // manual, *follow, error
    referrerPolicy: "no-referrer", // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
    body: JSON.stringify(post_data), // body data type must match "Content-Type" header
  });
  const status = await response.json();
  console.log(status);

  // When get "OK" response, update entry text
  document.getElementById(`${date}${type}`).innerText = food_name;

  // If not "OK", then display error message
}
