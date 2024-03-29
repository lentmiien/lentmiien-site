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
    m_id: knows[i]._id,
    m_title: knows[i].title,
    m_chat_id: knows[i].originId,
    m_category: knows[i].category,
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

/*
{
    "_id": "65681938401a82b3335740b6",
    "templateId": "6562e7bb5d76250d064fe480",
    "title": "Saba no Misoni",
    "createdDate": "2023-11-30T05:10:16.715Z",
    "originId": "65680e1e1da7a09bd412d927",
    "data": {
      \"text\":\"some text....\",
    },
    "category": "Recipe",
    "author": "Lennart",
    "__v": 0
  }
*/
function DisplayPage(num) {
  // Clear before drawing new content
  content.innerHTML = "";

  const name = document.createElement("h2");
  const chat_link = document.createElement("a");
  const edit_link = document.createElement("a");
  const br = document.createElement("br");
  const text = document.createElement("div");

  name.innerText = master_data[num].m_title;
  chat_link.href = `/chat3?chat=${master_data[num].m_chat_id}`;
  chat_link.innerText = "View chat"
  chat_link.classList.add("btn", "btn-link");
  edit_link.href = `/chat3/manage_knowledge_edit?id=${master_data[num].m_id}`;
  edit_link.innerText = "Edit";
  edit_link.classList.add("btn", "btn-link");
  text.innerHTML = marked.parse(master_data[num].text);

  content.append(name, chat_link, edit_link, br, text);
}

function DisplayIndex() {
  // Create Category sections, and display entries in aphabetic order under each category

  // 1. Get and sort categories
  const category_list = [];
  master_data.forEach(d => {
    const index = category_list.indexOf(d.m_category);
    if (index === -1) category_list.push(d.m_category);
  });
  category_list.sort((a,b) => {
    if (a.toUpperCase() < b.toUpperCase()) return -1;
    if (a.toUpperCase() > b.toUpperCase()) return 1;
    return 0;
  });

  // 2. Sort master_data in alphabetic order
  master_data.sort((a,b) => {
    if (a.m_title.toUpperCase() < b.m_title.toUpperCase()) return -1;
    if (a.m_title.toUpperCase() > b.m_title.toUpperCase()) return 1;
    return 0;
  });

  // 3. Go through each category and display relevant entries
  category_list.forEach(category => {
    const div = document.createElement("div");
    const b = document.createElement("b");
    b.innerText = `--- ${category} ---`;
    div.append(b);
    index.append(div);

    master_data.forEach((d, i) => {
      if (d.m_category === category) {
        const button = document.createElement("button");
        button.classList.add("btn", "btn-link", "index-button");
        button.dataset.title = `${d.m_title}`;
        const span = document.createElement("span");
        span.innerText = `${d.m_title}`;
        button.append(span);
        
        button.addEventListener("click", () => DisplayPage(i));
        
        index.append(button);
      }
    });
  });
}

DisplayIndex();
