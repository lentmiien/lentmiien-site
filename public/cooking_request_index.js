const ids = JSON.parse(document.getElementById("ids").innerText);
const templates = JSON.parse(document.getElementById("templates").innerText);
const knows = JSON.parse(document.getElementById("knows").innerText);
const content = document.getElementById("content");
const index = document.getElementById("index");
const user_id = document.getElementById("user_id");

const master_data = [];
const all_data_fields = [];

// Prepare data labels
for (let i = 0; i < templates.length; i++) {
  templates[i].dataFormat = JSON.parse(templates[i].dataFormat);
  templates[i].dataFormat.forEach(d => {
    if (all_data_fields.indexOf(d.data_label) === -1) {
      all_data_fields.push(d.data_label);
    }
  });
}
// Prepare master data
for (let i = 0; i < knows.length; i++) {
  knows[i].data = JSON.parse(knows[i].data);
  const new_data = {
    m_id: knows[i]._id,
    m_title: knows[i].title,
    m_chat_id: knows[i].originId,
    m_author: knows[i].author,
  };
  all_data_fields.forEach(label => {
    if (label in knows[i].data) {
      new_data[label] = knows[i].data[label];
    } else {
      new_data[label] = null;
    }
  });
  master_data.push(new_data);
}

function DisplayPage(num) {
  // Clear before drawing new content
  content.innerHTML = "";

  const name = document.createElement("h2");
  const original_link = document.createElement("a");
  const br = document.createElement("br");
  const image = document.createElement("img");
  const ingredients = document.createElement("div");
  const instructions = document.createElement("div");
  const note = document.createElement("div");

  name.innerText = master_data[num].name;
  original_link.href = `${master_data[num].url}`;
  original_link.target = `_blank`;
  original_link.innerText = "Original recipe";
  original_link.classList.add("btn", "btn-link");
  if (master_data[num].url.length === 0) {
    // Disable if no url
    original_link.classList.add("a_disabled");
  }
  image.src = master_data[num].image;
  image.classList.add("image-large");
  ingredients.innerHTML = marked.parse(master_data[num].ingredients);
  instructions.innerHTML = marked.parse(master_data[num].instructions);
  note.innerHTML = marked.parse(master_data[num].note);

  content.append(name, original_link, br, image, ingredients, instructions, note);
}

function DisplayIndex() {
  master_data.forEach((d, i) => {
    const button = document.createElement("button");
    button.classList.add("btn", "btn-link", "index-button");
    button.dataset.title = d.m_title;
    if (d.image && d.image.length > 0) {
      const img = document.createElement("img");
      img.src = d.image;
      img.classList.add("button-thumbnail");
      button.append(img);
    }
    const span = document.createElement("span");
    span.innerText = d.m_title;
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
