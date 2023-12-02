const ids = JSON.parse(document.getElementById("ids").innerText);
const templates = JSON.parse(document.getElementById("templates").innerText);
const knows = JSON.parse(document.getElementById("knows").innerText);
const content = document.getElementById("content");
const index = document.getElementById("index");

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
}

function DisplayIndex() {
  master_data.forEach((d, i) => {
    const button = document.createElement("button");
    button.classList.add("btn", "btn-link");
    if (d.image && d.image.length > 0) {
      const img = document.createElement("img");
      img.src = d.image;
      img.classList.add("button-thumbnail");
      button.append(img);
    }
    const span = document.createElement("span");
    span.innerText = d.m_title;
    button.append(span);

    index.append(button);
  });
}

DisplayPage(0);
DisplayIndex();
